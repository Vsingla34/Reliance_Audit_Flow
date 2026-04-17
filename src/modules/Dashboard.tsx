import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth, cn } from '../App';
import { AuditTicket, Distributor } from '../types';
import { 
  TrendingUp, Store, ClipboardCheck, AlertCircle, 
  Clock, CheckCircle2, IndianRupee, Activity, PlaySquare, ShieldAlert
} from 'lucide-react';
import { motion } from 'motion/react';


const StatCard = ({ title, value, subtitle, icon: Icon, colorClass, delay }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }} 
    animate={{ opacity: 1, y: 0 }} 
    transition={{ delay }}
    className="bg-white p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm flex flex-col justify-between"
  >
    <div className="flex justify-between items-start mb-4">
      <div className={cn("p-3 rounded-2xl", colorClass)}>
        <Icon size={24} />
      </div>
    </div>
    <div>
      <h3 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">{value}</h3>
      <p className="font-bold text-zinc-900 mt-1 text-sm sm:text-base">{title}</p>
      <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{subtitle}</p>
    </div>
  </motion.div>
);

export function DashboardModule() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!profile) return;
      try {

        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase') dQuery = dQuery.eq('aseId', profile.uid);
        else if (profile.role === 'asm') dQuery = dQuery.eq('asmId', profile.uid);
        else if (profile.role === 'sm') dQuery = dQuery.eq('smId', profile.uid);
        else if (profile.role === 'dm') dQuery = dQuery.eq('dmId', profile.uid);

        const { data: dData } = await dQuery;
        const fetchedDistributors = (dData || []) as Distributor[];
        setDistributors(fetchedDistributors);

        // Fetch Tickets
        let tQuery = supabase.from('auditTickets').select('*');
        if (profile.role === 'auditor') {
          tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
          const distIds = fetchedDistributors.map(d => d.id);
          if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
          else {
            setTickets([]);
            setLoading(false);
            return;
          }
        }

        const { data: tData } = await tQuery;
        if (tData) setTickets(tData as AuditTicket[]);

      } catch (error) {
        console.error("Dashboard fetch error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [profile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-zinc-200 border-t-black"></div>
      </div>
    );
  }

  // --- STRICT SECURITY CHECK ---
  // If a user forces their way to this component but isn't an authorized role, block them completely.
  if (!['superadmin', 'admin', 'ho'].includes(profile?.role || '')) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] w-full p-4">
        <div className="bg-red-50 border border-red-100 p-8 rounded-[2rem] max-w-md w-full text-center shadow-sm">
          <ShieldAlert className="text-red-500 w-16 h-16 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-red-700 font-medium">The Executive Overview Dashboard is restricted to Administrators and Head Office personnel.</p>
        </div>
      </div>
    );
  }

  // --- STAT CALCULATIONS ---
  const activeTickets = tickets.filter(t => ['scheduled', 'in_progress', 'auditor_submitted', 'drainage_pending'].includes(t.status));
  const pendingSignoff = tickets.filter(t => ['submitted', 'evidence_uploaded'].includes(t.status));
  const completedTickets = tickets.filter(t => ['signed', 'closed'].includes(t.status));
  
  const totalVerifiedValue = tickets.reduce((sum, t) => sum + (t.verifiedTotal || 0), 0);
  const totalApprovedLimit = distributors.reduce((sum, d) => sum + (d.approvedValue || 0), 0);
  
  const budgetUtilization = totalApprovedLimit > 0 ? (totalVerifiedValue / totalApprovedLimit) * 100 : 0;

  // Recent 5 updates
  const recentTickets = [...tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5);

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full">
      
      {/* Welcome Banner */}
      <div className="bg-black text-white rounded-[1.5rem] sm:rounded-[2rem] p-6 sm:p-8 relative overflow-hidden shadow-xl shadow-black/10">
        <div className="relative z-10">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">Welcome back, {profile?.name?.split(' ')[0]}! 👋</h2>
          <p className="text-zinc-400 text-sm sm:text-base max-w-xl">
            Here is what's happening with your audit operations today. You have {activeTickets.length} active audits currently in the pipeline.
          </p>
        </div>
        <Activity className="absolute right-[-5%] bottom-[-20%] text-zinc-800 opacity-20 w-48 h-48 sm:w-64 sm:h-64 pointer-events-none" />
      </div>

      {/* Responsive Grid for Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard 
          title="Active Audits" 
          value={activeTickets.length} 
          subtitle="Currently in execution" 
          icon={PlaySquare} 
          colorClass="bg-blue-50 text-blue-600" 
          delay={0.1}
        />
        <StatCard 
          title="Pending Sign-offs" 
          value={pendingSignoff.length} 
          subtitle="Awaiting final approval" 
          icon={Clock} 
          colorClass="bg-amber-50 text-amber-600" 
          delay={0.2}
        />
        <StatCard 
          title="Completed" 
          value={completedTickets.length} 
          subtitle="Fully finalized audits" 
          icon={CheckCircle2} 
          colorClass="bg-emerald-50 text-emerald-600" 
          delay={0.3}
        />
        <StatCard 
          title="Value Verified" 
          value={`₹${(totalVerifiedValue / 100000).toFixed(1)}L`} 
          subtitle={`${budgetUtilization.toFixed(1)}% of total limit utilized`} 
          icon={IndianRupee} 
          colorClass="bg-purple-50 text-purple-600" 
          delay={0.4}
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        
        {/* Recent Activity Table */}
        <div className="lg:col-span-2 bg-white rounded-[1.5rem] sm:rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 sm:p-6 lg:p-8 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <h3 className="text-lg sm:text-xl font-bold tracking-tight">Recent Audits</h3>
              <p className="text-xs sm:text-sm text-zinc-500">Latest updates across your network.</p>
            </div>
          </div>
          <div className="flex-1 overflow-x-auto custom-scrollbar">
            <div className="min-w-[600px] w-full p-2">
              {recentTickets.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-100">
                      <th className="pb-3 pl-4">Distributor</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Verified Value</th>
                      <th className="pb-3 text-right pr-4">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTickets.map(t => {
                      const dist = distributors.find(d => d.id === t.distributorId);
                      return (
                        <tr key={t.id} className="hover:bg-zinc-50 transition-colors group">
                          <td className="py-4 pl-4 border-b border-zinc-50">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                                <Store size={14} className="text-zinc-600" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm text-zinc-900 truncate">{dist?.name || 'Unknown'}</p>
                                <p className="text-[10px] text-zinc-500 font-mono">{dist?.code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 border-b border-zinc-50">
                            <span className="px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-zinc-100 text-zinc-600">
                              {t.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-4 border-b border-zinc-50">
                            <p className="font-bold text-sm text-zinc-900">₹{(t.verifiedTotal || 0).toLocaleString()}</p>
                          </td>
                          <td className="py-4 pr-4 border-b border-zinc-50 text-right text-xs text-zinc-500">
                            {new Date(t.updatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12 text-zinc-400">
                  <ClipboardCheck size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="font-bold">No active audits found.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Links / Alert Panel */}
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-zinc-900 text-white rounded-[1.5rem] sm:rounded-[2rem] p-6 shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="text-emerald-400" size={24} />
              <h3 className="font-bold text-lg">System Health</h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-zinc-400">Budget Utilization</span>
                  <span className={budgetUtilization > 90 ? 'text-red-400' : 'text-emerald-400'}>
                    {budgetUtilization.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5">
                  <div 
                    className={cn("h-1.5 rounded-full", budgetUtilization > 90 ? "bg-red-500" : "bg-emerald-500")} 
                    style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Alerts Card */}
          <div className="bg-white border border-zinc-200 rounded-[1.5rem] sm:rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <AlertCircle className="text-amber-500" size={20} /> Attention Needed
            </h3>
            <div className="space-y-3">
              {pendingSignoff.length > 0 ? (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-sm font-bold text-amber-900">{pendingSignoff.length} audits pending sign-off.</p>
                  <p className="text-xs text-amber-700 mt-0.5">Please review and finalize them.</p>
                </div>
              ) : (
                <p className="text-sm text-zinc-500 italic">All caught up! No alerts.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}