import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor } from '../types';
import { useAuth, cn } from '../App';
import { LayoutDashboard, TrendingUp, CheckCircle2, Clock, AlertCircle, PlayCircle, Store, IndianRupee, ArrowUpRight, Activity, CalendarDays, FileSignature } from 'lucide-react';
import { motion } from 'motion/react';
import { startOfMonth, endOfMonth } from 'date-fns';

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
          const validTickets = (tData as AuditTicket[]).filter(t => fetchedDistributors.some(d => d.id === t.distributorId));
          setTickets(validTickets);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
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

  // --- METRICS CALCULATION ---
  const currentMonthStart = startOfMonth(new Date()).toISOString();
  const currentMonthEnd = endOfMonth(new Date()).toISOString();

  const metrics = useMemo(() => {
    const active = tickets.filter(t => ['scheduled', 'in_progress', 'auditor_submitted', 'submitted', 'drainage_pending'].includes(t.status));
    const completedThisMonth = tickets.filter(t => t.status === 'closed' && t.updatedAt && t.updatedAt >= currentMonthStart && t.updatedAt <= currentMonthEnd);
    const requiresAction = tickets.filter(t => ['tentative', 'auditor_submitted', 'submitted'].includes(t.status));
    
    const totalVerifiedValue = completedThisMonth.reduce((sum, t) => sum + (t.verifiedTotal || 0), 0);

    return {
      activeCount: active.length,
      completedCount: completedThisMonth.length,
      actionCount: requiresAction.length,
      totalValue: totalVerifiedValue
    };
  }, [tickets, currentMonthStart, currentMonthEnd]);

  // --- RECENT TICKETS FOR TABLE ---
  const recentTickets = useMemo(() => {
    return [...tickets]
      .filter(t => t.status !== 'tentative') // Hide raw negotiations from dashboard view
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);
  }, [tickets]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 animate-pulse">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-slate-200 h-32 rounded-[2rem]"></div>)}
        </div>
        <div className="bg-slate-200 h-96 rounded-[2rem] animate-pulse mt-8"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Overview</h2>
          <p className="text-sm font-medium text-slate-500 mt-1">Here is what's happening with your audits today.</p>
        </div>
        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-sm w-fit">
          <CalendarDays size={16} className="text-indigo-600" />
          <span className="text-xs font-bold text-slate-700">{new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full">
        
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
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
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><LayoutDashboard size={20} className="text-indigo-600"/> Recent Executions</h3>
          <button className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors group">
            View All <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"/>
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
                  
                  // Refined Status Badges
                  let statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50/80 px-2.5 py-1 rounded-md border border-amber-200/60 w-max ml-auto"><Clock size={12}/> Scheduled</span>;
                  
                  if (ticket.status === 'in_progress') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50/80 px-2.5 py-1 rounded-md border border-indigo-200/60 w-max ml-auto"><PlayCircle size={12}/> In Progress</span>;
                  } else if (['auditor_submitted', 'submitted', 'drainage_pending'].includes(ticket.status)) {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-fuchsia-700 bg-fuchsia-50/80 px-2.5 py-1 rounded-md border border-fuchsia-200/60 w-max ml-auto"><FileSignature size={12}/> Pending Review</span>;
                  } else if (ticket.status === 'closed' || ticket.status === 'completed') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-md border border-emerald-200/60 w-max ml-auto"><CheckCircle2 size={12}/> Closed</span>;
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
                        <p className="text-sm font-semibold text-slate-700">{ticket.scheduledDate ? new Date(ticket.scheduledDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric'}) : '-'}</p>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-bold text-slate-700">
                          <IndianRupee size={14} className="text-slate-400" />
                          {(ticket.verifiedTotal || 0).toLocaleString('en-IN')}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        {statusBadge}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

    </div>
  );
}