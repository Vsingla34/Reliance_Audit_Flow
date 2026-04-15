import React, { useEffect, useState, useMemo } from 'react';
import { supabase, logActivity } from '../supabase';
import { AuditTicket, Distributor, UserProfile, DateProposal } from '../types';
import { Calendar as CalendarIcon, Plus, Store, MapPin, CheckCircle2, X, Send, AlertCircle, MessageSquare, Filter, Trash2, CalendarCheck, ChevronLeft, ChevronRight, Clock, Edit2, Search } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday } from 'date-fns';

export function SchedulerModule() {
  const { user, profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [auditors, setAuditors] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]); 
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [negotiationTicket, setNegotiationTicket] = useState<AuditTicket | null>(null);
  
  const [editingActiveTicket, setEditingActiveTicket] = useState<AuditTicket | null>(null);
  const [editTicketData, setEditTicketData] = useState({ scheduledDate: '', auditorIds: [] as string[], auditDays: 1 });

  const [pendingTab, setPendingTab] = useState<'approval' | 'waiting'>('approval');
  const [pendingFilterAse, setPendingFilterAse] = useState<string>('all');

  const [createData, setCreateData] = useState({ distributorId: '', proposedDate: '', auditorIds: [] as string[], auditDays: 1 });
  const [proposalData, setProposalData] = useState({ date: '', remarks: '' });
  const [approvalAuditorIds, setApprovalAuditorIds] = useState<string[]>([]);
  const [approvalAuditDays, setApprovalAuditDays] = useState(1);

  // Search state for Auditor Lists
  const [auditorSearch, setAuditorSearch] = useState('');

  // SUPERADMIN UPDATE HERE
  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');

  const distMap = useMemo(() => {
    const map: Record<string, Distributor> = {};
    distributors.forEach(d => { map[d.id] = d; });
    return map;
  }, [distributors]);

  const userMap = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    allUsers.forEach(u => { map[u.uid] = u; });
    return map;
  }, [allUsers]);

  const ticketsByDate = useMemo(() => {
    const map: Record<string, AuditTicket[]> = {};
    tickets.forEach(t => {
      const dateStr = t.status === 'tentative' ? t.proposedDate : t.scheduledDate;
      if (dateStr) {
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(t);
      }
    });
    return map;
  }, [tickets]);

  // Filter auditors based on search term
  const displayedAuditors = useMemo(() => {
    if (!auditorSearch.trim()) return auditors;
    return auditors.filter(a => a.name.toLowerCase().includes(auditorSearch.toLowerCase()));
  }, [auditors, auditorSearch]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;
      try {
        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase') dQuery = dQuery.eq('aseId', profile.uid);
        else if (profile.role === 'distributor') dQuery = dQuery.eq('email', profile.email);
        
        const [dRes, uRes] = await Promise.all([
          dQuery,
          supabase.from('users').select('*') 
        ]);

        if (dRes.error) throw dRes.error;
        const fetchedDistributors = (dRes.data || []) as Distributor[];
        setDistributors(fetchedDistributors);
        
        if (uRes.data) {
          const usersList = uRes.data as UserProfile[];
          setAllUsers(usersList);
          setAuditors(usersList.filter(u => u.role === 'auditor'));
        }

        let tQuery = supabase.from('auditTickets').select('*');
        if (profile.role === 'auditor') {
          tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'distributor'].includes(profile.role)) {
          const distIds = fetchedDistributors.map(d => d.id);
          if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
          else return setTickets([]);
        }

        const tRes = await tQuery;
        if (tRes.error) throw tRes.error;
        
        if (tRes.data) {
          const validTickets = (tRes.data as AuditTicket[]).filter(t => 
            fetchedDistributors.some(d => d.id === t.distributorId)
          );
          setTickets(validTickets);
        }
      } catch (error) {
        console.error("Error fetching scheduler data:", error);
      }
    };

    fetchData();
    const channel = supabase.channel('scheduler-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData)
      .subscribe();
    
    return () => { supabase.removeChannel(channel); };
  }, [profile?.uid, profile?.role, profile?.email]);

  useEffect(() => {
    if (negotiationTicket) {
      const updated = tickets.find(t => t.id === negotiationTicket.id);
      if (updated) setNegotiationTicket(updated);
    }
  }, [tickets, negotiationTicket?.id]);

  const deleteTicket = async (ticketId: string) => {
    if (window.confirm("Are you sure you want to permanently delete this ticket?")) {
      try {
        await supabase.from('auditLineItems').delete().eq('ticketId', ticketId);
        await supabase.from('auditTickets').delete().eq('id', ticketId);
        setNegotiationTicket(null);
        setEditingActiveTicket(null);
        setAuditorSearch('');
      } catch (error) {
        console.error("Error deleting ticket:", error);
      }
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createData.auditorIds.length === 0) return alert("Please assign at least one auditor.");

    try {
      const dist = distMap[createData.distributorId];
      if (!dist) return;

      const existingTicket = tickets.find(t => t.distributorId === createData.distributorId && t.status === 'tentative');

      if (existingTicket) {
        await supabase.from('auditTickets').update({
          proposedDate: createData.proposedDate,
          scheduledDate: createData.proposedDate,
          auditorIds: createData.auditorIds, 
          auditDays: createData.auditDays,
          status: 'scheduled',
          updatedAt: new Date().toISOString()
        }).eq('id', existingTicket.id);
      } else {
        const newTicket: Partial<AuditTicket> = {
          id: Math.random().toString(36).substring(7),
          distributorId: createData.distributorId,
          proposedDate: createData.proposedDate,
          auditorIds: createData.auditorIds, 
          auditDays: createData.auditDays,
          approvedValue: dist.approvedValue,
          maxAllowedValue: dist.approvedValue * 1.05,
          status: 'scheduled', 
          scheduledDate: createData.proposedDate,
          verifiedTotal: 0,
          presenceLogs: [],
          signOffs: {},
          media: [],
          dateProposals: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await supabase.from('auditTickets').insert([newTicket]);
      }

      logActivity(user, profile, "Audit Scheduled", `${profile?.role.toUpperCase()} scheduled audit for ${dist?.name} on ${createData.proposedDate}`);

      setIsCreateModalOpen(false);
      setCreateData({ distributorId: '', proposedDate: '', auditorIds: [], auditDays: 1 });
      setAuditorSearch('');
    } catch (error) {
      console.error("Error creating audit ticket:", error);
    }
  };

  const handleEditActiveTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingActiveTicket) return;
    if (editTicketData.auditorIds.length === 0) return alert("Please assign at least one auditor.");

    try {
      await supabase.from('auditTickets').update({
        scheduledDate: editTicketData.scheduledDate,
        proposedDate: editTicketData.scheduledDate,
        auditorIds: editTicketData.auditorIds,
        auditDays: editTicketData.auditDays,
        updatedAt: new Date().toISOString()
      }).eq('id', editingActiveTicket.id);

      const dist = distMap[editingActiveTicket.distributorId];
      logActivity(user, profile, "Audit Re-scheduled", `${profile?.role.toUpperCase()} modified the schedule/auditors for ${dist?.name}`);

      setEditingActiveTicket(null);
      setAuditorSearch('');
    } catch (error) {
      console.error("Error updating ticket:", error);
    }
  };

  const submitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!negotiationTicket || !user || !profile) return;

    if (!proposalData.date && !proposalData.remarks.trim()) {
      alert("Please provide either a date or a message to send.");
      return;
    }

    try {
      const newProposal: DateProposal = {
        id: Math.random().toString(36).substring(7),
        date: proposalData.date || '',
        proposedByUserId: user.id,
        proposedByName: profile.name,
        role: profile.role,
        email: profile.email,
        remarks: proposalData.remarks,
        timestamp: new Date().toISOString()
      };

      const updatedProposals = [...(negotiationTicket.dateProposals || []), newProposal];
      const newMainDate = proposalData.date ? proposalData.date : negotiationTicket.proposedDate;

      await supabase.from('auditTickets').update({
        proposedDate: newMainDate,
        dateProposals: updatedProposals,
        updatedAt: new Date().toISOString()
      }).eq('id', negotiationTicket.id);

      setProposalData({ date: '', remarks: '' });
    } catch (error) {
      console.error("Error submitting proposal:", error);
    }
  };

  const approveAndSchedule = async (proposalDate: string) => {
    if (!negotiationTicket || approvalAuditorIds.length === 0) {
      alert("Please select at least one Auditor first!");
      return;
    }

    try {
      await supabase.from('auditTickets').update({
        status: 'scheduled',
        scheduledDate: proposalDate, 
        auditorIds: approvalAuditorIds, 
        auditDays: approvalAuditDays, 
        updatedAt: new Date().toISOString()
      }).eq('id', negotiationTicket.id);

      const dist = distMap[negotiationTicket.distributorId];
      logActivity(user, profile, "Audit Scheduled", `${profile?.role.toUpperCase()} approved date proposal and scheduled audit for ${dist?.name} on ${proposalDate}`);

      setNegotiationTicket(null); 
      setApprovalAuditorIds([]);
      setApprovalAuditDays(1);
      setAuditorSearch('');
    } catch (error) {
      console.error("Error approving schedule:", error);
    }
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();
  const paddingDays = Array.from({ length: startDayOfWeek }).map((_, i) => i);

  const allPendingTickets = useMemo(() => tickets.filter(t => t.status === 'tentative'), [tickets]);
  const uniquePendingAseIds = useMemo(() => {
    const ids = allPendingTickets.map(t => distMap[t.distributorId]?.aseId).filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [allPendingTickets, distMap]);

  const filteredPendingTickets = useMemo(() => {
    return allPendingTickets.filter(t => {
      if (pendingFilterAse !== 'all') return distMap[t.distributorId]?.aseId === pendingFilterAse;
      return true;
    });
  }, [allPendingTickets, pendingFilterAse, distMap]);

  const awaitingApproval = useMemo(() => filteredPendingTickets.filter(t => t.dateProposals && t.dateProposals.length > 0), [filteredPendingTickets]);
  const awaitingProposal = useMemo(() => filteredPendingTickets.filter(t => !t.dateProposals || t.dateProposals.length === 0), [filteredPendingTickets]);
  const displayTickets = pendingTab === 'approval' ? awaitingApproval : awaitingProposal;

  useEffect(() => {
    if (awaitingApproval.length === 0 && awaitingProposal.length > 0 && pendingTab === 'approval') {
      setPendingTab('waiting');
    }
  }, [awaitingApproval.length, awaitingProposal.length, pendingTab]);

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4 bg-white p-2 rounded-2xl shadow-sm border border-zinc-200">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><ChevronLeft size={20} className="w-5 h-5" /></button>
          <h3 className="text-base sm:text-lg font-bold min-w-[120px] sm:min-w-[150px] text-center">{format(currentMonth, 'MMMM yyyy')}</h3>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><ChevronRight size={20} className="w-5 h-5" /></button>
        </div>
        
        {isAdminOrHO && (
          <button onClick={() => setIsCreateModalOpen(true)} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 text-sm sm:text-base">
            <Plus size={18} className="sm:w-5 sm:h-5" /> Force Schedule
          </button>
        )}
      </div>

      {allPendingTickets.length > 0 && (
        <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm overflow-hidden mb-6 sm:mb-8 w-full">
          <div className="p-4 sm:p-6 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/50">
            <div className="flex items-center gap-4 overflow-x-auto custom-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex bg-zinc-200/50 p-1 rounded-xl w-max">
                <button onClick={() => setPendingTab('approval')} className={cn("px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap", pendingTab === 'approval' ? "bg-white text-amber-600 shadow-sm" : "text-zinc-500 hover:text-black")}>
                  Needs Approval <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]", pendingTab === 'approval' ? "bg-amber-100" : "bg-zinc-200")}>{awaitingApproval.length}</span>
                </button>
                <button onClick={() => setPendingTab('waiting')} className={cn("px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap", pendingTab === 'waiting' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-black")}>
                  Waiting on ASE <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]", pendingTab === 'waiting' ? "bg-zinc-100" : "bg-zinc-200")}>{awaitingProposal.length}</span>
                </button>
              </div>
            </div>
            
            {isAdminOrHO && (
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Filter size={16} className="text-zinc-400 hidden sm:block" />
                <select className="w-full md:w-auto text-xs sm:text-sm px-3 sm:px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-medium shadow-sm cursor-pointer" value={pendingFilterAse} onChange={(e) => setPendingFilterAse(e.target.value)}>
                  <option value="all">All Area Sales Execs</option>
                  {uniquePendingAseIds.map(id => <option key={id} value={id}>{userMap[id]?.name || 'Unknown ASE'}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="p-3 sm:p-4 max-h-[360px] overflow-y-auto custom-scrollbar bg-zinc-50/30">
            {displayTickets.length === 0 ? (
              <div className="text-center py-6 sm:py-8 text-zinc-400"><CheckCircle2 size={32} className="mx-auto mb-2 opacity-30" /><p className="text-sm font-medium">No tickets in this folder.</p></div>
            ) : (
              <div className="space-y-3">
                {displayTickets.map(ticket => {
                  const dist = distMap[ticket.distributorId];
                  const ase = dist ? userMap[dist.aseId || ''] : null;
                  const lastProposal = ticket.dateProposals?.[ticket.dateProposals.length - 1];

                  return (
                    <motion.div layout key={ticket.id} onClick={() => setNegotiationTicket(ticket)} className={cn("bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 group", pendingTab === 'approval' ? "border-amber-200 hover:border-amber-400" : "border-zinc-200 hover:border-zinc-400")}>
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", pendingTab === 'approval' ? "bg-amber-50 text-amber-600" : "bg-zinc-100 text-zinc-500")}><Store size={18} /></div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm sm:text-base text-zinc-900 truncate">{dist?.name || 'Unknown'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1">
                            <span className="text-[9px] sm:text-[10px] text-zinc-500 bg-zinc-100 px-1.5 sm:px-2 py-0.5 rounded font-medium truncate max-w-[150px]">ASE: {ase?.name || 'Unassigned'}</span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 truncate">{dist?.city || 'No Location'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between lg:justify-end gap-3 sm:gap-6 w-full lg:w-auto mt-2 lg:mt-0">
                        {pendingTab === 'approval' && lastProposal && (
                          <div className="text-left lg:text-right w-full lg:w-auto bg-amber-50/50 p-2 rounded-lg lg:bg-transparent lg:p-0 lg:rounded-none">
                            <p className="text-[9px] sm:text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-0.5 flex items-center gap-1"><MessageSquare size={10} /> Latest Reply</p>
                            <p className="text-xs font-medium text-zinc-700 truncate max-w-full lg:max-w-[200px]">"{lastProposal.remarks || 'No remarks'}"</p>
                          </div>
                        )}
                        <button className="w-full sm:w-auto px-4 py-2 sm:py-2.5 bg-zinc-100 text-zinc-900 text-xs sm:text-sm font-bold rounded-xl group-hover:bg-black group-hover:text-white transition-colors whitespace-nowrap text-center">Review</button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- RESPONSIVE CALENDAR VIEW --- */}
      <div className="bg-white rounded-[1.5rem] sm:rounded-[2.5rem] p-4 sm:p-8 border border-zinc-200 shadow-sm overflow-hidden w-full">
        <div className="overflow-x-auto w-full custom-scrollbar pb-4 sm:pb-0">
          <div className="min-w-[768px]">
            <div className="grid grid-cols-7 gap-2 sm:gap-4 mb-2 sm:mb-4">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-wider py-1 sm:py-2">{day}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-2 sm:gap-4">
              {paddingDays.map(day => <div key={`empty-${day}`} className="min-h-[100px] sm:min-h-[120px] rounded-xl sm:rounded-2xl bg-zinc-50/50 border border-zinc-100/50" />)}
              
              {days.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const dayTickets = ticketsByDate[dayStr] || [];
                const isCurrentDay = isToday(day);
                
                return (
                  <div key={day.toISOString()} className={cn("min-h-[100px] sm:min-h-[120px] rounded-xl sm:rounded-2xl p-2 sm:p-3 border transition-colors flex flex-col gap-1 sm:gap-2", isCurrentDay ? "bg-black/5 border-black/10" : "bg-white border-zinc-200 hover:border-black/20")}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn("text-xs sm:text-sm font-bold w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg sm:rounded-xl", isCurrentDay ? "bg-black text-white shadow-md" : "text-zinc-700")}>{format(day, 'd')}</span>
                    </div>
                    
                    <div className="space-y-1.5 sm:space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-1">
                      {dayTickets.map(ticket => {
                        const dist = distMap[ticket.distributorId];
                        const auditorNames = ticket.auditorIds && ticket.auditorIds.length > 0 
                          ? ticket.auditorIds.map(id => userMap[id]?.name.split(' ')[0]).join(', ')
                          : userMap[ticket.auditorId || '']?.name.split(' ')[0] || 'Assigned';

                        return (
                          <div 
                            key={ticket.id} 
                            onClick={() => {
                              if (ticket.status === 'tentative') {
                                setNegotiationTicket(ticket);
                              } else if (isAdminOrHO) {
                                setEditingActiveTicket(ticket);
                                setEditTicketData({
                                  scheduledDate: ticket.scheduledDate || '',
                                  auditorIds: ticket.auditorIds || (ticket.auditorId ? [ticket.auditorId] : []),
                                  auditDays: ticket.auditDays || 1
                                });
                              }
                            }} 
                            className={cn(
                              "p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs border transition-all", 
                              ticket.status === 'tentative' ? "bg-amber-50 border-amber-200 hover:shadow-md cursor-pointer hover:-translate-y-0.5" : 
                              cn("bg-emerald-50 border-emerald-100/50", isAdminOrHO ? "cursor-pointer hover:shadow-md hover:border-emerald-300" : "cursor-default")
                            )} 
                            title={ticket.status === 'tentative' ? 'Click to negotiate dates' : (isAdminOrHO ? 'Click to edit assignment' : 'Scheduled')}
                          >
                            <p className="font-bold text-zinc-900 truncate mb-0.5 sm:mb-1 leading-tight">{dist?.name || 'Unknown'}</p>
                            {ticket.status === 'tentative' ? (
                              <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-amber-600 uppercase"><Clock size={10} /> Needs Approval</div>
                            ) : (
                              <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-medium text-emerald-700 bg-emerald-100/50 px-1 sm:px-1.5 py-0.5 rounded">
                                <Store size={10} className="shrink-0" /><span className="truncate">{auditorNames}</span>
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
        </div>
      </div>

      {/* --- EDIT ACTIVE/SCHEDULED TICKET MODAL --- */}
      <AnimatePresence>
        {editingActiveTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setEditingActiveTicket(null); setAuditorSearch(''); }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden p-5 sm:p-8 flex flex-col max-h-[90vh]">
              <div className="flex justify-between items-start sm:items-center mb-5 sm:mb-6 shrink-0">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2"><Edit2 size={18} className="text-blue-600 sm:w-5 sm:h-5" /> Edit Assignment</h3>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-1">{distMap[editingActiveTicket.distributorId]?.name}</p>
                </div>
                <button onClick={() => { setEditingActiveTicket(null); setAuditorSearch(''); }} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg sm:rounded-xl shrink-0"><X size={18} className="sm:w-5 sm:h-5"/></button>
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1 pr-2">
                <form id="edit-ticket-form" onSubmit={handleEditActiveTicketSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Start Date</label>
                      <input required type="date" className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={editTicketData.scheduledDate} onChange={e => setEditTicketData({...editTicketData, scheduledDate: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Duration</label>
                      <select required className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={editTicketData.auditDays} onChange={e => setEditTicketData({...editTicketData, auditDays: parseInt(e.target.value)})}>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Day{n>1?'s':''}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1 block">Assign Auditors</label>
                    <div className="mb-2 relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="Search auditors by name..." 
                        className="w-full pl-8 pr-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs focus:ring-2 focus:ring-black outline-none transition-all"
                        value={auditorSearch}
                        onChange={(e) => setAuditorSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-xl p-2 sm:p-3 bg-zinc-50 grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 custom-scrollbar">
                      {displayedAuditors.length > 0 ? displayedAuditors.map(a => (
                        <label key={a.uid} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg">
                          <input 
                            type="checkbox" 
                            checked={editTicketData.auditorIds.includes(a.uid)}
                            onChange={(e) => {
                              const newIds = e.target.checked ? [...editTicketData.auditorIds, a.uid] : editTicketData.auditorIds.filter(id => id !== a.uid);
                              setEditTicketData({ ...editTicketData, auditorIds: newIds });
                            }}
                            className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-zinc-300 text-black focus:ring-black"
                          />
                          <span className="text-xs sm:text-sm font-medium text-zinc-700 truncate">{a.name}</span>
                        </label>
                      )) : (
                        <div className="col-span-full text-center py-4 text-xs font-medium text-zinc-400">No auditors found.</div>
                      )}
                    </div>
                  </div>
                </form>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 pt-4 border-t border-zinc-100 shrink-0 mt-4">
                <button type="button" onClick={() => deleteTicket(editingActiveTicket.id)} className="w-full sm:w-auto px-4 py-3 sm:py-4 bg-red-50 text-red-600 rounded-xl sm:rounded-2xl font-bold hover:bg-red-100 transition-colors flex justify-center items-center gap-2" title="Delete Ticket">
                  <Trash2 size={18} className="sm:w-5 sm:h-5" /> <span className="sm:hidden">Delete Ticket</span>
                </button>
                <button type="submit" form="edit-ticket-form" className="w-full sm:flex-1 py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 text-sm sm:text-base">
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- NEGOTIATION & SCHEDULING MODAL --- */}
      <AnimatePresence>
        {negotiationTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setNegotiationTicket(null); setAuditorSearch(''); }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-2xl bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="p-4 sm:p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-50 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0"><CalendarIcon className="text-amber-600 sm:w-5 sm:h-5" size={18} /></div>
                  <div><h4 className="text-lg sm:text-xl font-bold tracking-tight">Date Negotiation</h4><p className="text-[10px] sm:text-sm text-zinc-500 truncate max-w-[200px] sm:max-w-[250px]">{distMap[negotiationTicket.distributorId]?.name}</p></div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  {isAdminOrHO && <button onClick={() => deleteTicket(negotiationTicket.id)} className="p-1.5 sm:p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg sm:rounded-xl transition-colors" title="Delete this ticket"><Trash2 size={18} className="sm:w-5 sm:h-5" /></button>}
                  <button onClick={() => { setNegotiationTicket(null); setAuditorSearch(''); }} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg sm:rounded-xl transition-colors"><X size={18} className="sm:w-5 sm:h-5" /></button>
                </div>
              </div>
              
              <div className="p-4 sm:p-6 md:p-8 overflow-y-auto bg-zinc-50/50 flex-1 space-y-4 sm:space-y-6 custom-scrollbar min-h-0">
                {(!negotiationTicket.dateProposals || negotiationTicket.dateProposals.length === 0) ? (
                  <div className="text-center py-6 sm:py-8 text-zinc-400"><MessageSquare size={28} className="mx-auto mb-2 sm:mb-3 opacity-50 sm:w-8 sm:h-8" /><p className="text-xs sm:text-sm font-medium">No messages yet.</p></div>
                ) : (
                  negotiationTicket.dateProposals.map((prop) => (
                    <div key={prop.id} className="bg-white border border-zinc-200 rounded-xl sm:rounded-2xl p-4 sm:p-5 shadow-sm">
                      <div className="flex justify-between items-start mb-2 sm:mb-3">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-zinc-100 flex items-center justify-center text-[10px] sm:text-xs font-bold text-zinc-600 shrink-0">{prop.proposedByName.charAt(0)}</div>
                          <div><p className="text-xs sm:text-sm font-bold text-zinc-900">{prop.proposedByName}</p><div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5"><span className="text-zinc-500 uppercase font-black tracking-wider text-[8px] sm:text-[9px] bg-zinc-100 px-1 sm:px-1.5 py-0.5 rounded">{prop.role}</span><span className="text-[10px] sm:text-xs text-zinc-400">{prop.email}</span></div></div>
                        </div>
                        <span className="text-[9px] sm:text-[10px] text-zinc-400 font-medium shrink-0">{new Date(prop.timestamp).toLocaleDateString()}</span>
                      </div>
                      
                      <div className="pl-8 sm:pl-11 space-y-2 sm:space-y-3">
                        {prop.date && <div className="inline-flex items-center gap-1.5 sm:gap-2 bg-amber-50 text-amber-700 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg border border-amber-100 text-xs sm:text-sm font-bold"><CalendarIcon size={12} className="sm:w-[14px] sm:h-[14px]" /> Proposed: {format(new Date(prop.date), 'dd MMM yyyy')}</div>}
                        {prop.remarks && <p className="text-xs sm:text-sm text-zinc-600 bg-zinc-50 p-2 sm:p-3 rounded-lg sm:rounded-xl border border-zinc-100">"{prop.remarks}"</p>}
                        
                        {isAdminOrHO && prop.date && (
                          <div className="pt-3 sm:pt-4 mt-2 sm:mt-3 border-t border-zinc-100 flex flex-col gap-2 sm:gap-3">
                            <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">Assign Auditors for Approval</label>
                            
                            <div className="mb-1 relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                              <input 
                                type="text" 
                                placeholder="Search auditors..." 
                                className="w-full pl-8 pr-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:ring-2 focus:ring-black outline-none transition-all"
                                value={auditorSearch}
                                onChange={(e) => setAuditorSearch(e.target.value)}
                              />
                            </div>

                            <div className="max-h-24 sm:max-h-32 overflow-y-auto border border-zinc-200 rounded-lg sm:rounded-xl p-2 sm:p-3 bg-zinc-50 grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 custom-scrollbar">
                              {displayedAuditors.length > 0 ? displayedAuditors.map(a => (
                                <label key={a.uid} className="flex items-center gap-2 cursor-pointer p-1 sm:p-1.5 hover:bg-zinc-100 rounded-md sm:rounded-lg">
                                  <input 
                                    type="checkbox" 
                                    checked={approvalAuditorIds.includes(a.uid)}
                                    onChange={(e) => {
                                      const newIds = e.target.checked ? [...approvalAuditorIds, a.uid] : approvalAuditorIds.filter(id => id !== a.uid);
                                      setApprovalAuditorIds(newIds);
                                    }}
                                    className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-zinc-300 text-black focus:ring-black"
                                  />
                                  <span className="text-xs sm:text-sm font-medium text-zinc-700 truncate">{a.name}</span>
                                </label>
                              )) : (
                                <div className="col-span-full text-center py-2 text-[10px] sm:text-xs text-zinc-400">No auditors found.</div>
                              )}
                            </div>

                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                              <select className="w-full sm:w-32 text-xs sm:text-sm p-2 sm:p-2 rounded-lg sm:rounded-xl bg-zinc-50 border border-zinc-200 focus:ring-2 focus:ring-black cursor-pointer" value={approvalAuditDays} onChange={(e) => setApprovalAuditDays(parseInt(e.target.value))}>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Day{n>1?'s':''}</option>)}
                              </select>
                              <button onClick={() => approveAndSchedule(prop.date)} className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs sm:text-sm font-bold rounded-lg sm:rounded-xl hover:bg-emerald-600 transition-colors">
                                <CheckCircle2 size={14} className="sm:w-4 sm:h-4" /> Approve & Assign
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 sm:p-6 md:p-8 bg-white border-t border-zinc-100 shrink-0">
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (isAdminOrHO && approvalAuditorIds.length > 0) {
                    if (!proposalData.date) return alert("Select a date to schedule.");
                    approveAndSchedule(proposalData.date);
                  } else {
                    submitProposal(e);
                  }
                }} className="space-y-3 sm:space-y-4">
                  <h5 className="text-xs sm:text-sm font-bold tracking-tight text-zinc-900">{isAdminOrHO ? "Suggest a Date & Assign" : "Add a Reply or Suggest a Date"}</h5>
                  <div className="grid grid-cols-1 gap-3 sm:gap-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full">
                      <input type="date" min={new Date().toISOString().split('T')[0]} className="w-full sm:w-40 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black transition-all text-xs sm:text-sm font-medium text-zinc-700 cursor-pointer shrink-0" value={proposalData.date} onChange={e => setProposalData({...proposalData, date: e.target.value})} />
                      <div className={cn("relative flex-1")}>
                        <input type="text" placeholder="Type message..." className="w-full pl-3 sm:pl-4 pr-10 sm:pr-12 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black transition-all text-xs sm:text-sm" value={proposalData.remarks} onChange={e => setProposalData({...proposalData, remarks: e.target.value})} />
                        <button type="submit" className="absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 bg-black text-white rounded-lg hover:bg-zinc-800 transition-colors"><Send size={14} className="sm:w-[14px] sm:h-[14px]" /></button>
                      </div>
                    </div>

                    {isAdminOrHO && (
                      <div className="p-3 sm:p-4 border border-zinc-200 rounded-xl bg-zinc-50 mt-1 sm:mt-2">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-2 gap-2">
                          <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 shrink-0">Assign Auditors</label>
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <div className="relative flex-1 sm:w-40">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" size={12} />
                              <input 
                                type="text" 
                                placeholder="Search..." 
                                className="w-full pl-6 pr-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[10px] sm:text-xs focus:ring-1 focus:ring-black outline-none"
                                value={auditorSearch}
                                onChange={(e) => setAuditorSearch(e.target.value)}
                              />
                            </div>
                            <select className="w-24 sm:w-28 text-[10px] sm:text-xs p-1 sm:p-1.5 rounded-lg bg-white border border-zinc-200 focus:ring-2 focus:ring-black cursor-pointer shrink-0" value={approvalAuditDays} onChange={(e) => setApprovalAuditDays(parseInt(e.target.value))}>
                              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Day{n>1?'s':''}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="max-h-20 sm:max-h-24 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 sm:gap-2 custom-scrollbar">
                          {displayedAuditors.length > 0 ? displayedAuditors.map(a => (
                            <label key={a.uid} className="flex items-center gap-1.5 sm:gap-2 cursor-pointer p-1 hover:bg-zinc-100 rounded-md">
                              <input 
                                type="checkbox" 
                                checked={approvalAuditorIds.includes(a.uid)}
                                onChange={(e) => {
                                  const newIds = e.target.checked ? [...approvalAuditorIds, a.uid] : approvalAuditorIds.filter(id => id !== a.uid);
                                  setApprovalAuditorIds(newIds);
                                }}
                                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-zinc-300 text-black focus:ring-black"
                              />
                              <span className="text-[10px] sm:text-xs font-medium text-zinc-700 truncate">{a.name}</span>
                            </label>
                          )) : (
                            <div className="col-span-full text-center py-2 text-[10px] sm:text-xs text-zinc-400">No auditors found.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- FORCE SCHEDULE MODAL --- */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsCreateModalOpen(false); setAuditorSearch(''); }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="flex justify-between items-center p-5 sm:p-6 border-b border-zinc-100 shrink-0">
                <h3 className="text-lg sm:text-xl font-bold">Force Schedule Audit</h3>
                <button onClick={() => { setIsCreateModalOpen(false); setAuditorSearch(''); }} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg sm:rounded-xl"><X size={18} className="sm:w-5 sm:h-5"/></button>
              </div>

              <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                <form id="force-schedule-form" onSubmit={handleCreateSubmit} className="space-y-3 sm:space-y-4">
                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Select Distributor</label>
                    <select required className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={createData.distributorId} onChange={e => setCreateData({...createData, distributorId: e.target.value})}>
                      <option value="">Choose a distributor...</option>
                      {distributors.filter(d => d.active).map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Start Date</label>
                      <input required type="date" min={new Date().toISOString().split('T')[0]} className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={createData.proposedDate} onChange={e => setCreateData({...createData, proposedDate: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Duration</label>
                      <select required className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={createData.auditDays} onChange={e => setCreateData({...createData, auditDays: parseInt(e.target.value)})}>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Day{n>1?'s':''}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1 block">Assign Auditors</label>
                    <div className="mb-2 relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="Search auditors by name..." 
                        className="w-full pl-8 pr-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs focus:ring-2 focus:ring-black outline-none transition-all"
                        value={auditorSearch}
                        onChange={(e) => setAuditorSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-32 sm:max-h-40 overflow-y-auto border border-zinc-200 rounded-xl p-2 sm:p-3 bg-zinc-50 grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 custom-scrollbar">
                      {displayedAuditors.length > 0 ? displayedAuditors.map(a => (
                        <label key={a.uid} className="flex items-center gap-2 cursor-pointer p-1 sm:p-1.5 hover:bg-zinc-100 rounded-lg">
                          <input 
                            type="checkbox" 
                            checked={createData.auditorIds.includes(a.uid)}
                            onChange={(e) => {
                              const newIds = e.target.checked 
                                ? [...createData.auditorIds, a.uid] 
                                : createData.auditorIds.filter(id => id !== a.uid);
                              setCreateData({ ...createData, auditorIds: newIds });
                            }}
                            className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-zinc-300 text-black focus:ring-black"
                          />
                          <span className="text-xs sm:text-sm font-medium text-zinc-700 truncate">{a.name}</span>
                        </label>
                      )) : (
                        <div className="col-span-full text-center py-4 text-xs font-medium text-zinc-400">No auditors found.</div>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              <div className="p-5 sm:p-6 border-t border-zinc-100 shrink-0">
                <button type="submit" form="force-schedule-form" className="w-full py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 text-sm sm:text-base">Schedule Audit</button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}