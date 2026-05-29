import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor } from '../types';
import { useAuth, cn } from '../App';
import {
  LayoutDashboard, TrendingUp, CheckCircle2, Clock, AlertCircle,
  PlayCircle, Store, IndianRupee, ArrowUpRight, Activity,
  CalendarDays, FileSignature, Bell, MapPin, ChevronRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { startOfMonth, endOfMonth, differenceInDays, addDays, format } from 'date-fns';

export function DashboardModule() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;
      setIsLoading(true);
      try {
        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase') dQuery = dQuery.contains('aseIds', [profile.uid]);
        else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm') dQuery = dQuery.contains('smIds', [profile.uid]);
        else if (profile.role === 'dm') dQuery = dQuery.contains('dmIds', [profile.uid]);

        const { data: dData, error: dError } = await dQuery;
        if (dError) throw dError;
        const fetchedDistributors = (dData || []) as Distributor[];
        setDistributors(fetchedDistributors);

        let tQuery = supabase.from('auditTickets').select('*');
        if (profile.role === 'auditor') {
          tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
          const distIds = fetchedDistributors.map(d => d.id);
          if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
          else { setTickets([]); setIsLoading(false); return; }
        }

        const { data: tData, error: tError } = await tQuery;
        if (tError) throw tError;
        if (tData) {
          const validTickets = (tData as AuditTicket[]).filter(
            t => fetchedDistributors.some(d => d.id === t.distributorId)
          );
          setTickets(validTickets);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [profile]);

  const distMap = useMemo(() => {
    const map: Record<string, Distributor> = {};
    distributors.forEach(d => { map[d.id] = d; });
    return map;
  }, [distributors]);

  const currentMonthStart = startOfMonth(new Date()).toISOString();
  const currentMonthEnd   = endOfMonth(new Date()).toISOString();

  const metrics = useMemo(() => {
    const active = tickets.filter(t =>
      ['scheduled', 'in_progress', 'auditor_submitted', 'submitted', 'drainage_pending'].includes(t.status)
    );
    const completedThisMonth = tickets.filter(
      t => t.status === 'closed' &&
           t.updatedAt && t.updatedAt >= currentMonthStart && t.updatedAt <= currentMonthEnd
    );
    const requiresAction = tickets.filter(t =>
      ['tentative', 'auditor_submitted', 'submitted'].includes(t.status)
    );
    const totalVerifiedValue = completedThisMonth.reduce((sum, t) => sum + (t.verifiedTotal || 0), 0);
    return {
      activeCount:    active.length,
      completedCount: completedThisMonth.length,
      actionCount:    requiresAction.length,
      totalValue:     totalVerifiedValue,
    };
  }, [tickets, currentMonthStart, currentMonthEnd]);

  // ── ASE upcoming reminders (within next 2 days) ───────────────────────────
  const upcomingReminders = useMemo(() => {
    if (!['ase', 'auditor'].includes(profile?.role || '')) return [];

    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    const dayPlus2 = addDays(today, 2);
    dayPlus2.setHours(23, 59, 59, 999);

    return tickets
      .filter(t => {
        if (t.status !== 'scheduled') return false;
        if (!t.scheduledDate) return false;
        const d = new Date(t.scheduledDate);
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= dayPlus2;
      })
      .sort((a, b) =>
        new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime()
      );
  }, [tickets, profile]);

  const recentTickets = useMemo(() => {
    return [...tickets]
      .filter(t => t.status !== 'tentative')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);
  }, [tickets]);

  if (isLoading) {
    return (
      <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0 animate-[pulse_1.2s_ease-in-out_infinite]">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="h-8 w-48 bg-slate-200 rounded-lg mb-2" />
            <div className="h-4 w-64 bg-slate-200 rounded-md" />
          </div>
          <div className="h-10 w-40 bg-slate-200 rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm h-[170px] flex flex-col justify-between">
              <div className="w-12 h-12 bg-slate-200 rounded-2xl" />
              <div>
                <div className="h-3 w-24 bg-slate-100 rounded mb-3" />
                <div className="h-8 w-16 bg-slate-200 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Overview</h2>
          <p className="text-sm font-medium text-slate-500 mt-1">Here is what's happening with your audits today.</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-sm w-fit">
          <CalendarDays size={16} className="text-indigo-600" />
          <span className="text-xs font-bold text-slate-700">
            {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
        </motion.div>
      </div>

      {/* ── ASE / AUDITOR UPCOMING AUDIT REMINDERS (next 2 days) ─────────────── */}
      {upcomingReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full"
        >
          {/* Header strip */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center border border-amber-200">
              <Bell size={16} className="text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 tracking-tight">
                Upcoming Audit Reminder
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                {upcomingReminders.length} audit{upcomingReminders.length > 1 ? 's' : ''} scheduled in the next 2 days — be prepared!
              </p>
            </div>
          </div>

          {/* Reminder cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {upcomingReminders.map((ticket, i) => {
              const dist         = distMap[ticket.distributorId];
              const schedDate    = new Date(ticket.scheduledDate!);
              schedDate.setHours(0, 0, 0, 0);
              const today        = new Date(); today.setHours(0, 0, 0, 0);
              const daysUntil    = differenceInDays(schedDate, today);

              const urgency =
                daysUntil === 0 ? { label: 'Today',     bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700',   badge: 'bg-rose-100 text-rose-700',   dot: 'bg-rose-500'   } :
                daysUntil === 1 ? { label: 'Tomorrow',  bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500'  } :
                                  { label: 'In 2 days', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' };

              return (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.35 }}
                  className={cn(
                    'relative rounded-[1.25rem] border p-4 sm:p-5 flex flex-col gap-3 shadow-sm overflow-hidden',
                    urgency.bg, urgency.border
                  )}
                >
                  {/* Urgency pulse dot */}
                  <span className={cn(
                    'absolute top-4 right-4 w-2.5 h-2.5 rounded-full',
                    urgency.dot,
                    daysUntil === 0 && 'animate-ping opacity-75'
                  )} />
                  {daysUntil === 0 && (
                    <span className={cn('absolute top-4 right-4 w-2.5 h-2.5 rounded-full', urgency.dot)} />
                  )}

                  {/* Top row */}
                  <div className="flex items-start justify-between pr-5">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center border', urgency.bg, urgency.border)}>
                        <Store size={16} className={urgency.text} />
                      </div>
                      <div>
                        <p className="font-black text-slate-900 text-sm leading-tight line-clamp-1">
                          {dist?.name || '—'}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5">{dist?.code}</p>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-1.5">
                    {/* Date */}
                    <div className="flex items-center gap-2">
                      <CalendarDays size={13} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-700">
                        {format(schedDate, 'dd MMM yyyy')}
                      </span>
                      <span className={cn('ml-auto text-[10px] font-black px-2 py-0.5 rounded-md', urgency.badge)}>
                        {urgency.label}
                      </span>
                    </div>

                    {/* Location */}
                    {(dist?.city || dist?.state) && (
                      <div className="flex items-center gap-2">
                        <MapPin size={13} className="text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 truncate">
                          {[dist.city, dist.state].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}

                    {/* Approved value */}
                    <div className="flex items-center gap-2">
                      <IndianRupee size={13} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-700">
                        {(ticket.approvedValue || 0).toLocaleString('en-IN')} approved
                      </span>
                    </div>
                  </div>

                  {/* Bottom action hint */}
                  <div className={cn(
                    'flex items-center justify-between pt-2 border-t',
                    daysUntil === 0 ? 'border-rose-200' : daysUntil === 1 ? 'border-amber-200' : 'border-indigo-200'
                  )}>
                    <span className={cn('text-[10px] font-black uppercase tracking-wider', urgency.text)}>
                      {daysUntil === 0 ? '🔴 Execute Today' : daysUntil === 1 ? '🟡 Prepare Tomorrow' : '🔵 Coming Up'}
                    </span>
                    <ChevronRight size={14} className={cn(urgency.text)} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full">

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
          className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-100 transition-opacity">
            <Activity size={48} className="text-indigo-500 translate-x-4 -translate-y-4" />
          </div>
          <div className="w-12 h-12 bg-indigo-50/80 rounded-2xl flex items-center justify-center mb-4 border border-indigo-100/50">
            <PlayCircle size={24} className="text-indigo-600" />
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Audits</p>
          <div className="flex items-end gap-3 mt-1">
            <h3 className="text-3xl font-black text-slate-900">{metrics.activeCount}</h3>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md mb-1 border border-indigo-100/50">Ongoing</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}
          className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-100 transition-opacity">
            <AlertCircle size={48} className="text-amber-500 translate-x-4 -translate-y-4" />
          </div>
          <div className="w-12 h-12 bg-amber-50/80 rounded-2xl flex items-center justify-center mb-4 border border-amber-100/50">
            <Clock size={24} className="text-amber-600" />
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Needs Action</p>
          <div className="flex items-end gap-3 mt-1">
            <h3 className="text-3xl font-black text-slate-900">{metrics.actionCount}</h3>
            <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md mb-1 border border-amber-100/50">Pending</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}
          className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-100 transition-opacity">
            <CheckCircle2 size={48} className="text-emerald-500 translate-x-4 -translate-y-4" />
          </div>
          <div className="w-12 h-12 bg-emerald-50/80 rounded-2xl flex items-center justify-center mb-4 border border-emerald-100/50">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Completed (This Month)</p>
          <div className="flex items-end gap-3 mt-1">
            <h3 className="text-3xl font-black text-slate-900">{metrics.completedCount}</h3>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}
          className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-40 transition-opacity">
            <TrendingUp size={64} className="text-cyan-500 translate-x-2 -translate-y-2" />
          </div>
          <div className="w-12 h-12 bg-cyan-50/80 rounded-2xl flex items-center justify-center mb-4 border border-cyan-100/50">
            <IndianRupee size={24} className="text-cyan-600" />
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Verified Value (Month)</p>
          <div className="flex items-end gap-3 mt-1">
            <h3 className="text-2xl sm:text-3xl font-black text-slate-900 truncate" title={`₹${metrics.totalValue.toLocaleString()}`}>
              ₹{metrics.totalValue >= 100000 ? `${(metrics.totalValue / 100000).toFixed(2)}L` : metrics.totalValue.toLocaleString()}
            </h3>
          </div>
        </motion.div>

      </div>

      {/* RECENT ACTIVITY TABLE */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4 }}
        className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <LayoutDashboard size={20} className="text-indigo-600" /> Recent Executions
          </h3>
          <button className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors group">
            View All <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </button>
        </div>

        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-white border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Distributor</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Verified Value</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentTickets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                    <Store size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-semibold">No recent execution data available.</p>
                  </td>
                </tr>
              ) : (
                recentTickets.map(ticket => {
                  const dist = distMap[ticket.distributorId];
                  let statusBadge = (
                    <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50/80 px-2.5 py-1 rounded-md border border-amber-200/60 w-max ml-auto">
                      <Clock size={12} /> Scheduled
                    </span>
                  );
                  if (ticket.status === 'in_progress') {
                    statusBadge = (
                      <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50/80 px-2.5 py-1 rounded-md border border-indigo-200/60 w-max ml-auto">
                        <PlayCircle size={12} /> In Progress
                      </span>
                    );
                  } else if (['auditor_submitted', 'submitted', 'drainage_pending'].includes(ticket.status)) {
                    statusBadge = (
                      <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-fuchsia-700 bg-fuchsia-50/80 px-2.5 py-1 rounded-md border border-fuchsia-200/60 w-max ml-auto">
                        <FileSignature size={12} /> Pending Review
                      </span>
                    );
                  } else if (ticket.status === 'closed' || ticket.status === 'completed') {
                    statusBadge = (
                      <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-md border border-emerald-200/60 w-max ml-auto">
                        <CheckCircle2 size={12} /> Closed
                      </span>
                    );
                  }
                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-[12px] bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 border border-slate-200/50 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                            <Store size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{dist?.name || 'Unknown'}</p>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-wide">{dist?.code || 'No Code'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-slate-700">
                          {ticket.scheduledDate
                            ? new Date(ticket.scheduledDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                            : '—'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-bold text-slate-700">
                          <IndianRupee size={14} className="text-slate-400" />
                          {(ticket.verifiedTotal || 0).toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">{statusBadge}</td>
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