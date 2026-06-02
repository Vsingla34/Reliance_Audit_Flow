import React, { useState, useRef } from 'react';
import { supabase, logActivity } from '../../supabase';
import { AuditTicket } from '../../types';
import { Camera, CheckCircle2, Clock, Loader2, User, CalendarDays, X, ShieldCheck } from 'lucide-react';
import { cn } from '../../App';

interface CheckInBlockProps {
  activeTicket: AuditTicket;
  setActiveTicket: (t: AuditTicket) => void;
  user: any;
  profile: any;
  isAdminOrSuperadmin: boolean;
  isActionableDate: boolean;
}

export function CheckInBlock({
  activeTicket, setActiveTicket, user, profile, isAdminOrSuperadmin, isActionableDate
}: CheckInBlockProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const BUCKET = 'audit-media';

  const presenceLogs: any[] = activeTicket.presenceLogs || [];

  // ── Determine what day we're on ───────────────────────────────────────────
  const todayDate = new Date();
  const offset = todayDate.getTimezoneOffset();
  const todayStr = new Date(todayDate.getTime() - offset * 60000)
    .toISOString().split('T')[0];

  const auditDays = activeTicket.auditDays || 1;

  // Check if today already has a log
  const todayLog = presenceLogs.find((l: any) => l.date === todayStr);

  // Which day number is today (1-indexed)
  const scheduledStart = activeTicket.scheduledDate?.split('T')[0] || todayStr;
  const startDate = new Date(scheduledStart);
  startDate.setHours(0, 0, 0, 0);
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);
  const dayOffset = Math.floor((today.getTime() - startDate.getTime()) / 86400000);
  const currentDay = Math.min(Math.max(dayOffset + 1, 1), auditDays);

  // ── Upload selfie ─────────────────────────────────────────────────────────
  const handleSelfieUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !profile) return;

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `checkins/${activeTicket.id}/day${currentDay}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const newLog = {
        day: currentDay,
        date: todayStr,
        selfieUrl: publicUrl,
        uploadedBy: user.id,
        uploaderName: profile.name,
        uploaderRole: profile.role,
        status: isAdminOrSuperadmin ? 'approved' : 'pending',
        approvedBy: isAdminOrSuperadmin ? profile.name : null,
        timestamp: new Date().toISOString(),
      };

      const updatedLogs = [...presenceLogs.filter((l: any) => l.date !== todayStr), newLog];

      await supabase.from('auditTickets').update({
        presenceLogs: updatedLogs,
        updatedAt: new Date().toISOString(),
      }).eq('id', activeTicket.id);

      setActiveTicket({ ...activeTicket, presenceLogs: updatedLogs });

      logActivity(user, profile, 'Check-In Selfie Uploaded',
        `Day ${currentDay} selfie uploaded for ${activeTicket.id}${isAdminOrSuperadmin ? ' (auto-approved)' : ''}`);
    } catch (err: any) {
      alert(`Upload failed: ${err.message || err}`);
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Approve / reject (admin) ──────────────────────────────────────────────
  const handleApprove = async (log: any) => {
    if (!isAdminOrSuperadmin) return;
    const updated = presenceLogs.map((l: any) =>
      l.date === log.date
        ? { ...l, status: 'approved', approvedBy: profile.name }
        : l
    );
    await supabase.from('auditTickets').update({
      presenceLogs: updated, updatedAt: new Date().toISOString()
    }).eq('id', activeTicket.id);
    setActiveTicket({ ...activeTicket, presenceLogs: updated });
    logActivity(user, profile, 'Check-In Approved',
      `Admin approved Day ${log.day} selfie for ${activeTicket.id}`);
  };

  const handleReject = async (log: any) => {
    if (!isAdminOrSuperadmin) return;
    const updated = presenceLogs.map((l: any) =>
      l.date === log.date
        ? { ...l, status: 'rejected', approvedBy: null, selfieUrl: null }
        : l
    );
    await supabase.from('auditTickets').update({
      presenceLogs: updated, updatedAt: new Date().toISOString()
    }).eq('id', activeTicket.id);
    setActiveTicket({ ...activeTicket, presenceLogs: updated });
  };

  // ── Who can upload ────────────────────────────────────────────────────────
  // superadmin/admin/auditor/ase can all upload selfies
  const canUploadSelfie = ['superadmin', 'admin', 'auditor', 'ase'].includes(profile?.role || '');
  const showUploadButton = canUploadSelfie && !todayLog && isActionableDate;
  const showAdminAutoApproveHint = isAdminOrSuperadmin && !todayLog && isActionableDate;

  return (
    <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-base text-slate-900 flex items-center gap-2">
          <Camera size={18} className="text-indigo-600" />
          Check-In Selfie Requirement
        </h4>
        {isAdminOrSuperadmin && (
          <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
            <ShieldCheck size={10} /> Admin — Auto-Approved
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 -mt-1">
        In checking selfie there should be all the Auditors, ASE and Distributors.
        Days will automatically unlock as the audit progresses.
      </p>

      {/* Day cards */}
      {Array.from({ length: auditDays }, (_, i) => {
        const dayNum = i + 1;
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + i);
        const dayDateStr = dayDate.toISOString().split('T')[0];
        const log = presenceLogs.find((l: any) => l.day === dayNum || l.date === dayDateStr);
        const isToday = dayDateStr === todayStr;
        const isPast  = dayDate < today;
        const isFuture = dayDate > today;

        return (
          <div key={dayNum} className={cn(
            'border rounded-2xl overflow-hidden',
            log?.status === 'approved' ? 'border-emerald-200 bg-emerald-50/30'
              : log?.status === 'pending' ? 'border-amber-200 bg-amber-50/30'
              : log?.status === 'rejected' ? 'border-rose-200 bg-rose-50/30'
              : isToday ? 'border-indigo-200 bg-indigo-50/20'
              : isFuture ? 'border-slate-100 bg-slate-50/40 opacity-60'
              : 'border-slate-200 bg-white'
          )}>
            {/* Day header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-inherit">
              <div className="flex items-center gap-2">
                <CalendarDays size={15} className={cn(
                  log?.status === 'approved' ? 'text-emerald-600'
                    : isToday ? 'text-indigo-600'
                    : 'text-slate-400'
                )} />
                <span className="text-sm font-bold text-slate-800">
                  Day {dayNum} Check-In
                </span>
                {isToday && (
                  <span className="text-[9px] font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    Today
                  </span>
                )}
              </div>

              {/* Status badge */}
              {log?.status === 'approved' && (
                <span className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  <CheckCircle2 size={10} /> Approved
                </span>
              )}
              {log?.status === 'pending' && (
                <span className="flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <Clock size={10} /> Pending Approval
                </span>
              )}
              {log?.status === 'rejected' && (
                <span className="flex items-center gap-1 text-[10px] font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                  <X size={10} /> Rejected — Re-upload
                </span>
              )}
            </div>

            {/* Day body */}
            <div className="px-4 py-3">
              {log?.selfieUrl ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Selfie thumbnail */}
                  <a href={log.selfieUrl} target="_blank" rel="noreferrer">
                    <img
                      src={log.selfieUrl}
                      alt={`Day ${dayNum} selfie`}
                      className="w-16 h-16 object-cover rounded-xl border border-slate-200 shadow-sm hover:opacity-80 transition-opacity"
                    />
                  </a>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700">
                      Uploaded by {log.uploaderName}
                      <span className="text-[10px] font-normal text-slate-400 ml-1">
                        ({log.uploaderRole})
                      </span>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(log.timestamp).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>

                  {/* Admin approve/reject */}
                  {isAdminOrSuperadmin && log.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(log)}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all active:scale-95 shadow-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(log)}
                        className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50 transition-all active:scale-95"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-slate-500">
                    <div className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center border shrink-0',
                      isToday ? 'bg-indigo-50 border-indigo-200 text-indigo-500'
                        : 'bg-slate-50 border-slate-200 text-slate-400'
                    )}>
                      <Camera size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">
                        Check-In Selfie Required
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {isFuture
                          ? `Available on ${dayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                          : `Upload selfie for Day ${dayNum}.`}
                        {isAdminOrSuperadmin && isToday && (
                          <span className="ml-1 text-emerald-600 font-bold">Will auto-approve.</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Upload button — visible for admin/auditor on today or past days */}
                  {canUploadSelfie && !isFuture && isActionableDate && (
                    <>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        ref={dayNum === currentDay ? fileRef : undefined}
                        id={`selfie-upload-day-${dayNum}`}
                        onChange={handleSelfieUpload}
                      />
                      <label
                        htmlFor={`selfie-upload-day-${dayNum}`}
                        className={cn(
                          'flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl cursor-pointer transition-all active:scale-95 shadow-sm shrink-0',
                          isUploading
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-slate-900 text-white hover:bg-slate-700'
                        )}
                      >
                        {isUploading ? (
                          <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                        ) : (
                          <><Camera size={14} /> Upload</>
                        )}
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}