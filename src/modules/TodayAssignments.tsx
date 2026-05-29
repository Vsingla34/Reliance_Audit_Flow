import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, UserProfile } from '../types';
import {
  CalendarRange, Store, User as UserIcon, IndianRupee, MapPin,
  Search, CheckCircle2, Clock, PlayCircle, FileSignature,
  Bell, CalendarDays, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion } from 'motion/react';
import { differenceInDays, addDays, format } from 'date-fns';

export function TodayAssignmentsModule() {
  const { profile } = useAuth();
  const [tickets, setTickets]         = useState<AuditTicket[]>([]);
  const [allTickets, setAllTickets]   = useState<AuditTicket[]>([]); // includes upcoming
  const [distributors, setDistributors] = useState<any[]>([]);
  const [allUsers, setAllUsers]       = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm]   = useState('');
  const [isLoading, setIsLoading]     = useState(true);

  // Local date string (YYYY-MM-DD) in the user's timezone
  const todayStr = useMemo(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().split('T')[0];
  }, []);

  // Date 2 days from today (inclusive)
  const twoDaysStr = useMemo(() => {
    const d = addDays(new Date(todayStr), 2);
    return d.toISOString().split('T')[0];
  }, [todayStr]);

  const isAseOrAuditor = ['ase', 'auditor'].includes(profile?.role || '');

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

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;
      setIsLoading(true);
      try {
        // 1. Distributors scoped to role
        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase')     dQuery = dQuery.contains('aseIds',  [profile.uid]);
        else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm')  dQuery = dQuery.contains('smIds',  [profile.uid]);
        else if (profile.role === 'dm')  dQuery = dQuery.contains('dmIds',  [profile.uid]);

        const [dRes, uRes] = await Promise.all([
          dQuery,
          supabase.from('users').select('*'),
        ]);
        if (dRes.error) throw dRes.error;
        const fetchedDist = (dRes.data || []) as any[];
        setDistributors(fetchedDist);
        if (uRes.data) setAllUsers(uRes.data as UserProfile[]);

        const distIds = fetchedDist.map(d => d.id);

        // 2a. Today's tickets (for the main table)
        let tTodayQuery = supabase
          .from('auditTickets')
          .select('*')
          .eq('scheduledDate', todayStr)
          .neq('status', 'tentative');

        if (profile.role === 'auditor') {
          tTodayQuery = tTodayQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
          if (distIds.length > 0) tTodayQuery = tTodayQuery.in('distributorId', distIds);
          else { setTickets([]); setAllTickets([]); setIsLoading(false); return; }
        }

        // 2b. Upcoming tickets (for ASE/auditor reminder — next 2 days, status=scheduled)
        // Only fetch for roles that benefit from reminders
        let upcomingTicketsData: AuditTicket[] = [];
        if (isAseOrAuditor && distIds.length > 0) {
          const { data: upData } = await supabase
            .from('auditTickets')
            .select('*')
            .eq('status', 'scheduled')
            .gt('scheduledDate', todayStr)   // strictly after today (today is in the main table)
            .lte('scheduledDate', twoDaysStr)
            .in('distributorId', distIds);
          upcomingTicketsData = (upData || []) as AuditTicket[];
        }

        const tRes = await tTodayQuery;
        if (tRes.error) throw tRes.error;

        const todayTickets = ((tRes.data || []) as AuditTicket[])
          .filter(t => fetchedDist.some(d => d.id === t.distributorId));

        setTickets(todayTickets);
        setAllTickets([...todayTickets, ...upcomingTicketsData]);
      } catch (error) {
        console.error("Error fetching today's assignments:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    const channel = supabase
      .channel('today-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, todayStr, twoDaysStr]);

  // ── Reminder cards: scheduled audits in the next 1-2 days ─────────────────
  const upcomingReminders = useMemo(() => {
    if (!isAseOrAuditor) return [];
    return allTickets
      .filter(t => {
        if (t.status !== 'scheduled' || !t.scheduledDate) return false;
        const d = new Date(t.scheduledDate); d.setHours(0, 0, 0, 0);
        const today = new Date(todayStr);    today.setHours(0, 0, 0, 0);
        // Only upcoming (not today — today has its own section)
        return d > today;
      })
      .sort((a, b) =>
        new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime()
      );
  }, [allTickets, isAseOrAuditor, todayStr]);

  // ── Today's audit for reminders (status=scheduled, date=today) ────────────
  const todayScheduledCount = useMemo(() =>
    tickets.filter(t => t.status === 'scheduled').length,
  [tickets]);

  // Filtered table rows
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const dist = distMap[t.distributorId];
      if (!dist) return false;
      const sl = searchTerm.toLowerCase();
      return (
        dist.name.toLowerCase().includes(sl) ||
        (t.auditorIds?.some(id => userMap[id]?.name.toLowerCase().includes(sl)))
      );
    });
  }, [tickets, distMap, userMap, searchTerm]);

  // Status label + color config
  const statusConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    scheduled:         { label: 'Scheduled',      icon: <Clock size={12} />,        cls: 'text-amber-700 bg-amber-50/80 border-amber-200/60'     },
    in_progress:       { label: 'Occurring Now',  icon: <PlayCircle size={12} />,   cls: 'text-indigo-700 bg-indigo-50/80 border-indigo-200/60'   },
    auditor_submitted: { label: 'Pending Review', icon: <FileSignature size={12} />,cls: 'text-fuchsia-700 bg-fuchsia-50/80 border-fuchsia-200/60'},
    submitted:         { label: 'Pending Review', icon: <FileSignature size={12} />,cls: 'text-fuchsia-700 bg-fuchsia-50/80 border-fuchsia-200/60'},
    drainage_pending:  { label: 'Pending Review', icon: <FileSignature size={12} />,cls: 'text-fuchsia-700 bg-fuchsia-50/80 border-fuchsia-200/60'},
    closed:            { label: 'Closed',         icon: <CheckCircle2 size={12} />, cls: 'text-emerald-700 bg-emerald-50/80 border-emerald-200/60'},
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0 animate-[pulse_1.2s_ease-in-out_infinite]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <div>
            <div className="h-8 w-48 bg-slate-200 rounded-lg mb-2" />
            <div className="h-4 w-32 bg-slate-200 rounded-md" />
          </div>
          <div className="w-full sm:max-w-md h-12 bg-slate-200 rounded-xl sm:rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm h-[90px]" />
          ))}
        </div>
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full"
      >
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2 tracking-tight">
            <CalendarRange className="text-indigo-600" size={24} /> Today's Action Plan
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="relative w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
          <input
            type="text"
            placeholder="Search by distributor or auditor..."
            className="w-full pl-11 pr-4 py-3 sm:py-3.5 bg-white border border-slate-200 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm text-sm font-medium text-slate-700 placeholder:text-slate-400"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </motion.div>

      {/* ── ASE / Auditor: Upcoming reminders (next 1–2 days) ────────────────── */}
      {isAseOrAuditor && upcomingReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full"
        >
          {/* Section header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center border border-amber-200 shrink-0">
              <Bell size={15} className="text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">
                Upcoming Audit Reminder
              </p>
              <p className="text-[11px] text-slate-500">
                {upcomingReminders.length} audit{upcomingReminders.length > 1 ? 's' : ''} in the next 2 days — prepare in advance!
              </p>
            </div>
          </div>

          {/* Reminder cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingReminders.map((ticket, idx) => {
              const dist      = distMap[ticket.distributorId];
              const schedDate = new Date(ticket.scheduledDate!);
              schedDate.setHours(0, 0, 0, 0);
              const today = new Date(todayStr); today.setHours(0, 0, 0, 0);
              const daysUntil = differenceInDays(schedDate, today);

              const urgency =
                daysUntil === 1
                  ? { label: 'Tomorrow',  bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700 border-amber-200',   dot: 'bg-amber-400',   icon: '🟡' }
                  : { label: 'In 2 days', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400',  icon: '🔵' };

              const auditorNames = (ticket as any).auditorIds
                ?.map((id: string) => userMap[id]?.name?.split(' ')[0])
                .filter(Boolean) as string[] | undefined;

              return (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.06, duration: 0.3 }}
                  className={cn(
                    'relative rounded-[1.25rem] border p-4 flex flex-col gap-3 shadow-sm',
                    urgency.bg, urgency.border
                  )}
                >
                  {/* Urgency dot */}
                  <span className={cn('absolute top-3.5 right-3.5 w-2.5 h-2.5 rounded-full', urgency.dot)} />

                  {/* Top */}
                  <div className="flex items-start gap-2.5 pr-5">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center border shrink-0', urgency.bg, urgency.border)}>
                      <Store size={15} className={urgency.text} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 text-sm leading-tight truncate">{dist?.name || '—'}</p>
                      <p className="text-[10px] font-mono text-slate-500 mt-0.5">{dist?.code}</p>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={12} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-700">
                        {format(schedDate, 'EEE, dd MMM yyyy')}
                      </span>
                      <span className={cn('ml-auto text-[10px] font-black px-2 py-0.5 rounded-md border', urgency.badge)}>
                        {urgency.label}
                      </span>
                    </div>

                    {(dist?.city || dist?.state) && (
                      <div className="flex items-center gap-2">
                        <MapPin size={12} className="text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 truncate">
                          {[dist?.city, dist?.state].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}

                    {dist?.address && (
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className="text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-[11px] text-slate-500 line-clamp-1">{dist.address}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <IndianRupee size={12} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-700">
                        ₹{(ticket.approvedValue || 0).toLocaleString('en-IN')} approved
                      </span>
                    </div>

                    {auditorNames && auditorNames.length > 0 && (
                      <div className="flex items-center gap-2">
                        <UserIcon size={12} className="text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 truncate">
                          {auditorNames.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className={cn('flex items-center justify-between pt-2 border-t', urgency.border)}>
                    <span className={cn('text-[10px] font-black uppercase tracking-wider', urgency.text)}>
                      {urgency.icon} {daysUntil === 1 ? 'Prepare for Tomorrow' : 'Coming in 2 Days'}
                    </span>
                    <ChevronRight size={13} className={cn(urgency.text)} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Today's audit alert for ASE (if any scheduled today) ─────────────── */}
      {isAseOrAuditor && todayScheduledCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl"
        >
          <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-rose-800">
            🔴 You have {todayScheduledCount} audit{todayScheduledCount > 1 ? 's' : ''} scheduled for today that haven't started yet. Head to the Execution page to begin!
          </p>
        </motion.div>
      )}

      {/* ── Stats row ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
      >
        {[
          { label: 'Total Scheduled',      value: tickets.length,                                                                        cls: 'text-slate-900'    },
          { label: 'Not Started',          value: tickets.filter(t => t.status === 'scheduled').length,                                  cls: 'text-amber-600'    },
          { label: 'In Progress / Review', value: tickets.filter(t => ['in_progress','auditor_submitted','submitted','drainage_pending'].includes(t.status)).length, cls: 'text-indigo-600' },
          { label: 'Fully Closed',         value: tickets.filter(t => t.status === 'closed').length,                                     cls: 'text-emerald-600'  },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{stat.label}</p>
            <p className={cn('text-2xl font-black mt-1', stat.cls)}>{stat.value}</p>
          </div>
        ))}
      </motion.div>

      {/* ── Today's assignments table ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}
        className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full"
      >
        {/* Table header */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CalendarRange size={16} className="text-indigo-600" />
            Today's Assignments
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
              {filteredTickets.length}
            </span>
          </p>
        </div>

        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Distributor Details</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Address & Location</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Assigned Auditor(s)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Value</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-slate-400">
                    <CalendarRange size={32} className="mx-auto mb-3 opacity-20 text-indigo-500" />
                    <p className="text-sm font-semibold">
                      {tickets.length === 0 ? 'No audits scheduled for today.' : 'No results match your search.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTickets.map(ticket => {
                  const dist         = distMap[ticket.distributorId];
                  const auditorNames = ticket.auditorIds?.map(id => userMap[id]?.name).filter(Boolean) || [];
                  const sc           = statusConfig[ticket.status] || {
                    label: ticket.status.replace(/_/g, ' '),
                    icon:  <Clock size={12} />,
                    cls:   'text-slate-600 bg-slate-100 border-slate-200',
                  };

                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-[12px] bg-slate-100 text-slate-500 border border-slate-200/50 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors flex items-center justify-center shrink-0">
                            <Store size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{dist?.name || 'Unknown'}</p>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-wide">{dist?.code || 'No Code'}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs font-medium text-slate-700 max-w-[200px] truncate" title={dist?.address || ''}>
                            {dist?.address || 'Address not provided'}
                          </p>
                          <p className="text-[10px] sm:text-xs text-slate-500 flex items-center gap-1">
                            <MapPin size={12} className="shrink-0" />
                            {dist?.city || 'No City'}{dist?.region ? `, ${dist.region}` : ''}
                          </p>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {auditorNames.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {auditorNames.map((name, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                <UserIcon size={13} className="text-slate-400" /> {name}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] font-bold text-rose-500 bg-rose-50/80 px-2 py-0.5 rounded-md border border-rose-100">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-bold text-slate-700">
                          <IndianRupee size={14} className="text-slate-400" />
                          {dist?.approvedValue ? dist.approvedValue.toLocaleString('en-IN') : '0'}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <span className={cn(
                          'flex justify-end items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md border w-max ml-auto',
                          sc.cls
                        )}>
                          {sc.icon} {sc.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}