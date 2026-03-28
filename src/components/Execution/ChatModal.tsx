import React, { useState } from 'react';
import { supabase } from '../../supabase';
import { AuditTicket, AuditComment } from '../../types';
import { MessageSquare, X, Send } from 'lucide-react';
import { cn } from '../../App';
import { motion } from 'motion/react';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTicket: AuditTicket;
  user: any;
  profile: any;
}

export function ChatModal({ isOpen, onClose, activeTicket, user, profile }: ChatModalProps) {
  const [chatMessage, setChatMessage] = useState('');

  if (!isOpen) return null;

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !user || !profile || !chatMessage.trim()) return;
    try {
      const newComment: AuditComment = { id: Math.random().toString(36).substring(7), userId: user.id, userName: profile.name, userRole: profile.role, message: chatMessage.trim(), timestamp: new Date().toISOString() };
      const updatedComments = [...(activeTicket.comments || []), newComment];
      await supabase.from('auditTickets').update({ comments: updatedComments, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setChatMessage('');
    } catch (error) {
      console.error("Error sending comment:", error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end p-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-full">
        
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
          <h3 className="text-xl font-bold flex items-center gap-2"><MessageSquare size={20} className="text-blue-500"/> Audit Discussion</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl"><X size={20}/></button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50 space-y-4 custom-scrollbar">
          {(!activeTicket.comments || activeTicket.comments.length === 0) ? (
            <div className="text-center py-12 text-zinc-400"><MessageSquare size={32} className="mx-auto mb-3 opacity-50" /><p className="text-sm font-medium">No comments yet.</p></div>
          ) : (
            activeTicket.comments.map((comment) => {
              const isMe = comment.userId === user?.id;
              return (
                <div key={comment.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                  <div className={cn("flex items-center gap-2 mb-1", isMe ? "flex-row-reverse" : "flex-row")}>
                    <span className="text-[10px] font-bold text-zinc-500">{comment.userName}</span>
                    <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800">{comment.userRole}</span>
                  </div>
                  <div className={cn("px-4 py-3 rounded-2xl max-w-[85%] text-sm shadow-sm", isMe ? "rounded-tr-sm bg-blue-500 text-white" : "rounded-tl-sm bg-zinc-500 text-white")}>
                    {comment.message}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-zinc-100 bg-white shrink-0">
          <form onSubmit={sendComment} className="relative">
            <input type="text" placeholder="Type a message..." className="w-full pl-4 pr-12 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all text-sm" value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} />
            <button type="submit" disabled={!chatMessage.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><Send size={14} /></button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}