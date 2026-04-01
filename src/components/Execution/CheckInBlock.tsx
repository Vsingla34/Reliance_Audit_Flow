import React, { useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { AuditTicket } from '../../types';
import { Camera, Image as ImageIcon, CheckCircle2, Clock, ThumbsDown, ThumbsUp, X, Send, Trash2, Loader2, AlertCircle, Calendar } from 'lucide-react';
import { cn } from '../../App';
import { motion, AnimatePresence } from 'motion/react';

// 👇 Fixed to match your actual bucket!
const BUCKET_NAME = 'audit-media'; 

interface CheckInBlockProps {
  activeTicket: AuditTicket;
  setActiveTicket: (t: AuditTicket) => void;
  user: any;
  profile: any;
  isAdminOrHO: boolean;
  isActionableDate: boolean;
}

export function CheckInBlock({ activeTicket, setActiveTicket, user, profile, isAdminOrHO, isActionableDate }: CheckInBlockProps) {
  const [uploadingDay, setUploadingDay] = useState<number | null>(null);
  const [localPhotos, setLocalPhotos] = useState<Record<number, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
  
  const [rejectingDay, setRejectingDay] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  
  const checkInFileRef = useRef<HTMLInputElement>(null);
  const [activeUploadDay, setActiveUploadDay] = useState<number>(0);

  const auditDays = activeTicket.auditDays || 1;

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
      const lastPhotoIndex = logs.map((l:any) => !!l.photoUrl && (l.dayIndex === dayIndex || (dayIndex === 0 && l.dayIndex === undefined))).lastIndexOf(true);

      if (lastPhotoIndex !== -1) {
        logs[lastPhotoIndex] = { ...logs[lastPhotoIndex], status: targetStatus, rejectReason: action === 'reject' ? rejectReason : undefined };
      }
      
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
      {/* NEW: Instruction Banner */}
      <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
        <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={20} />
        <div>
          <h4 className="font-bold text-blue-900">Check-In Selfie Requirement</h4>
          <p className="text-sm text-blue-800 mt-1">
            In Checking selfie there should be all the Auditors, ASE and Distributors.
          </p>
        </div>
      </div>

      <input type="file" accept="image/*" capture="environment" className="hidden" ref={checkInFileRef} onChange={handleCheckInUpload} />
      
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

        return (
          <div key={dayIndex} className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col transition-all">
            
            <div className="bg-zinc-50 border-b border-zinc-100 px-6 py-3 flex items-center justify-between">
              <h4 className="font-bold text-zinc-900 flex items-center gap-2">
                <Calendar className="text-zinc-400" size={16}/> Day {dayIndex + 1} Check-In
              </h4>
              {hasCheckedIn && !isRejected && (
                <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider", isApproved ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                  {isApproved ? 'Approved' : 'Pending Verification'}
                </span>
              )}
            </div>

            {isRejected && (
              <div className="p-5 bg-red-50 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-red-100">
                <div className="flex items-start gap-4">
                  <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={24} />
                  <div>
                    <h4 className="font-bold text-red-900">Day {dayIndex + 1} Photo Rejected</h4>
                    <p className="text-sm text-red-700 mt-1">Reason: <strong>{log?.rejectReason || 'No reason provided'}</strong></p>
                  </div>
                </div>
                {(profile.role === 'auditor' || isAdminOrHO) && (
                  <button onClick={() => triggerUpload(dayIndex)} disabled={isUploading} className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-sm whitespace-nowrap">
                    {isUploading ? "Uploading..." : "Re-Upload Photo"}
                  </button>
                )}
              </div>
            )}

            {hasCheckedIn && !isRejected ? (
              <div className="flex flex-col">
                <div className="w-full h-48 md:h-64 bg-zinc-100 relative group cursor-pointer" onClick={() => { if (!hasError && imageUrlToRender) setPreviewPhoto(imageUrlToRender); }}>
                  {imageUrlToRender && !hasError ? (
                    <img src={imageUrlToRender} alt={`Day ${dayIndex + 1} Check-in`} className="w-full h-full object-cover" onError={() => setImageErrors(prev => ({...prev, [dayIndex]: true}))} />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 bg-zinc-50 relative">
                      <ImageIcon size={32} className="mb-2 opacity-50" />
                      {hasError && (
                        <div className="flex flex-col items-center justify-center z-10 bg-white/90 backdrop-blur absolute inset-0">
                          <p className="text-sm font-bold text-red-500 text-center px-4 mb-3">Broken URL detected.</p>
                          <button onClick={(e) => clearBrokenCheckIn(e, dayIndex, log?.photoUrl)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-bold text-xs hover:bg-red-200 transition-colors flex items-center gap-2"><Trash2 size={14} /> Clear Broken Photo</button>
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

                {isAdminOrHO && isPending && !hasError && (
                  <div className="p-4 bg-blue-50 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-blue-100">
                    <div>
                      <p className="text-sm text-blue-800 font-medium">Verify Day {dayIndex + 1} Selfie</p>
                    </div>
                    
                    {rejectingDay === dayIndex ? (
                      <form onSubmit={(e) => { e.preventDefault(); handleCheckInAction(dayIndex, 'reject'); }} className="flex w-full sm:w-auto items-center gap-2">
                        <input type="text" placeholder="Reason..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="px-3 py-2 rounded-lg border border-red-200 text-sm focus:ring-2 focus:ring-red-500 outline-none w-full sm:w-48 shadow-sm" autoFocus />
                        <button type="button" onClick={() => setRejectingDay(null)} className="p-2 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 rounded-lg transition-colors bg-white border border-zinc-200"><X size={16}/></button>
                        <button type="submit" disabled={!rejectReason.trim()} className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 disabled:opacity-50"><Send size={14}/></button>
                      </form>
                    ) : (
                      <div className="flex w-full sm:w-auto items-center gap-2">
                        <button onClick={() => setRejectingDay(dayIndex)} className="flex-1 sm:flex-none px-4 py-2 bg-white text-red-600 rounded-lg font-bold text-sm hover:bg-red-50 border border-red-100 transition-colors shadow-sm">Reject</button>
                        <button onClick={() => handleCheckInAction(dayIndex, 'approve')} className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm">Approve</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              !isRejected && (
                <div className="p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-white">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center shadow-inner shrink-0">
                      <Camera className="text-zinc-400" size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-700">Check-In Selfie Required</h4>
                      <p className="text-sm text-zinc-500">Upload selfie for Day {dayIndex + 1}.</p>
                    </div>
                  </div>
                  {(profile.role === 'auditor' || isAdminOrHO) && (
                    <button onClick={() => triggerUpload(dayIndex)} disabled={isUploading || !isActionableDate} className="px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2 whitespace-nowrap min-w-[160px]">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreviewPhoto(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-4xl bg-transparent flex flex-col items-center">
              <div className="w-full flex justify-end mb-4">
                <button onClick={() => setPreviewPhoto(null)} className="p-3 bg-white/20 hover:bg-white/40 backdrop-blur text-white rounded-full transition-colors"><X size={24}/></button>
              </div>
              <img src={previewPhoto} alt="Verification" className="w-full h-auto max-h-[80vh] object-contain rounded-xl shadow-2xl" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}