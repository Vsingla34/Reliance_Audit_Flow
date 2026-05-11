import React, { useRef, useState } from 'react';
import { supabase, logActivity } from '../../supabase';
import { AuditTicket } from '../../types';
import { Camera, Image as ImageIcon, CheckCircle2, X, Send, Trash2, Loader2, AlertCircle, Calendar, Lock } from 'lucide-react';
import { cn } from '../../App';
import { motion, AnimatePresence } from 'motion/react';

const BUCKET_NAME = 'audit-media'; 

interface CheckInBlockProps {
  activeTicket: AuditTicket;
  setActiveTicket: (t: AuditTicket) => void;
  user: any;
  profile: any;
  isAdminOrSuperadmin: boolean;
  isActionableDate: boolean;
}

export function CheckInBlock({ activeTicket, setActiveTicket, user, profile, isAdminOrSuperadmin, isActionableDate }: CheckInBlockProps) {
  const [uploadingDay, setUploadingDay] = useState<number | null>(null);
  const [localPhotos, setLocalPhotos] = useState<Record<number, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
  
  const [rejectingDay, setRejectingDay] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  
  const checkInFileRef = useRef<HTMLInputElement>(null);
  const [activeUploadDay, setActiveUploadDay] = useState<number>(0);

  const auditDays = activeTicket.auditDays || 1;

  // --- DAY-WISE UNLOCK LOGIC ---
  const todayDate = new Date();
  const offset = todayDate.getTimezoneOffset();
  const localToday = new Date(todayDate.getTime() - (offset * 60 * 1000));
  const todayStr = localToday.toISOString().split('T')[0];

  const getTargetDateStr = (baseDate: string, addDays: number) => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + addDays);
    return d.toISOString().split('T')[0];
  };

  const triggerUpload = (dayIndex: number) => {
    setActiveUploadDay(dayIndex);
    checkInFileRef.current?.click();
  };

  const handleCheckInUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !profile) return;
    
    const dayIndex = activeUploadDay;
    setUploadingDay(dayIndex);
    setImageErrors(prev => ({ ...prev, [dayIndex]: false }));
    
    const objectUrl = URL.createObjectURL(file);
    setLocalPhotos(prev => ({ ...prev, [dayIndex]: objectUrl }));
    
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${activeTicket.id}-day${dayIndex + 1}-${Date.now()}.${fileExt}`;
      const filePath = `checkins/${fileName}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(filePath, file, { upsert: true }); 
      if (uploadError) throw new Error(uploadError.message);

      const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

      const log = { 
        userId: user.id, 
        role: profile.role, 
        timestamp: new Date().toISOString(), 
        photoUrl: publicUrl, 
        status: 'pending',
        dayIndex
      }; 
      
      const presenceLogs = [...(activeTicket.presenceLogs || []), log];
      
      setActiveTicket({ ...activeTicket, presenceLogs, status: 'in_progress' });
      await supabase.from('auditTickets').update({ presenceLogs, status: 'in_progress', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);

      logActivity(user, profile, "Check-in Uploaded", `Auditor uploaded selfie for Day ${dayIndex + 1}`);

    } catch (error: any) {
      console.error(error);
      alert(error.message || `Failed to upload check-in photo for Day ${dayIndex + 1}.`);
      setLocalPhotos(prev => { const next = {...prev}; delete next[dayIndex]; return next; });
    } finally {
      setUploadingDay(null);
      if (checkInFileRef.current) checkInFileRef.current.value = '';
    }
  };

  const handleCheckInAction = async (dayIndex: number, action: 'approve' | 'reject') => {
    if (!activeTicket) return;
    
    try {
      const targetStatus = action === 'approve' ? 'approved' : 'rejected';
      const logs = [...(activeTicket.presenceLogs || [])];
      
      let targetIndex = -1;
      for (let i = logs.length - 1; i >= 0; i--) {
        if (logs[i].dayIndex === dayIndex || (dayIndex === 0 && logs[i].dayIndex === undefined)) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        alert("Error: Could not locate the photo record in the database.");
        return;
      }

      logs[targetIndex] = { 
        ...logs[targetIndex], 
        status: targetStatus, 
        rejectReason: action === 'reject' ? rejectReason : undefined 
      };
      
      const newStatus = action === 'reject' ? 'scheduled' : activeTicket.status;

      setActiveTicket({ ...activeTicket, presenceLogs: logs, status: newStatus as any });
      setPreviewPhoto(null);
      setRejectingDay(null);
      setRejectReason('');
      
      if (action === 'reject') {
        setLocalPhotos(prev => { const next = {...prev}; delete next[dayIndex]; return next; });
        setImageErrors(prev => ({ ...prev, [dayIndex]: false }));
      }

      const { error } = await supabase.from('auditTickets').update({ 
        presenceLogs: logs,
        status: newStatus, 
        updatedAt: new Date().toISOString()
      }).eq('id', activeTicket.id);
      
      if (error) throw error;
      
      logActivity(user, profile, `Selfie ${action === 'approve' ? 'Approved' : 'Rejected'}`, `Admin ${action} check-in selfie for Day ${dayIndex + 1}`);

    } catch (error: any) {
      console.error("Error updating check-in status:", error);
      alert("Failed to update status: " + error.message);
    }
  };

  const clearBrokenCheckIn = async (e: React.MouseEvent, dayIndex: number, brokenUrl: string) => {
    e.stopPropagation(); 
    if (!activeTicket) return;
    try {
      const updatedLogs = activeTicket.presenceLogs?.filter((l: any) => l.photoUrl !== brokenUrl) || [];
      const newStatus = updatedLogs.length === 0 ? 'scheduled' : activeTicket.status;

      setActiveTicket({ ...activeTicket, presenceLogs: updatedLogs, status: newStatus as any });
      setImageErrors(prev => ({ ...prev, [dayIndex]: false }));
      setLocalPhotos(prev => { const next = {...prev}; delete next[dayIndex]; return next; });

      await supabase.from('auditTickets').update({ presenceLogs: updatedLogs, status: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error) {
      console.error("Failed to clear broken check-in", error);
    }
  };

  return (
    <div className="space-y-6 mb-8">
      <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-start gap-3">
        <AlertCircle className="text-indigo-600 shrink-0 mt-0.5" size={20} />
        <div>
          <h4 className="font-bold text-indigo-900">Check-In Selfie Requirement</h4>
          <p className="text-sm text-indigo-800 mt-1">
            In Checking selfie there should be all the Auditors, ASE and Distributors. Days will automatically unlock as the audit progresses.
          </p>
        </div>
      </div>

      {(profile.role === 'auditor') && (
        <input type="file" accept="image/*" capture="environment" className="hidden" ref={checkInFileRef} onChange={handleCheckInUpload} />
      )}
      
      {Array.from({ length: auditDays }).map((_, dayIndex) => {
        const log = activeTicket.presenceLogs?.slice().reverse().find((l:any) => l.dayIndex === dayIndex || (dayIndex === 0 && l.dayIndex === undefined));
        
        const localPhoto = localPhotos[dayIndex];
        const hasCheckedIn = !!log || !!localPhoto; 
        const isApproved = log?.status === 'approved';
        const isRejected = log?.status === 'rejected';
        const isPending = (log && log.status !== 'approved' && log.status !== 'rejected') || (localPhoto && !log);
        
        const imageUrlToRender = localPhoto || log?.photoUrl;
        const hasError = imageErrors[dayIndex];
        const isUploading = uploadingDay === dayIndex;

        // Mathematical check to see if this specific day is unlocked
        const targetDateStr = activeTicket.scheduledDate ? getTargetDateStr(activeTicket.scheduledDate, dayIndex) : '';
        const isUnlocked = activeTicket.scheduledDate ? todayStr >= targetDateStr : false;

        return (
          <div key={dayIndex} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col transition-all">
            
            <div className="bg-slate-50 border-b border-slate-100 px-6 py-3 flex items-center justify-between">
              <h4 className="font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="text-slate-400" size={16}/> Day {dayIndex + 1} Check-In
              </h4>
              {hasCheckedIn && !isRejected && (
                <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider", isApproved ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700")}>
                  {isApproved ? 'Approved' : 'Pending Verification'}
                </span>
              )}
            </div>

            {isRejected && (
              <div className="p-5 bg-rose-50 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-rose-100">
                <div className="flex items-start gap-4">
                  <AlertCircle className="text-rose-600 shrink-0 mt-0.5" size={24} />
                  <div>
                    <h4 className="font-bold text-rose-900">Day {dayIndex + 1} Photo Rejected</h4>
                    <p className="text-sm text-rose-700 mt-1">Reason: <strong>{log?.rejectReason || 'No reason provided'}</strong></p>
                  </div>
                </div>
                {(profile.role === 'auditor') && isUnlocked && (
                  <button type="button" onClick={() => triggerUpload(dayIndex)} disabled={isUploading} className="px-6 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-colors shadow-sm whitespace-nowrap">
                    {isUploading ? "Uploading..." : "Re-Upload Photo"}
                  </button>
                )}
              </div>
            )}

            {hasCheckedIn && !isRejected ? (
              <div className="flex flex-col">
                <div className="w-full h-48 md:h-64 bg-slate-100 relative group cursor-pointer" onClick={() => { if (!hasError && imageUrlToRender) setPreviewPhoto(imageUrlToRender); }}>
                  {imageUrlToRender && !hasError ? (
                    <img src={imageUrlToRender} alt={`Day ${dayIndex + 1} Check-in`} className="w-full h-full object-cover" onError={() => setImageErrors(prev => ({...prev, [dayIndex]: true}))} />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50 relative">
                      <ImageIcon size={32} className="mb-2 opacity-50" />
                      {hasError && (
                        <div className="flex flex-col items-center justify-center z-10 bg-white/90 backdrop-blur absolute inset-0">
                          <p className="text-sm font-bold text-rose-500 text-center px-4 mb-3">Broken URL detected.</p>
                          <button type="button" onClick={(e) => clearBrokenCheckIn(e, dayIndex, log?.photoUrl)} className="px-4 py-2 bg-rose-100 text-rose-700 rounded-lg font-bold text-xs hover:bg-rose-200 transition-colors flex items-center gap-2"><Trash2 size={14} /> Clear Broken Photo</button>
                        </div>
                      )}
                    </div>
                  )}
                  {!hasError && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 bg-white/90 backdrop-blur text-black px-4 py-2 rounded-xl font-bold flex items-center gap-2 transform translate-y-2 group-hover:translate-y-0 transition-all"><ImageIcon size={18} /> View Fullscreen</div>
                    </div>
                  )}
                </div>

                {isAdminOrSuperadmin && isPending && !hasError && (
                  <div className="p-4 bg-indigo-50/50 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-indigo-100">
                    <div>
                      <p className="text-sm text-indigo-800 font-bold">Verify Day {dayIndex + 1} Selfie</p>
                    </div>
                    
                    {rejectingDay === dayIndex ? (
                      <form onSubmit={(e) => { e.preventDefault(); handleCheckInAction(dayIndex, 'reject'); }} className="flex w-full sm:w-auto items-center gap-2">
                        <input type="text" placeholder="Reason..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="px-3 py-2 rounded-lg border border-rose-200 text-sm focus:ring-2 focus:ring-rose-500 outline-none w-full sm:w-48 shadow-sm" autoFocus />
                        <button type="button" onClick={() => setRejectingDay(null)} className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-lg transition-colors bg-white border border-slate-200"><X size={16}/></button>
                        <button type="submit" disabled={!rejectReason.trim()} className="px-4 py-2 bg-rose-600 text-white rounded-lg font-bold text-sm hover:bg-rose-700 disabled:opacity-50"><Send size={14}/></button>
                      </form>
                    ) : (
                      <div className="flex w-full sm:w-auto items-center gap-2">
                        <button type="button" onClick={() => setRejectingDay(dayIndex)} className="flex-1 sm:flex-none px-4 py-2 bg-white text-rose-600 rounded-lg font-bold text-sm hover:bg-rose-50 border border-rose-100 transition-colors shadow-sm">Reject</button>
                        <button type="button" onClick={() => handleCheckInAction(dayIndex, 'approve')} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors shadow-sm">Approve</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              !isUnlocked ? (
                <div className="p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center shadow-inner shrink-0">
                      <Lock className="text-slate-400" size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-500">Locked Schedule</h4>
                      <p className="text-sm text-slate-400">Unlocks on {new Date(targetDateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-white">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center border border-indigo-100 shrink-0">
                      <Camera className="text-indigo-500" size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-700">Check-In Selfie Required</h4>
                      <p className="text-sm text-slate-500">Upload selfie for Day {dayIndex + 1}.</p>
                    </div>
                  </div>
                  {(profile.role === 'auditor') && (
                    <button type="button" onClick={() => triggerUpload(dayIndex)} disabled={isUploading || !isActionableDate} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2 whitespace-nowrap min-w-[160px]">
                      {isUploading ? <><Loader2 className="animate-spin" size={18} /> Uploading...</> : <><Camera size={18} /> Upload Photo</>}
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}

      <AnimatePresence>
        {previewPhoto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreviewPhoto(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-4xl bg-transparent flex flex-col items-center">
              <div className="w-full flex justify-end mb-4">
                <button type="button" onClick={() => setPreviewPhoto(null)} className="p-3 bg-white/20 hover:bg-white/40 backdrop-blur text-white rounded-full transition-colors"><X size={24}/></button>
              </div>
              <img src={previewPhoto} alt="Verification" className="w-full h-auto max-h-[80vh] object-contain rounded-xl shadow-2xl" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}