import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, UserProfile } from '../types';
import {
  CalendarRange, Store, User as UserIcon, IndianRupee, MapPin,
  Search, CheckCircle2, Clock, PlayCircle, FileSignature,
  Bell, CalendarDays, ChevronRight, AlertTriangle, Filter,
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion } from 'motion/react';
import {
  differenceInDays, addDays, format,
  startOfWeek, endOfWeek, subWeeks, startOfDay,
} from 'date-fns';

// ─── Period filter options ────────────────────────────────────────────────────
type PeriodFilter = 'today' | 'this_week' | 'previous';

export function TodayAssignmentsModule() {
  const { profile } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────
  const [allTickets, setAllTickets]     = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<any[]>([]);
  const [allUsers, setAllUsers]         = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading]       = useState(true);

  // Filters
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('today');
  const [aseFilter, setAseFilter]       = useState<string>('all');   // uid or 'all'
  const [searchTerm, setSearchTerm]     = useState('');

  // ── Derived date constants ────────────────────────────────────────────────
  const todayStr = useMemo(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().split('T')[0];
  }, []);

  const twoDaysStr = useMemo(() =>
    addDays(new Date(todayStr), 2).toISOString().split('T')[0],
  [todayStr]);

  const weekStart = useMemo(() =>
    startOfWeek(new Date(todayStr), { weekStartsOn: 1 }).toISOString().split('T')[0],
  [todayStr]);

  const weekEnd = useMemo(() =>
    endOfWeek(new Date(todayStr), { weekStartsOn: 1 }).toISOString().split('T')[0],
  [todayStr]);

  // "Previous" = last 30 days before this week's start
  const prevStart = useMemo(() =>
    subWeeks(new Date(weekStart), 4).toISOString().split('T')[0],
  [weekStart]);

  const isAseOrAuditor = ['ase', 'auditor'].includes(profile?.role || '');
  const isAdminOrAbove = ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm'].includes(profile?.role || '');

  // ── Maps ──────────────────────────────────────────────────────────────────
  const distMap = useMemo(() => {
    const m: Record<string, any> = {};
    distributors.forEach(d => { m[d.id] = d; });
    return m;
  }, [distributors]);

  const userMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    allUsers.forEach(u => { m[u.uid] = u; });
    return m;
  }, [allUsers]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;
      setIsLoading(true);
      try {
        // 1. Distributors — superadmin/admin/ho see ALL, others scoped by role
        const isGlobalAdmin = ['superadmin', 'admin', 'ho'].includes(profile.role);
        let dQuery = supabase.from('distributors').select('*');
        if (!isGlobalAdmin) {
          if      (profile.role === 'ase') dQuery = dQuery.contains('aseIds',  [profile.uid]);
          else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds',  [profile.uid]);
          else if (profile.role === 'sm')  dQuery = dQuery.contains('smIds',   [profile.uid]);
          else if (profile.role === 'dm')  dQuery = dQuery.contains('dmIds',   [profile.uid]);
        }
        // No filter for superadmin/admin/ho → fetch all distributors

        const [dRes, uRes] = await Promise.all([
          dQuery,
          supabase.from('users').select('*'),
        ]);
        if (dRes.error) throw dRes.error;

        const fetchedDist = (dRes.data || []) as any[];
        setDistributors(fetchedDist);
        if (uRes.data) setAllUsers(uRes.data as UserProfile[]);

        const distIds = fetchedDist.map((d: any) => d.id);

        // 2. Paginated ticket fetch — handles 1100+ rows without truncation
        //    Range: last 4 weeks → 2 days ahead. Excludes tentative.
        //    superadmin/admin/ho: NO distributorId filter → all assignments
        //    ase/asm/sm/dm: scoped to their distributor ids
        //    auditor: scoped to their uid in auditorIds
        const pageSize = 1000;
        let allFetchedTickets: AuditTicket[] = [];
        let from = 0;

        while (true) {
          let tQuery = supabase
            .from('auditTickets')
            .select('*')
            .neq('status', 'tentative')
            .gte('scheduledDate', prevStart)
            .lte('scheduledDate', twoDaysStr)
            .range(from, from + pageSize - 1);

          if (profile.role === 'auditor') {
            tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
          } else if (!isGlobalAdmin) {
            // scoped roles (ase/asm/sm/dm)
            if (distIds.length === 0) { setAllTickets([]); setIsLoading(false); return; }
            tQuery = tQuery.in('distributorId', distIds);
          }
          // superadmin/admin/ho: no extra filter → fetch all

          const tRes = await tQuery;
          if (tRes.error) throw tRes.error;
          const page = (tRes.data || []) as AuditTicket[];
          allFetchedTickets = allFetchedTickets.concat(page);
          if (page.length < pageSize) break;
          from += pageSize;
        }

        // Cross-check tickets against fetched distributors
        // For admins this is a no-op (all dists fetched), for scoped roles it guards stale data
        const distIdSet = new Set(distIds);
        const validTickets = isGlobalAdmin
          ? allFetchedTickets   // admins already get all — skip the filter for performance
          : allFetchedTickets.filter(t => distIdSet.has(t.distributorId));

        setAllTickets(validTickets);
      } catch (err) {
        console.error("Error fetching assignments:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    const channel = supabase
      .channel('today-assignments-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, todayStr, twoDaysStr, prevStart]);

  // ── Derived ticket buckets ────────────────────────────────────────────────

  // All ASEs (for the ASE filter dropdown — admins only)
  const aseList = useMemo(() =>
    allUsers.filter(u => u.role === 'ase' && u.active),
  [allUsers]);

  // Tickets for the CURRENT period tab (before search / ase filter)
  const periodTickets = useMemo(() => {
    return allTickets.filter(t => {
      if (!t.scheduledDate) return false;
      const d = t.scheduledDate.split('T')[0];
      if (periodFilter === 'today')     return d === todayStr;
      if (periodFilter === 'this_week') return d >= weekStart && d <= weekEnd;
      if (periodFilter === 'previous')  return d >= prevStart && d < weekStart;
      return false;
    });
  }, [allTickets, periodFilter, todayStr, weekStart, weekEnd, prevStart]);

  // Apply ASE filter (admins only) + search
  const filteredTickets = useMemo(() => {
    return periodTickets.filter(t => {
      const dist = distMap[t.distributorId];
      if (!dist) return false;

      // ASE filter — admin picks a specific ASE
      if (aseFilter !== 'all') {
        const hasAse = dist.aseIds?.includes(aseFilter);
        if (!hasAse) return false;
      }

      // Search
      if (searchTerm.trim()) {
        const sl = searchTerm.toLowerCase();
        const matchDist     = dist.name.toLowerCase().includes(sl) || dist.code?.toLowerCase().includes(sl);
        const matchAuditor  = t.auditorIds?.some((id: string) => userMap[id]?.name.toLowerCase().includes(sl));
        const matchAse      = dist.aseIds?.some((id: string) => userMap[id]?.name.toLowerCase().includes(sl));
        if (!matchDist && !matchAuditor && !matchAse) return false;
      }

      return true;
    });
  }, [periodTickets, aseFilter, searchTerm, distMap, userMap]);

  // Upcoming reminders for ASE/auditor (next 1-2 days, status=scheduled)
  const upcomingReminders = useMemo(() => {
    if (!isAseOrAuditor) return [];
    const today = startOfDay(new Date(todayStr));
    return allTickets
      .filter(t => {
        if (t.status !== 'scheduled' || !t.scheduledDate) return false;
        const d = startOfDay(new Date(t.scheduledDate));
        return d > today; // strictly after today
      })
      .sort((a, b) =>
        new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime()
      );
  }, [allTickets, isAseOrAuditor, todayStr]);

  // Today's unstarted count
  const todayScheduledCount = useMemo(() =>
    allTickets.filter(t => t.scheduledDate?.startsWith(todayStr) && t.status === 'scheduled').length,
  [allTickets, todayStr]);

  // Tab counts
  const tabCounts = useMemo(() => ({
    today:     allTickets.filter(t => t.scheduledDate?.split('T')[0] === todayStr).length,
    this_week: allTickets.filter(t => { const d = t.scheduledDate?.split('T')[0] || ''; return d >= weekStart && d <= weekEnd; }).length,
    previous:  allTickets.filter(t => { const d = t.scheduledDate?.split('T')[0] || ''; return d >= prevStart && d < weekStart; }).length,
  }), [allTickets, todayStr, weekStart, weekEnd, prevStart]);

  // Stats for the currently visible filtered set
  const stats = useMemo(() => ({
    total:      filteredTickets.length,
    notStarted: filteredTickets.filter(t => t.status === 'scheduled').length,
    active:     filteredTickets.filter(t => ['in_progress','auditor_submitted','submitted','drainage_pending'].includes(t.status)).length,
    closed:     filteredTickets.filter(t => t.status === 'closed').length,
  }), [filteredTickets]);

  // Status badge config
  const statusConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    scheduled:         { label: 'Scheduled',      icon: <Clock size={12} />,        cls: 'text-amber-700 bg-amber-50/80 border-amber-200/60'      },
    in_progress:       { label: 'In Progress',    icon: <PlayCircle size={12} />,   cls: 'text-indigo-700 bg-indigo-50/80 border-indigo-200/60'   },
    auditor_submitted: { label: 'ASE Review',     icon: <FileSignature size={12} />,cls: 'text-purple-700 bg-purple-50/80 border-purple-200/60'   },
    submitted:         { label: 'Pending Review', icon: <FileSignature size={12} />,cls: 'text-fuchsia-700 bg-fuchsia-50/80 border-fuchsia-200/60'},
    drainage_pending:  { label: 'Drainage',       icon: <FileSignature size={12} />,cls: 'text-cyan-700 bg-cyan-50/80 border-cyan-200/60'         },
    closed:            { label: 'Closed',         icon: <CheckCircle2 size={12} />, cls: 'text-emerald-700 bg-emerald-50/80 border-emerald-200/60'},
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 pb-12 w-full animate-[pulse_1.2s_ease-in-out_infinite]">
        <div className="h-8 w-56 bg-slate-200 rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-200 rounded-2xl" />)}
        </div>
        <div className="h-64 bg-slate-200 rounded-[2rem]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-7 pb-12 w-full min-w-0">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-2 tracking-tight">
            <CalendarRange className="text-indigo-600" size={22} /> Audit Assignments
          </h3>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </motion.div>

      {/* ── ASE Upcoming reminder cards ──────────────────────────────────────── */}
      {isAseOrAuditor && upcomingReminders.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>

          {/* Section header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-400/30 shrink-0">
              <Bell size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Upcoming Audit Reminder
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {upcomingReminders.length} audit{upcomingReminders.length > 1 ? 's' : ''} in the next 2 days — be prepared!
              </p>
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingReminders.map((ticket, idx) => {
              const dist      = distMap[ticket.distributorId];
              const schedDate = new Date(ticket.scheduledDate!);
              schedDate.setHours(0, 0, 0, 0);
              const today     = new Date(todayStr); today.setHours(0, 0, 0, 0);
              const days      = differenceInDays(schedDate, today);
              const auditorNames = (ticket as any).auditorIds
                ?.map((id: string) => userMap[id]?.name?.split(' ')[0]).filter(Boolean) as string[] | undefined;

              // Urgency tier — drives ALL styling
              const tier =
                days === 0 ? {
                  label:      'Today',
                  sublabel:   '🔴 Execute Today',
                  topBar:     'bg-gradient-to-r from-rose-500 to-rose-600',
                  card:       'bg-white border-rose-200 shadow-rose-100',
                  iconBg:     'bg-rose-50 border-rose-200',
                  iconColor:  'text-rose-600',
                  badge:      'bg-rose-100 text-rose-700 border-rose-200',
                  dotColor:   'bg-rose-500',
                  dotPing:    true,
                  accent:     'text-rose-600',
                  divider:    'border-rose-100',
                  actionBg:   'bg-rose-50',
                } : days === 1 ? {
                  label:      'Tomorrow',
                  sublabel:   '🟡 Prepare for Tomorrow',
                  topBar:     'bg-gradient-to-r from-amber-400 to-yellow-500',
                  card:       'bg-white border-amber-200 shadow-amber-100',
                  iconBg:     'bg-amber-50 border-amber-200',
                  iconColor:  'text-amber-600',
                  badge:      'bg-amber-100 text-amber-700 border-amber-200',
                  dotColor:   'bg-amber-500',
                  dotPing:    false,
                  accent:     'text-amber-600',
                  divider:    'border-amber-100',
                  actionBg:   'bg-amber-50',
                } : {
                  label:      'In 2 Days',
                  sublabel:   '🔵 Coming Up Soon',
                  topBar:     'bg-gradient-to-r from-indigo-500 to-blue-600',
                  card:       'bg-white border-indigo-200 shadow-indigo-100',
                  iconBg:     'bg-indigo-50 border-indigo-200',
                  iconColor:  'text-indigo-600',
                  badge:      'bg-indigo-100 text-indigo-700 border-indigo-200',
                  dotColor:   'bg-indigo-500',
                  dotPing:    false,
                  accent:     'text-indigo-600',
                  divider:    'border-indigo-100',
                  actionBg:   'bg-indigo-50',
                };

              return (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: idx * 0.08, duration: 0.35, ease: 'easeOut' }}
                  className={cn(
                    'relative rounded-[1.5rem] border overflow-hidden shadow-md flex flex-col',
                    tier.card
                  )}
                >
                  {/* Colored top bar */}
                  <div className={cn('h-1.5 w-full', tier.topBar)} />

                  {/* Pulsing urgency dot */}
                  <div className="absolute top-5 right-4 flex items-center justify-center">
                    {tier.dotPing && (
                      <span className={cn('absolute w-3.5 h-3.5 rounded-full opacity-60 animate-ping', tier.dotColor)} />
                    )}
                    <span className={cn('w-3 h-3 rounded-full shadow-sm', tier.dotColor)} />
                  </div>

                  <div className="p-5 flex flex-col gap-4">

                    {/* Top: icon + name + badge */}
                    <div className="flex items-start gap-3 pr-6">
                      <div className={cn(
                        'w-11 h-11 rounded-2xl flex items-center justify-center border-2 shrink-0 shadow-sm',
                        tier.iconBg
                      )}>
                        <Store size={18} className={tier.iconColor} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className="font-black text-slate-900 text-sm leading-snug">
                            {dist?.name || '—'}
                          </p>
                          <span className={cn(
                            'text-[10px] font-black px-2.5 py-1 rounded-lg border whitespace-nowrap shrink-0',
                            tier.badge
                          )}>
                            {tier.label}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{dist?.code}</p>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="space-y-2">
                      {/* Date */}
                      <div className="flex items-center gap-2.5">
                        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', tier.iconBg)}>
                          <CalendarDays size={13} className={tier.iconColor} />
                        </div>
                        <span className="text-sm font-bold text-slate-800">
                          {format(schedDate, 'EEEE, dd MMM yyyy')}
                        </span>
                      </div>

                      {/* Location */}
                      {(dist?.city || dist?.state) && (
                        <div className="flex items-center gap-2.5">
                          <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', tier.iconBg)}>
                            <MapPin size={13} className={tier.iconColor} />
                          </div>
                          <span className="text-sm text-slate-600 truncate">
                            {[dist?.city, dist?.state].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}

                      {/* Address */}
                      {dist?.address && (
                        <div className="flex items-start gap-2.5">
                          <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5', tier.iconBg)}>
                            <MapPin size={13} className={tier.iconColor} />
                          </div>
                          <span className="text-xs text-slate-500 line-clamp-2 leading-snug">{dist.address}</span>
                        </div>
                      )}

                      {/* Value */}
                      <div className="flex items-center gap-2.5">
                        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', tier.iconBg)}>
                          <IndianRupee size={13} className={tier.iconColor} />
                        </div>
                        <span className="text-sm font-bold text-slate-800">
                          ₹{(ticket.verifiedTotal || 0).toLocaleString('en-IN')}
                            <span className="text-xs font-normal text-slate-400 ml-1">audited</span>
                        </span>
                      </div>

                      {/* Auditors */}
                      {auditorNames && auditorNames.length > 0 && (
                        <div className="flex items-center gap-2.5">
                          <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', tier.iconBg)}>
                            <UserIcon size={13} className={tier.iconColor} />
                          </div>
                          <span className="text-sm text-slate-600 truncate">{auditorNames.join(', ')}</span>
                        </div>
                      )}
                    </div>

                    {/* Action footer */}
                    <div className={cn(
                      'flex items-center justify-between pt-3 border-t mt-1',
                      tier.divider
                    )}>
                      <span className={cn('text-xs font-black uppercase tracking-wider', tier.accent)}>
                        {tier.sublabel}
                      </span>
                      <div className={cn(
                        'w-7 h-7 rounded-xl flex items-center justify-center',
                        tier.iconBg
                      )}>
                        <ChevronRight size={15} className={tier.iconColor} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Today's unstarted alert ───────────────────────────────────────────── */}
      {isAseOrAuditor && todayScheduledCount > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl">
          <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-rose-800">
            🔴 You have {todayScheduledCount} audit{todayScheduledCount > 1 ? 's' : ''} scheduled for today that haven't started yet.
            Head to the <span className="underline">Execution</span> page to begin!
          </p>
        </motion.div>
      )}

      {/* ── Period tabs + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">

        {/* Period tabs */}
        <div className="flex bg-slate-100/80 p-1.5 rounded-xl overflow-x-auto custom-scrollbar shrink-0">
          {([
            { id: 'today'     as PeriodFilter, label: "Today's Audits",  count: tabCounts.today     },
            { id: 'this_week' as PeriodFilter, label: "This Week",       count: tabCounts.this_week },
            { id: 'previous'  as PeriodFilter, label: "Previous Audits", count: tabCounts.previous  },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => { setPeriodFilter(tab.id); setSearchTerm(''); }}
              className={cn(
                'px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2',
                periodFilter === tab.id
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-900'
              )}
            >
              {tab.label}
              <span className={cn(
                'px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black',
                periodFilter === tab.id ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/50 text-slate-500'
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ASE filter — admins/HO/DM/SM/ASM only */}
        {isAdminOrAbove && aseList.length > 0 && (
          <div className="relative shrink-0">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              className="pl-8 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer appearance-none min-w-[160px]"
              value={aseFilter}
              onChange={e => setAseFilter(e.target.value)}
            >
              <option value="all">All ASEs</option>
              {aseList.map(u => (
                <option key={u.uid} value={u.uid}>{u.name}{u.region ? ` (${u.region})` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-0 group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
          <input
            type="text"
            placeholder={isAdminOrAbove ? "Search distributor, auditor or ASE…" : "Search distributor or auditor…"}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm text-sm text-slate-700 placeholder:text-slate-400"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { label: 'Total',        value: stats.total,      cls: 'text-slate-900'   },
          { label: 'Not Started',  value: stats.notStarted, cls: 'text-amber-600'   },
          { label: 'In Progress',  value: stats.active,     cls: 'text-indigo-600'  },
          { label: 'Closed',       value: stats.closed,     cls: 'text-emerald-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
            <p className={cn('text-2xl font-black mt-1', s.cls)}>{s.value}</p>
          </div>
        ))}
      </motion.div>

      {/* ── Assignments table ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full"
      >
        {/* Table header bar */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CalendarRange size={16} className="text-indigo-600" />
            {periodFilter === 'today' && "Today's Assignments"}
            {periodFilter === 'this_week' && `This Week  (${format(new Date(weekStart), 'dd MMM')} – ${format(new Date(weekEnd), 'dd MMM')})`}
            {periodFilter === 'previous' && 'Previous Audits  (Last 4 Weeks)'}
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
              {filteredTickets.length}
            </span>
          </p>
        </div>

        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Distributor</th>
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Location</th>
                {isAdminOrAbove && (
                  <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">ASE</th>
                )}
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Auditor(s)</th>
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Scheduled</th>
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Value</th>
                <th className="px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={isAdminOrAbove ? 7 : 6} className="px-6 py-16 text-center text-slate-400">
                    <CalendarRange size={32} className="mx-auto mb-3 opacity-20 text-indigo-400" />
                    <p className="text-sm font-semibold">
                      {allTickets.length === 0
                        ? 'No audits found.'
                        : searchTerm || aseFilter !== 'all'
                          ? 'No results match your filters.'
                          : `No audits for this period.`}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTickets
                  .slice()
                  .sort((a, b) =>
                    // Sort by date desc within previous, asc for others
                    periodFilter === 'previous'
                      ? new Date(b.scheduledDate!).getTime() - new Date(a.scheduledDate!).getTime()
                      : new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime()
                  )
                  .map(ticket => {
                    const dist         = distMap[ticket.distributorId];
                    const auditorNames = (ticket as any).auditorIds?.map((id: string) => userMap[id]?.name).filter(Boolean) || [];
                    const aseNames     = dist?.aseIds?.map((id: string) => userMap[id]?.name?.split(' ')[0]).filter(Boolean) || [];
                    const sc           = statusConfig[ticket.status] || {
                      label: ticket.status.replace(/_/g, ' '),
                      icon:  <Clock size={12} />,
                      cls:   'text-slate-600 bg-slate-100 border-slate-200',
                    };
                    const isToday      = ticket.scheduledDate?.split('T')[0] === todayStr;
                    const isPast       = (ticket.scheduledDate?.split('T')[0] || '') < todayStr;

                    return (
                      <tr key={ticket.id}
                        className={cn(
                          'hover:bg-slate-50/60 transition-colors group',
                          isToday && 'bg-indigo-50/20',
                        )}>

                        {/* Distributor */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-colors',
                              isToday
                                ? 'bg-indigo-50 border-indigo-100 text-indigo-600'
                                : isPast
                                  ? 'bg-slate-50 border-slate-100 text-slate-400'
                                  : 'bg-slate-100 border-slate-200 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600'
                            )}>
                              <Store size={15} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-sm leading-tight">{dist?.name || '—'}</p>
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{dist?.code}</p>
                            </div>
                          </div>
                        </td>

                        {/* Location */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 text-xs text-slate-600">
                            <MapPin size={12} className="text-slate-400 shrink-0" />
                            <span className="truncate max-w-[130px]">
                              {[dist?.city, dist?.state].filter(Boolean).join(', ') || '—'}
                            </span>
                          </div>
                        </td>

                        {/* ASE column — admins only */}
                        {isAdminOrAbove && (
                          <td className="px-5 py-3.5">
                            {aseNames.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {aseNames.map((name: string, i: number) => (
                                  <span key={i} className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                                    <UserIcon size={11} className="text-slate-400" /> {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">None</span>
                            )}
                          </td>
                        )}

                        {/* Auditor(s) */}
                        <td className="px-5 py-3.5">
                          {auditorNames.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {auditorNames.map((name: string, i: number) => (
                                <span key={i} className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                                  <UserIcon size={11} className="text-slate-400" /> {name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                              Unassigned
                            </span>
                          )}
                        </td>

                        {/* Date */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className={cn(
                            'text-xs font-bold',
                            isToday ? 'text-indigo-700' : isPast ? 'text-slate-400' : 'text-slate-700'
                          )}>
                            {ticket.scheduledDate
                              ? format(new Date(ticket.scheduledDate), 'dd MMM yyyy')
                              : '—'}
                          </p>
                          {isToday && (
                            <span className="text-[9px] font-black text-indigo-500 uppercase tracking-wider">Today</span>
                          )}
                        </td>

                        {/* Value */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1 text-sm font-bold text-slate-700">
                            <IndianRupee size={13} className="text-slate-400" />
                            {(ticket.verifiedTotal || 0).toLocaleString('en-IN')}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            of ₹{(ticket.approvedValue || dist?.approvedValue || 0).toLocaleString('en-IN')} limit
                          </p>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-3.5 text-right">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-md border whitespace-nowrap',
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