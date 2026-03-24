import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor, UserProfile } from '../types';
import { Calendar as CalendarIcon, Plus, Store, X, ChevronLeft, ChevronRight, User as UserIcon } from 'lucide-react';
import { cn } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isToday } from 'date-fns';

export function SchedulerModule() {
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [auditors, setAuditors] = useState<UserProfile[]>([]);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ distributorId: '', proposedDate: '', auditorId: '' });

  const fetchData = async () => {
    try {
      const [tRes, dRes, aRes] = await Promise.all([
        supabase.from('auditTickets').select('*'),
        supabase.from('distributors').select('*'),
        supabase.from('users').select('*').eq('role', 'auditor') // Only fetch auditors
      ]);

      if (tRes.error) throw tRes.error;
      if (dRes.error) throw dRes.error;
      if (aRes.error) throw aRes.error;

      if (tRes.data) setTickets(tRes.data as AuditTicket[]);
      if (dRes.data) setDistributors(dRes.data as Distributor[]);
      if (aRes.data) setAuditors(aRes.data as UserProfile[]);
    } catch (error) {
      console.error("Error fetching scheduler data:", error);
    }
  };

  useEffect(() => {
    fetchData();

    // Listen for new tickets or schedule changes
    const channel = supabase.channel('scheduler-changes')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'auditTickets' }, 
        () => fetchData()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const dist = distributors.find(d => d.id === formData.distributorId);
      if (!dist) return;

      const ticketId = Math.random().toString(36).substring(7);
      const newTicket: Partial<AuditTicket> = {
        id: ticketId,
        distributorId: formData.distributorId,
        proposedDate: formData.proposedDate,
        auditorId: formData.auditorId || null,
        approvedValue: dist.approvedValue,
        maxAllowedValue: dist.approvedValue * 1.05,
        status: formData.auditorId ? 'scheduled' : 'tentative',
        scheduledDate: formData.auditorId ? formData.proposedDate : null,
        verifiedTotal: 0,
        presenceLogs: [],
        signOffs: {},
        media: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const { error } = await supabase.from('auditTickets').insert([newTicket]);
      if (error) throw error;

      setIsModalOpen(false);
      setFormData({ distributorId: '', proposedDate: '', auditorId: '' });
    } catch (error) {
      console.error("Error creating audit ticket:", error);
    }
  };

  const assignAuditor = async (ticketId: string, auditorId: string) => {
    try {
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) return;

      const { error } = await supabase
        .from('auditTickets')
        .update({
          auditorId,
          status: 'scheduled',
          scheduledDate: ticket.proposedDate,
          updatedAt: new Date().toISOString()
        })
        .eq('id', ticketId);

      if (error) throw error;
    } catch (error) {
      console.error("Error assigning auditor:", error);
    }
  };

  // Calendar logic
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();
  const paddingDays = Array.from({ length: startDayOfWeek }).map((_, i) => i);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl shadow-sm border border-zinc-200">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <ChevronLeft size={20} />
          </button>
          <h3 className="text-lg font-bold min-w-[150px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <ChevronRight size={20} />
          </button>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"
        >
          <Plus size={20} />
          Schedule Audit
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-200 shadow-sm">
        <div className="grid grid-cols-7 gap-4 mb-4">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-xs font-bold text-zinc-400 uppercase tracking-wider py-2">
              {day}
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-4">
          {paddingDays.map(day => (
            <div key={`empty-${day}`} className="min-h-[120px] rounded-2xl bg-zinc-50/50 border border-zinc-100/50" />
          ))}
          
          {days.map(day => {
            const dayTickets = tickets.filter(t => t.proposedDate === format(day, 'yyyy-MM-dd'));
            const isCurrentDay = isToday(day);
            
            return (
              <div 
                key={day.toISOString()} 
                className={cn(
                  "min-h-[120px] rounded-2xl p-3 border transition-colors group",
                  isCurrentDay ? "bg-black/5 border-black/10" : "bg-white border-zinc-200 hover:border-black/20"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={cn(
                    "text-sm font-bold w-8 h-8 flex items-center justify-center rounded-xl",
                    isCurrentDay ? "bg-black text-white shadow-md" : "text-zinc-700"
                  )}>
                    {format(day, 'd')}
                  </span>
                  {dayTickets.length > 0 && (
                    <span className="text-xs font-bold text-zinc-400 bg-zinc-100 px-2 py-1 rounded-lg">
                      {dayTickets.length}
                    </span>
                  )}
                </div>
                
                <div className="space-y-2">
                  {dayTickets.map(ticket => {
                    const dist = distributors.find(d => d.id === ticket.distributorId);
                    return (
                      <div 
                        key={ticket.id}
                        className={cn(
                          "p-2 rounded-xl text-xs border cursor-pointer hover:shadow-md transition-all group/ticket",
                          ticket.status === 'scheduled' ? "bg-emerald-50 border-emerald-100/50" : 
                          ticket.status === 'tentative' ? "bg-amber-50 border-amber-100/50" : "bg-zinc-50 border-zinc-200"
                        )}
                      >
                        <p className="font-bold text-zinc-900 truncate mb-1">{dist?.name}</p>
                        
                        {ticket.status === 'tentative' ? (
                          <div className="mt-2">
                            <select 
                              className="w-full text-xs p-1 rounded bg-white border border-amber-200 focus:ring-1 focus:ring-amber-500"
                              onChange={(e) => assignAuditor(ticket.id, e.target.value)}
                              value=""
                            >
                              <option value="" disabled>Assign...</option>
                              {auditors.map(a => (
                                <option key={a.uid} value={a.uid}>{a.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 mt-1 bg-emerald-100/50 px-1.5 py-0.5 rounded">
                            <UserIcon size={10} />
                            <span className="truncate">
                              {auditors.find(a => a.uid === ticket.auditorId)?.name || 'Assigned'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Schedule Audit</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl"><X size={20}/></button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Select Distributor</label>
                  <select required className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.distributorId} onChange={e => setFormData({...formData, distributorId: e.target.value})}>
                    <option value="">Choose a distributor...</option>
                    {distributors.filter(d => d.active).map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Proposed Date</label>
                  <input required type="date" min={new Date().toISOString().split('T')[0]} className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.proposedDate} onChange={e => setFormData({...formData, proposedDate: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Assign Auditor (Optional)</label>
                  <select className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.auditorId} onChange={e => setFormData({...formData, auditorId: e.target.value})}>
                    <option value="">Leave unassigned for now...</option>
                    {auditors.map(a => (
                      <option key={a.uid} value={a.uid}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="w-full mt-4 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10">Create Ticket</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}