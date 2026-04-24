import React, { useEffect, useState, useMemo } from 'react';
import { supabase, logActivity, notifyLinkedUsers } from '../supabase'; // NEW: Added notifyLinkedUsers
import { AuditTicket, Distributor, UserProfile, DateProposal } from '../types';
import { Calendar as CalendarIcon, Plus, Store, MapPin, CheckCircle2, X, Send, AlertCircle, MessageSquare, Filter, Trash2, CalendarCheck, ChevronLeft, ChevronRight, Clock, Edit2, Search } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday } from 'date-fns';

export function SchedulerModule() {
  const { user, profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<any[]>([]); 
  const [auditors, setAuditors] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]); 
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // --- UNIFIED NEGOTIATION STATE ---
  const [isNegotiationModalOpen, setIsNegotiationModalOpen] = useState(false);
  const [negFilterAseId, setNegFilterAseId] = useState('');
  const [negDistId, setNegDistId] = useState('');
  const [replyDistId, setReplyDistId] = useState('');
  const [proposalData, setProposalData] = useState({ date: '', remarks: '' });
  
  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [isHeaderSearchOpen, setIsHeaderSearchOpen] = useState(false);

  const [editingActiveTicket, setEditingActiveTicket] = useState<AuditTicket | null>(null);
  const [editTicketData, setEditTicketData] = useState({ scheduledDate: '', auditorIds: [] as string[], auditDays: 1 });

  const [pendingTab, setPendingTab] = useState<'action' | 'waiting'>('action');
  const [pendingFilterAse, setPendingFilterAse] = useState<string>('all');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createAseId, setCreateAseId] = useState('');
  const [createData, setCreateData] = useState({ distributorId: '', proposedDate: '', auditDays: 1 });
  
  const [approvalAuditDays, setApprovalAuditDays] = useState(1);
  const [auditorSearch, setAuditorSearch] = useState('');

  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');

  const distMap = useMemo(() => {
    const map: Record<string, any> = {};
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

  const displayedAuditors = useMemo(() => {
    if (!auditorSearch.trim()) return auditors;
    return auditors.filter(a => a.name.toLowerCase().includes(auditorSearch.toLowerCase()));
  }, [auditors, auditorSearch]);

  const currentNegTicket = useMemo(() => {
    if (!negDistId) return null;
    return tickets.find(t => t.distributorId === negDistId && ['tentative', 'scheduled'].includes(t.status)) || null;
  }, [negDistId, tickets]);

  const headerFilteredDistributors = useMemo(() => {
    if (!headerSearchTerm.trim()) return distributors;
    return distributors.filter(d => 
      d.name.toLowerCase().includes(headerSearchTerm.toLowerCase()) || 
      d.code.toLowerCase().includes(headerSearchTerm.toLowerCase())
    );
  }, [distributors, headerSearchTerm]);

  useEffect(() => { setReplyDistId(negDistId); }, [negDistId]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;
      try {
        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase') dQuery = dQuery.contains('aseIds', [profile.uid]);
        else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm') dQuery = dQuery.contains('smIds', [profile.uid]);
        else if (profile.role === 'dm') dQuery = dQuery.contains('dmIds', [profile.uid]);
        
        const [dRes, uRes] = await Promise.all([dQuery, supabase.from('users').select('*')]);
        if (dRes.error) throw dRes.error;
        
        const fetchedDistributors = (dRes.data || []) as any[];
        setDistributors(fetchedDistributors);
        
        if (uRes.data) {
          const usersList = uRes.data as UserProfile[];
          setAllUsers(usersList);
          setAuditors(usersList.filter(u => u.role === 'auditor'));
        }

        let tQuery = supabase.from('auditTickets').select('*');
        if (profile.role === 'auditor') {
          tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
          const distIds = fetchedDistributors.map(d => d.id);
          if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
          else return setTickets([]);
        }

        const tRes = await tQuery;
        if (tRes.error) throw tRes.error;
        if (tRes.data) {
          const validTickets = (tRes.data as AuditTicket[]).filter(t => fetchedDistributors.some(d => d.id === t.distributorId));
          setTickets(validTickets);
        }
      } catch (error) { console.error("Error fetching scheduler data:", error); }
    };

    fetchData();
    const channel = supabase.channel('scheduler-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.uid, profile?.role]);

  const deleteTicket = async (ticketId: string) => {
    if (window.confirm("Are you sure you want to permanently delete this ticket?")) {
      try {
        await supabase.from('auditLineItems').delete().eq('ticketId', ticketId);
        await supabase.from('auditTickets').delete().eq('id', ticketId);
        setEditingActiveTicket(null);
        if (currentNegTicket?.id === ticketId) setNegDistId('');
        setAuditorSearch('');
      } catch (error) { console.error("Error deleting ticket:", error); }
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createData.distributorId) return alert("Please select a distributor.");

    try {
      const dist = distMap[createData.distributorId];
      if (!dist) return;

      const existingTicket = tickets.find(t => t.distributorId === createData.distributorId && t.status === 'tentative');

      if (existingTicket) {
        await supabase.from('auditTickets').update({
          proposedDate: createData.proposedDate,
          scheduledDate: createData.proposedDate,
          auditDays: createData.auditDays,
          status: 'scheduled',
          updatedAt: new Date().toISOString()
        }).eq('id', existingTicket.id);
      } else {
        const newTicket: Partial<AuditTicket> = {
          id: Math.random().toString(36).substring(7),
          distributorId: createData.distributorId,
          proposedDate: createData.proposedDate,
          auditorIds: [], 
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
      
      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(createData.distributorId, "Audit Scheduled", `An audit has been scheduled for ${dist?.name} on ${createData.proposedDate}.`);

      setIsCreateModalOpen(false);
      setCreateData({ distributorId: '', proposedDate: '', auditDays: 1 });
      setCreateAseId('');
    } catch (error) { console.error("Error creating audit ticket:", error); }
  };

  const handleEditActiveTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingActiveTicket) return;

    try {
      await supabase.from('auditTickets').update({
        scheduledDate: editTicketData.scheduledDate,
        proposedDate: editTicketData.scheduledDate,
        auditorIds: editTicketData.auditorIds,
        auditDays: editTicketData.auditDays,
        updatedAt: new Date().toISOString()
      }).eq('id', editingActiveTicket.id);

      const dist = distMap[editingActiveTicket.distributorId];
      logActivity(user, profile, "Audit Re-scheduled/Assigned", `${profile?.role.toUpperCase()} modified the schedule/auditors for ${dist?.name}`);

      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(editingActiveTicket.distributorId, "Schedule Updated", `The audit schedule and/or auditors for ${dist?.name} have been updated.`);

      setEditingActiveTicket(null);
      setAuditorSearch('');
    } catch (error) { console.error("Error updating ticket:", error); }
  };

  const handleAdminRequestDate = async () => {
    if (!user || !profile || !negDistId) return;
    
    try {
      const newProposal: DateProposal = {
        id: Math.random().toString(36).substring(7),
        date: '',
        proposedByUserId: user.id,
        proposedByName: profile.name,
        role: profile.role,
        email: profile.email,
        remarks: "Please propose a date for the upcoming audit.",
        timestamp: new Date().toISOString()
      };

      if (currentNegTicket) {
        const updatedProposals = [...(currentNegTicket.dateProposals || []), newProposal];
        await supabase.from('auditTickets').update({ dateProposals: updatedProposals, updatedAt: new Date().toISOString() }).eq('id', currentNegTicket.id);
      } else {
        const dist = distMap[negDistId];
        const newTicket: Partial<AuditTicket> = {
          id: Math.random().toString(36).substring(7), distributorId: negDistId, proposedDate: null, auditorIds: [], auditDays: 1, approvedValue: dist.approvedValue, maxAllowedValue: dist.approvedValue * 1.05, status: 'tentative', scheduledDate: null, verifiedTotal: 0, presenceLogs: [], signOffs: {}, media: [], dateProposals: [newProposal], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        await supabase.from('auditTickets').insert([newTicket]);
        logActivity(user, profile, "Date Requested", `Admin requested a date proposal from ASE for ${dist?.name}`);
      }

      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(negDistId, "Date Requested", `Admin requested a date proposal for ${distMap[negDistId]?.name}.`);

      setProposalData({ date: '', remarks: '' });
    } catch (error) { console.error("Error requesting date:", error); }
  };

  const submitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const finalTargetDistId = replyDistId || negDistId;
    if (!finalTargetDistId) return alert("Please select a distributor first.");

    if (!isAdminOrHO && !proposalData.date) {
      return alert("You must select a proposed date before submitting.");
    }
    if (isAdminOrHO && !proposalData.date && !proposalData.remarks.trim()) {
      return alert("Please provide a date or a message to send.");
    }

    const targetTicket = tickets.find(t => t.distributorId === finalTargetDistId && ['tentative', 'scheduled'].includes(t.status));
    
    let rescheduleReason = "";
    if (targetTicket && targetTicket.status === 'scheduled' && !isAdminOrHO) {
      rescheduleReason = window.prompt("⚠️ This audit is already scheduled and confirmed.\n\nPlease provide a mandatory reason for requesting this reschedule:") || "";
      if (!rescheduleReason.trim()) {
        return alert("Reschedule Cancelled: A valid reason is required to alter a confirmed schedule.");
      }
    }

    const finalRemarks = rescheduleReason 
      ? `🚨 Reschedule Reason: ${rescheduleReason}${proposalData.remarks ? ` | Notes: ${proposalData.remarks}` : ''}`
      : proposalData.remarks;

    try {
      const newProposal: DateProposal = {
        id: Math.random().toString(36).substring(7),
        date: proposalData.date || '',
        proposedByUserId: user.id,
        proposedByName: profile.name,
        role: profile.role,
        email: profile.email,
        remarks: finalRemarks,
        timestamp: new Date().toISOString()
      };

      if (finalTargetDistId !== negDistId && currentNegTicket) {
        const targetDistName = distMap[finalTargetDistId]?.name;
        const redirectProposal: DateProposal = {
          id: Math.random().toString(36).substring(7), date: proposalData.date || '', proposedByUserId: user.id, proposedByName: profile.name, role: profile.role, email: profile.email, remarks: `Counter-proposed for a different distributor: ${targetDistName}. ${finalRemarks ? `Remarks: ${finalRemarks}` : ''}`, timestamp: new Date().toISOString()
        };
        const updatedOldProposals = [...(currentNegTicket.dateProposals || []), redirectProposal];
        
        const oldTicketStatus = currentNegTicket.status === 'scheduled' && !isAdminOrHO ? 'tentative' : currentNegTicket.status;
        await supabase.from('auditTickets').update({ dateProposals: updatedOldProposals, status: oldTicketStatus, updatedAt: new Date().toISOString() }).eq('id', currentNegTicket.id);
      }

      if (targetTicket) {
        const updatedProposals = [...(targetTicket.dateProposals || []), newProposal];
        const newMainDate = proposalData.date ? proposalData.date : targetTicket.proposedDate;
        
        const newStatus = targetTicket.status === 'scheduled' && !isAdminOrHO ? 'tentative' : targetTicket.status;

        await supabase.from('auditTickets').update({ proposedDate: newMainDate, dateProposals: updatedProposals, status: newStatus, updatedAt: new Date().toISOString() }).eq('id', targetTicket.id);
        
        if (newStatus === 'tentative' && targetTicket.status === 'scheduled') {
           logActivity(user, profile, "Reschedule Requested", `ASE requested a reschedule for ${distMap[finalTargetDistId]?.name}. Reason: "${rescheduleReason}"`);
        }
      } else {
        const dist = distMap[finalTargetDistId];
        const newTicket: Partial<AuditTicket> = {
          id: Math.random().toString(36).substring(7), distributorId: finalTargetDistId, proposedDate: proposalData.date || null, auditorIds: [], auditDays: 1, approvedValue: dist.approvedValue, maxAllowedValue: dist.approvedValue * 1.05, status: 'tentative', scheduledDate: null, verifiedTotal: 0, presenceLogs: [], signOffs: {}, media: [], dateProposals: [newProposal], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        await supabase.from('auditTickets').insert([newTicket]);
        logActivity(user, profile, "Date Proposed", `${profile?.role.toUpperCase()} initiated a date proposal for ${dist?.name}`);
      }

      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(finalTargetDistId, "New Message / Proposal", `${profile.name} has submitted a new date proposal or message for ${distMap[finalTargetDistId]?.name}.`);

      setProposalData({ date: '', remarks: '' });
      setNegDistId(finalTargetDistId); 
    } catch (error) { console.error("Error submitting proposal:", error); }
  };

  const cancelAssignment = async () => {
    if (!currentNegTicket || !user || !profile) return;
    
    const cancelReason = window.prompt("⚠️ You are cancelling an audit on the day of execution past 12 PM.\n\nPlease provide a mandatory reason for this late cancellation:");
    if (!cancelReason?.trim()) return alert("Cancellation aborted: A valid reason is required.");

    try {
      const finalRemarks = `🚨 LATE CANCELLATION (Past 12 PM): ${cancelReason}`;
      const newProposal: DateProposal = {
        id: Math.random().toString(36).substring(7),
        date: '',
        proposedByUserId: user.id,
        proposedByName: profile.name,
        role: profile.role,
        email: profile.email,
        remarks: finalRemarks,
        timestamp: new Date().toISOString()
      };

      const updatedProposals = [...(currentNegTicket.dateProposals || []), newProposal];

      await supabase.from('auditTickets').update({ 
        status: 'tentative', 
        scheduledDate: null, 
        proposedDate: null, 
        dateProposals: updatedProposals, 
        updatedAt: new Date().toISOString() 
      }).eq('id', currentNegTicket.id);
      
      const dist = distMap[currentNegTicket.distributorId];
      logActivity(user, profile, "Audit Cancelled", `ASE cancelled the audit for ${dist?.name} past 12 PM on execution day. Reason: "${cancelReason}"`);

      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(currentNegTicket.distributorId, "Audit Cancelled", `The audit for ${dist?.name} was cancelled late by ${profile.name}. Reason: "${cancelReason}"`);

      setIsNegotiationModalOpen(false);
      setNegDistId('');
      alert("Audit has been cancelled and returned to the Admin for review.");
    } catch (error) {
      console.error("Error cancelling assignment:", error);
      alert("Failed to cancel the assignment.");
    }
  };

  const approveAndSchedule = async (proposalDate: string) => {
    if (!currentNegTicket) return;
    try {
      await supabase.from('auditTickets').update({ status: 'scheduled', scheduledDate: proposalDate, auditDays: approvalAuditDays, updatedAt: new Date().toISOString() }).eq('id', currentNegTicket.id);
      const dist = distMap[currentNegTicket.distributorId];
      logActivity(user, profile, "Date Approved", `${profile?.role.toUpperCase()} approved date proposal for ${dist?.name} on ${proposalDate}`);
      
      // 💥 NEW: Send Personal Notification
      notifyLinkedUsers(currentNegTicket.distributorId, "Schedule Approved", `The audit schedule for ${dist?.name} has been approved for ${proposalDate}.`);

      setIsNegotiationModalOpen(false);
      setNegDistId('');
      setApprovalAuditDays(1);
    } catch (error) { console.error("Error approving schedule:", error); }
  };

  const openNegotiationModal = (distId: string) => {
    setNegDistId(distId);
    setProposalData({ date: '', remarks: '' });
    setIsNegotiationModalOpen(true);
    setHeaderSearchTerm('');
    setIsHeaderSearchOpen(false);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();
  const paddingDays = Array.from({ length: startDayOfWeek }).map((_, i) => i);

  const allPendingTickets = useMemo(() => tickets.filter(t => t.status === 'tentative'), [tickets]);
  
  const uniquePendingAseIds = useMemo(() => {
    const ids = new Set<string>();
    allPendingTickets.forEach(t => {
      const dist = distMap[t.distributorId];
      if (dist && dist.aseIds) { dist.aseIds.forEach((id: string) => ids.add(id)); }
    });
    return Array.from(ids);
  }, [allPendingTickets, distMap]);

  const filteredPendingTickets = useMemo(() => {
    return allPendingTickets.filter(t => {
      if (pendingFilterAse !== 'all') {
        const dist = distMap[t.distributorId];
        return dist && dist.aseIds && dist.aseIds.includes(pendingFilterAse);
      }
      return true;
    });
  }, [allPendingTickets, pendingFilterAse, distMap]);

  const isPendingAdmin = (ticket: AuditTicket) => {
    const last = ticket.dateProposals?.[ticket.dateProposals.length - 1];
    return last && ['ase', 'asm', 'sm', 'dm'].includes(last.role);
  };

  const isPendingASE = (ticket: AuditTicket) => {
    const last = ticket.dateProposals?.[ticket.dateProposals.length - 1];
    return !last || ['superadmin', 'admin', 'ho'].includes(last.role);
  };

  const actionRequiredTickets = useMemo(() => filteredPendingTickets.filter(t => isAdminOrHO ? isPendingAdmin(t) : isPendingASE(t)), [filteredPendingTickets, isAdminOrHO]);
  const waitingTickets = useMemo(() => filteredPendingTickets.filter(t => isAdminOrHO ? isPendingASE(t) : isPendingAdmin(t)), [filteredPendingTickets, isAdminOrHO]);
  const displayTickets = pendingTab === 'action' ? actionRequiredTickets : waitingTickets;

  useEffect(() => {
    if (actionRequiredTickets.length === 0 && waitingTickets.length > 0 && pendingTab === 'action') {
      setPendingTab('waiting');
    }
  }, [actionRequiredTickets.length, waitingTickets.length, pendingTab]);

  const todayObj = new Date();
  const localOffset = todayObj.getTimezoneOffset();
  const localToday = new Date(todayObj.getTime() - (localOffset * 60000));
  const localTodayStr = localToday.toISOString().split('T')[0];
  
  const isTodayAudit = currentNegTicket?.scheduledDate === localTodayStr;
  const isPastNoon = todayObj.getHours() >= 12;
  const canCancelToday = !isAdminOrHO && currentNegTicket?.status === 'scheduled' && isTodayAudit && isPastNoon;

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4 bg-white p-2 rounded-2xl shadow-sm border border-zinc-200">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><ChevronLeft size={20} className="w-5 h-5" /></button>
          <h3 className="text-base sm:text-lg font-bold min-w-[120px] sm:min-w-[150px] text-center">{format(currentMonth, 'MMMM yyyy')}</h3>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><ChevronRight size={20} className="w-5 h-5" /></button>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          
          {(isAdminOrHO || profile?.role === 'ase') && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input 
                type="text" 
                placeholder="Search dist to propose date..." 
                className="w-full pl-10 pr-4 py-3 sm:py-3.5 bg-white border border-zinc-200 text-black rounded-xl font-bold focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm"
                value={headerSearchTerm}
                onChange={e => { setHeaderSearchTerm(e.target.value); setIsHeaderSearchOpen(true); }}
                onFocus={() => setIsHeaderSearchOpen(true)}
                onBlur={() => setTimeout(() => setIsHeaderSearchOpen(false), 200)}
              />
              <AnimatePresence>
                {isHeaderSearchOpen && headerFilteredDistributors.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute top-full mt-2 left-0 w-full bg-white border border-zinc-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar flex flex-col p-1">
                    {headerFilteredDistributors.map(dist => (
                      <button key={dist.id} onClick={() => openNegotiationModal(dist.id)} className="text-left px-3 py-2.5 hover:bg-zinc-50 rounded-lg transition-colors flex items-center gap-3 w-full">
                        <Store size={14} className="text-zinc-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-zinc-900 truncate">{dist.name}</p>
                          <p className="text-[10px] text-zinc-500 font-mono truncate">{dist.code}</p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {isAdminOrHO && (
            <button onClick={() => setIsCreateModalOpen(true)} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-md active:scale-95 text-sm">
              <Plus size={18} /> Force Schedule
            </button>
          )}
        </div>
      </div>

      {allPendingTickets.length > 0 && (
        <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm overflow-hidden mb-6 sm:mb-8 w-full">
          <div className="p-4 sm:p-6 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/50">
            <div className="flex items-center gap-4 overflow-x-auto custom-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex bg-zinc-200/50 p-1 rounded-xl w-max">
                <button onClick={() => setPendingTab('action')} className={cn("px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap", pendingTab === 'action' ? (isAdminOrHO ? "bg-white text-amber-600 shadow-sm" : "bg-white text-blue-600 shadow-sm") : "text-zinc-500 hover:text-black")}>
                  {isAdminOrHO ? 'Needs Approval' : 'Action Required'} <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]", pendingTab === 'action' ? (isAdminOrHO ? "bg-amber-100" : "bg-blue-100") : "bg-zinc-200")}>{actionRequiredTickets.length}</span>
                </button>
                <button onClick={() => setPendingTab('waiting')} className={cn("px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap", pendingTab === 'waiting' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-black")}>
                  {isAdminOrHO ? 'Waiting on ASE' : 'Pending Admin'} <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]", pendingTab === 'waiting' ? "bg-zinc-100" : "bg-zinc-200")}>{waitingTickets.length}</span>
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
                  const aseNames = dist?.aseIds?.length > 0 
                    ? dist.aseIds.map((id: string) => userMap[id]?.name.split(' ')[0]).filter(Boolean).join(', ')
                    : 'Unassigned';
                  const lastProposal = ticket.dateProposals?.[ticket.dateProposals.length - 1];

                  return (
                    <motion.div layout key={ticket.id} onClick={() => openNegotiationModal(ticket.distributorId)} className={cn("bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 group", pendingTab === 'action' ? (isAdminOrHO ? "border-amber-200 hover:border-amber-400" : "border-blue-200 hover:border-blue-400") : "border-zinc-200 hover:border-zinc-400")}>
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", pendingTab === 'action' ? (isAdminOrHO ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600") : "bg-zinc-100 text-zinc-500")}><Store size={18} /></div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm sm:text-base text-zinc-900 truncate">{dist?.name || 'Unknown'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1">
                            <span className="text-[9px] sm:text-[10px] text-zinc-500 bg-zinc-100 px-1.5 sm:px-2 py-0.5 rounded font-medium truncate max-w-[150px]">ASE: {aseNames}</span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 truncate">{dist?.city || 'No Location'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between lg:justify-end gap-3 sm:gap-6 w-full lg:w-auto mt-2 lg:mt-0">
                        {pendingTab === 'action' && lastProposal && (
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
                        const auditorNames = ticket.auditorIds && ticket.auditorIds.length > 0 ? ticket.auditorIds.map(id => userMap[id]?.name.split(' ')[0]).join(', ') : 'Unassigned';

                        return (
                          <div 
                            key={ticket.id} 
                            onClick={() => {
                              if (ticket.status === 'tentative') {
                                openNegotiationModal(ticket.distributorId);
                              } else if (ticket.status === 'scheduled') {
                                if (isAdminOrHO) {
                                  setEditingActiveTicket(ticket);
                                  setEditTicketData({ scheduledDate: ticket.scheduledDate || '', auditorIds: ticket.auditorIds || [], auditDays: ticket.auditDays || 1 });
                                } else if (profile?.role === 'ase') {
                                  openNegotiationModal(ticket.distributorId);
                                }
                              }
                            }} 
                            className={cn(
                              "p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs border transition-all", 
                              ticket.status === 'tentative' ? "bg-amber-50 border-amber-200 hover:shadow-md cursor-pointer hover:-translate-y-0.5" : 
                              cn("bg-emerald-50 border-emerald-100/50", (isAdminOrHO || (profile?.role === 'ase' && ticket.status === 'scheduled')) ? "cursor-pointer hover:shadow-md hover:border-emerald-300 hover:-translate-y-0.5" : "cursor-default")
                            )} 
                            title={ticket.status === 'tentative' ? 'Click to negotiate dates' : (isAdminOrHO ? 'Click to edit assignment' : (profile?.role === 'ase' ? 'Click to request reschedule' : 'Scheduled'))}
                          >
                            <p className="font-bold text-zinc-900 truncate mb-0.5 sm:mb-1 leading-tight">{dist?.name || 'Unknown'}</p>
                            {ticket.status === 'tentative' ? (
                              <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-amber-600 uppercase"><Clock size={10} /> Needs Approval</div>
                            ) : (
                              <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-medium text-emerald-700 bg-emerald-100/50 px-1 sm:px-1.5 py-0.5 rounded"><Store size={10} className="shrink-0" /><span className="truncate">{auditorNames}</span></div>
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
                      <input type="text" placeholder="Search auditors by name..." className="w-full pl-8 pr-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs focus:ring-2 focus:ring-black outline-none transition-all" value={auditorSearch} onChange={(e) => setAuditorSearch(e.target.value)} />
                    </div>
                    <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-xl p-2 sm:p-3 bg-zinc-50 grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 custom-scrollbar">
                      {displayedAuditors.length > 0 ? displayedAuditors.map(a => (
                        <label key={a.uid} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg">
                          <input type="checkbox" checked={editTicketData.auditorIds.includes(a.uid)} onChange={(e) => { const newIds = e.target.checked ? [...editTicketData.auditorIds, a.uid] : editTicketData.auditorIds.filter(id => id !== a.uid); setEditTicketData({ ...editTicketData, auditorIds: newIds }); }} className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-zinc-300 text-black focus:ring-black" />
                          <span className="text-xs sm:text-sm font-medium text-zinc-700 truncate">{a.name}</span>
                        </label>
                      )) : <div className="col-span-full text-center py-4 text-xs font-medium text-zinc-400">No auditors found.</div>}
                    </div>
                  </div>
                </form>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 pt-4 border-t border-zinc-100 shrink-0 mt-4">
                <button type="button" onClick={() => deleteTicket(editingActiveTicket.id)} className="w-full sm:w-auto px-4 py-3 sm:py-4 bg-red-50 text-red-600 rounded-xl sm:rounded-2xl font-bold hover:bg-red-100 transition-colors flex justify-center items-center gap-2" title="Delete Ticket"><Trash2 size={18} className="sm:w-5 sm:h-5" /> <span className="sm:hidden">Delete Ticket</span></button>
                <button type="submit" form="edit-ticket-form" className="w-full sm:flex-1 py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 text-sm sm:text-base">Save Changes</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- UNIFIED NEGOTIATION HUB MODAL --- */}
      <AnimatePresence>
        {isNegotiationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsNegotiationModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-2xl bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="p-4 sm:p-5 md:p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-50 rounded-xl flex items-center justify-center shrink-0"><CalendarIcon className="text-amber-600 sm:w-5 sm:h-5" size={18} /></div>
                  <div>
                    <h4 className="text-lg sm:text-xl font-bold tracking-tight">Date Negotiation</h4>
                    {currentNegTicket ? (
                      <p className="text-[10px] sm:text-sm text-zinc-500 flex items-center gap-2 truncate max-w-[200px] sm:max-w-[250px]">
                        {distMap[currentNegTicket.distributorId]?.name}
                        {currentNegTicket.status === 'scheduled' && <span className="bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">Scheduled</span>}
                      </p>
                    ) : <p className="text-[10px] sm:text-sm text-zinc-500">Coordinate and approve audit schedules.</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  {isAdminOrHO && currentNegTicket && <button onClick={() => deleteTicket(currentNegTicket.id)} className="p-1.5 sm:p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete this ticket"><Trash2 size={18}/></button>}
                  <button onClick={() => setIsNegotiationModalOpen(false)} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg transition-colors"><X size={18}/></button>
                </div>
              </div>
              
              {/* Dynamic Selector: Only show if we don't have a ticket yet */}
              {!currentNegTicket && (
                <div className="p-4 sm:p-5 md:p-6 bg-zinc-50 border-b border-zinc-200 shrink-0 space-y-3">
                  {isAdminOrHO && (
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">Filter by Area Sales Exec (ASE)</label>
                      <select className="w-full mt-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all cursor-pointer text-xs sm:text-sm shadow-sm" value={negFilterAseId} onChange={e => { setNegFilterAseId(e.target.value); setNegDistId(''); }}>
                        <option value="">All Area Sales Execs...</option>
                        {allUsers.filter(u => u.role === 'ase' && u.active).map(u => <option key={u.uid} value={u.uid}>{u.name} {u.region ? `(${u.region})` : ''}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">Select Distributor</label>
                    <select className="w-full mt-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all cursor-pointer text-xs sm:text-sm font-medium shadow-sm" value={negDistId} onChange={e => setNegDistId(e.target.value)}>
                      <option value="">Choose a distributor...</option>
                      {distributors.filter(d => d.id === negDistId || (d.active && (!negFilterAseId || (d.aseIds && d.aseIds.includes(negFilterAseId))))).map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="overflow-y-auto bg-zinc-50/30 flex-1 p-4 sm:p-5 md:p-6 space-y-4 custom-scrollbar min-h-0">
                {(!negDistId) ? (
                  <div className="text-center py-6 sm:py-8 text-zinc-400">
                    <Store size={28} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm font-medium">Select a distributor above to start.</p>
                  </div>
                ) : (!currentNegTicket || !currentNegTicket.dateProposals || currentNegTicket.dateProposals.length === 0) ? (
                  <div className="text-center py-6 sm:py-8 text-zinc-400">
                    <MessageSquare size={28} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm font-medium">{isAdminOrHO ? 'Request a date proposal from the ASE below.' : 'No messages yet. Send a proposal below to start.'}</p>
                    
                    {/* --- ADMIN QUICK ACTION: REQUEST DATE --- */}
                    {isAdminOrHO && (
                      <button onClick={handleAdminRequestDate} className="mt-4 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-md active:scale-95 transition-all text-sm">
                        Request Date from ASE
                      </button>
                    )}
                  </div>
                ) : (
                  currentNegTicket.dateProposals.map((prop) => (
                    <div key={prop.id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-2 sm:mb-3">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-xs font-bold text-zinc-600 shrink-0">{prop.proposedByName.charAt(0)}</div>
                          <div>
                            <p className="text-sm font-bold text-zinc-900">{prop.proposedByName}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="text-zinc-500 uppercase font-black tracking-wider text-[9px] bg-zinc-100 px-1.5 py-0.5 rounded">{prop.role}</span>
                              <span className="text-[10px] text-zinc-400">{prop.email}</span>
                              <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border border-blue-100/50 truncate max-w-[150px]">{distMap[negDistId]?.name}</span>
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 font-medium shrink-0">{new Date(prop.timestamp).toLocaleDateString()}</span>
                      </div>
                      
                      <div className="pl-11 space-y-2">
                        {prop.date && <div className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 px-2 py-1 rounded-md border border-amber-100 text-xs font-bold"><CalendarIcon size={12}/> Proposed: {format(new Date(prop.date), 'dd MMM yyyy')}</div>}
                        {prop.remarks && <p className="text-sm text-zinc-600 bg-zinc-50 p-2.5 rounded-lg border border-zinc-100">"{prop.remarks}"</p>}
                        
                        {isAdminOrHO && prop.date && currentNegTicket.status === 'tentative' && (
                          <div className="pt-3 mt-2 border-t border-zinc-100 flex flex-col gap-2">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <select className="w-full sm:w-28 text-xs p-2 rounded-lg bg-white border border-zinc-200 focus:ring-2 focus:ring-black cursor-pointer" value={approvalAuditDays} onChange={(e) => setApprovalAuditDays(parseInt(e.target.value))}>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Day{n>1?'s':''}</option>)}
                              </select>
                              <button onClick={() => approveAndSchedule(prop.date)} type="button" className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors">
                                <CheckCircle2 size={14} /> Approve Schedule
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Form is only shown to ASEs, OR to Admins if the ticket already has history. If it's a blank ticket, Admin uses the big button above. */}
              {(!isAdminOrHO || (isAdminOrHO && currentNegTicket)) && (
                <div className="p-4 sm:p-5 md:p-6 bg-white border-t border-zinc-100 shrink-0">
                  <form onSubmit={submitProposal} className="space-y-3">
                    <h5 className="text-xs font-bold tracking-tight text-zinc-900">
                      {isAdminOrHO ? "Suggest a Date & Distributor" : currentNegTicket?.status === 'scheduled' ? "Request Reschedule" : "Submit Date Proposal"}
                    </h5>
                    <div className="flex flex-col gap-3 w-full">
                      
                      <select disabled={!negDistId} className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-xs font-medium text-zinc-700 cursor-pointer disabled:opacity-50" value={replyDistId} onChange={e => setReplyDistId(e.target.value)}>
                        {negDistId && <option value={negDistId}>{distMap[negDistId]?.name} ({distMap[negDistId]?.code}) - Current</option>}
                        <optgroup label="Counter-Propose Another Distributor">
                          {distributors.filter(d => d.id !== negDistId && d.active && (!pendingFilterAse || pendingFilterAse === 'all' || (d.aseIds && d.aseIds.includes(profile?.role === 'ase' ? profile.uid : pendingFilterAse)))).map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                        </optgroup>
                      </select>

                      <div className="flex flex-col sm:flex-row gap-3 w-full">
                        <input type="date" required={!isAdminOrHO} disabled={!negDistId} min={new Date().toISOString().split('T')[0]} className="w-full sm:w-40 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-xs font-medium text-zinc-700 cursor-pointer shrink-0 disabled:opacity-50" value={proposalData.date} onChange={e => setProposalData({...proposalData, date: e.target.value})} />
                        <div className={cn("relative flex-1")}>
                          <input type="text" disabled={!negDistId} placeholder="Type message..." className="w-full pl-3 pr-10 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-xs disabled:opacity-50" value={proposalData.remarks} onChange={e => setProposalData({...proposalData, remarks: e.target.value})} />
                          <button type="submit" disabled={!negDistId} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 bg-black text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"><Send size={14}/></button>
                        </div>
                      </div>
                    </div>
                  </form>
                  
                  {/* 🚨 LATE CANCELLATION BUTTON 🚨 */}
                  {canCancelToday && (
                    <div className="mt-4 pt-4 border-t border-zinc-100">
                      <button type="button" onClick={cancelAssignment} className="w-full py-2.5 bg-red-50 text-red-600 font-bold rounded-xl border border-red-200 hover:bg-red-100 transition-colors flex justify-center items-center gap-2">
                        <AlertCircle size={16} /> Cancel Today's Audit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- FORCE SCHEDULE MODAL --- */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCreateModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="flex justify-between items-center p-5 sm:p-6 border-b border-zinc-100 shrink-0">
                <h3 className="text-lg sm:text-xl font-bold">Force Schedule Audit</h3>
                <button onClick={() => setIsCreateModalOpen(false)} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg sm:rounded-xl"><X size={18} className="sm:w-5 sm:h-5"/></button>
              </div>

              <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                <form id="force-schedule-form" onSubmit={handleCreateSubmit} className="space-y-3 sm:space-y-4">
                  
                  {isAdminOrHO && (
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Filter by ASE (Optional)</label>
                      <select className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={createAseId} onChange={e => { setCreateAseId(e.target.value); setCreateData({...createData, distributorId: ''}); }}>
                        <option value="">All ASEs...</option>
                        {allUsers.filter(u => u.role === 'ase' && u.active).map(u => <option key={u.uid} value={u.uid}>{u.name} {u.region ? `(${u.region})` : ''}</option>)}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Select Distributor *</label>
                    <select required className="w-full mt-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-50 border border-zinc-200 sm:border-none rounded-xl focus:ring-2 focus:ring-black transition-all cursor-pointer text-sm" value={createData.distributorId} onChange={e => setCreateData({...createData, distributorId: e.target.value})} disabled={isAdminOrHO && !createAseId && distributors.length > 50}>
                      <option value="">Choose a distributor...</option>
                      {distributors.filter(d => d.active && (!createAseId || (d.aseIds && d.aseIds.includes(createAseId)))).map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
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