import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase';
import { AuditTicket, AuditComment } from '../../types';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { cn } from '../../App';
import { motion } from 'motion/react';

interface ChatModalProps {
  isOpen:       boolean;
  onClose:      () => void;
  activeTicket: AuditTicket;
  user:         any;
  profile:      any;
}

export function ChatModal({ isOpen, onClose, activeTicket, user, profile }: ChatModalProps) {
  const [chatMessage, setChatMessage]   = useState('');
  const [isSending, setIsSending]       = useState(false);
  const bottomRef                       = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    }
  }, [activeTicket.comments?.length, isOpen]);

  if (!isOpen) return null;

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !user || !profile || !chatMessage.trim()) return;

    setIsSending(true);
    try {
      const newComment: AuditComment = {
        id:        Math.random().toString(36).substring(7),
        userId:    user.id,
        userName:  profile.name,
        userRole:  profile.role,
        message:   chatMessage.trim(),
        timestamp: new Date().toISOString(),
      };

      const updatedComments = [...(activeTicket.comments || []), newComment];

      await supabase
        .from('auditTickets')
        .update({ comments: updatedComments, updatedAt: new Date().toISOString() })
        .eq('id', activeTicket.id);

      // ── Notify ALL assigned users on this ticket ────────────────────────
      // Fetch distributor to get full hierarchy (hoIds, dmIds, smIds, asmIds, aseIds)
      // plus the ticket's auditorIds — everyone gets a bell notification.
      await notifyDiscussionParticipants(activeTicket, profile, chatMessage.trim());

      setChatMessage('');
    } catch (error) {
      console.error('Error sending comment:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}
        className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-full"
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center border border-blue-100">
              <MessageSquare size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Discussion</h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {activeTicket.comments?.length || 0} message{(activeTicket.comments?.length || 0) !== 1 ? 's' : ''}
                {' · '}All assigned users notified
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="p-5 overflow-y-auto flex-1 bg-zinc-50/50 space-y-4 custom-scrollbar">
          {(!activeTicket.comments || activeTicket.comments.length === 0) ? (
            <div className="text-center py-16 text-zinc-400 flex flex-col items-center">
              <MessageSquare size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-bold text-zinc-500">No messages yet</p>
              <p className="text-xs mt-1 text-zinc-400">Send a message — all assigned users will be notified.</p>
            </div>
          ) : (
            activeTicket.comments.map((comment) => {
              const isMe = comment.userId === user?.id;
              return (
                <div key={comment.id} className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                  <div className={cn('flex items-center gap-2 mb-1', isMe ? 'flex-row-reverse' : 'flex-row')}>
                    <span className="text-[10px] font-bold text-zinc-500">{comment.userName}</span>
                    <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700">
                      {comment.userRole}
                    </span>
                  </div>
                  <div className={cn(
                    'px-4 py-3 rounded-2xl max-w-[85%] text-sm shadow-sm',
                    isMe ? 'rounded-tr-sm bg-blue-500 text-white' : 'rounded-tl-sm bg-zinc-600 text-white'
                  )}>
                    {comment.message}
                  </div>
                  <span className="text-[9px] text-zinc-400 mt-1 px-1">
                    {new Date(comment.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {new Date(comment.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-zinc-100 bg-white shrink-0">
          <form onSubmit={sendComment} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Type a message…"
              className="flex-1 pl-4 pr-3 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm outline-none"
              value={chatMessage}
              onChange={e => setChatMessage(e.target.value)}
              disabled={isSending}
            />
            <button
              type="submit"
              disabled={!chatMessage.trim() || isSending}
              className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0 active:scale-95"
            >
              {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
          <p className="text-[10px] text-zinc-400 mt-2 text-center font-medium">
            All HO, DM, SM, ASM, ASE and Auditors assigned to this audit will receive a notification.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notify all participants of this assignment — distributorIds hierarchy +
// auditorIds on the ticket. Skips the sender so they don't notify themselves.
// ─────────────────────────────────────────────────────────────────────────────
async function notifyDiscussionParticipants(
  ticket:  AuditTicket,
  sender:  { uid: string; name: string; role: string },
  message: string,
) {
  try {
    // Fetch distributor to get full hierarchy
    const { data: dist } = await supabase
      .from('distributors')
      .select('hoIds,dmIds,smIds,asmIds,aseIds')
      .eq('id', ticket.distributorId)
      .maybeSingle();

    // Collect every assigned uid
    const recipientSet = new Set<string>();

    // Hierarchy from distributor
    if (dist) {
      for (const field of ['hoIds', 'dmIds', 'smIds', 'asmIds', 'aseIds'] as const) {
        const ids = (dist as any)[field] as string[] | null;
        if (ids && Array.isArray(ids)) ids.forEach(id => recipientSet.add(id));
      }
    }

    // Auditors assigned on the ticket
    const auditorIds = (ticket as any).auditorIds as string[] | undefined;
    if (auditorIds && Array.isArray(auditorIds)) {
      auditorIds.forEach(id => recipientSet.add(id));
    }

    // Remove the sender — no self-notification
    recipientSet.delete(sender.uid);

    if (recipientSet.size === 0) return;

    const notifications = Array.from(recipientSet).map(uid => ({
      recipient_id: uid,
      title:        `New message in discussion`,
      message:      `${sender.name} (${sender.role.toUpperCase()}): "${message.length > 80 ? message.slice(0, 80) + '…' : message}"`,
      is_read:      false,
    }));

    await supabase.from('notifications').insert(notifications);
  } catch (err) {
    // Non-critical — log but don't throw
    console.error('Failed to send discussion notifications:', err);
  }
}