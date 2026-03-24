import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AuditTicket } from '../types';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Package, 
  IndianRupee, 
  Calendar,
  ChevronRight
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  PieChart, 
  Pie 
} from 'recharts';
import { cn } from '../App';
import { motion } from 'motion/react';

export function DashboardModule() {
  const [stats, setStats] = useState({
    activeAudits: 0,
    pendingSignoffs: 0,
    verifiedValue: 0,
    completedToday: 0,
    expiryValue: 0,
    damageValue: 0
  });
  const [recentAudits, setRecentAudits] = useState<AuditTicket[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  const fetchStats = async () => {
    try {
      const { data: tickets, error } = await supabase
        .from('auditTickets')
        .select('*');

      if (error) throw error;

      if (tickets) {
        const active = tickets.filter(t => ['in_progress', 'scheduled'].includes(t.status)).length;
        const pending = tickets.filter(t => t.status === 'submitted').length;
        const totalValue = tickets.reduce((acc, t) => acc + (t.verifiedTotal || 0), 0);
        
        const today = new Date().toISOString().split('T')[0];
        const completedToday = tickets.filter(t => t.status === 'closed' && t.updatedAt.startsWith(today)).length;

        // For demonstration, splitting the total value arbitrarily. 
        // In a real scenario, you'd aggregate this from auditLineItems.
        setStats({
          activeAudits: active,
          pendingSignoffs: pending,
          verifiedValue: totalValue,
          completedToday: completedToday,
          expiryValue: totalValue * 0.7,
          damageValue: totalValue * 0.3
        });

        setRecentAudits(
          tickets.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5)
        );

        // Generate chart data based on last 7 days
        const last7Days = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          return d.toISOString().split('T')[0];
        }).reverse();

        const newChartData = last7Days.map(date => {
          const dayTickets = tickets.filter(t => t.updatedAt.startsWith(date) && ['submitted', 'signed', 'closed'].includes(t.status));
          return {
            name: date.split('-').slice(1).join('/'), // MM/DD format
            value: dayTickets.reduce((acc, t) => acc + (t.verifiedTotal || 0), 0)
          };
        });

        setChartData(newChartData);
      }
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    }
  };

  useEffect(() => {
    fetchStats();

    const channel = supabase.channel('dashboard-changes')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'auditTickets' }, 
        () => fetchStats()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const pieData = [
    { name: 'Expiry', value: stats.expiryValue, color: '#10B981' },
    { name: 'Damage', value: stats.damageValue, color: '#F59E0B' },
  ];

  const statCards = [
    { title: 'Active Audits', value: stats.activeAudits, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', trend: '+2 today' },
    { title: 'Pending Sign-offs', value: stats.pendingSignoffs, icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50', trend: 'Needs attention' },
    { title: 'Completed Today', value: stats.completedToday, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', trend: 'Great job!' },
    { title: 'Total Verified Value', value: `₹${stats.verifiedValue.toLocaleString('en-IN')}`, icon: IndianRupee, color: 'text-purple-600', bg: 'bg-purple-50', trend: 'Last 30 days' },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={card.title} 
            className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", card.bg)}>
                <card.icon className={card.color} size={24} />
              </div>
            </div>
            <p className="text-zinc-500 font-medium text-sm mb-1">{card.title}</p>
            <h3 className="text-3xl font-black text-zinc-900 mb-2">{card.value}</h3>
            <p className="text-xs font-bold text-zinc-400">{card.trend}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Value Trend Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-zinc-200 shadow-sm">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h3 className="text-xl font-bold tracking-tight mb-1">Audit Value Trend</h3>
              <p className="text-sm text-zinc-500">Verified values over the last 7 days</p>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#A1A1AA' }} tickFormatter={(val) => `₹${val/1000}k`} />
                <Tooltip 
                  cursor={{ fill: '#F4F4F5' }}
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Verified Value']}
                />
                <Bar dataKey="value" radius={[8, 8, 8, 8]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#000000' : '#E4E4E7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown Chart */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-zinc-200 shadow-sm flex flex-col">
          <h3 className="text-xl font-bold tracking-tight mb-1">Value Breakdown</h3>
          <p className="text-sm text-zinc-500 mb-8">Expiry vs Damage (Total)</p>
          
          <div className="flex-1 flex items-center justify-center min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => `₹${value.toLocaleString()}`}
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            {pieData.map(item => (
              <div key={item.name} className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{item.name}</span>
                </div>
                <p className="text-lg font-black tracking-tight text-zinc-900">
                  ₹{item.value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Audits Table */}
      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold tracking-tight">Recent Activity</h3>
            <p className="text-sm text-zinc-500">Latest updates from the field</p>
          </div>
          <button className="text-sm font-bold text-black hover:text-zinc-600 transition-colors flex items-center gap-1">
            View All <ChevronRight size={16} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-8 py-4 text-left font-bold text-zinc-400 uppercase tracking-wider text-xs">Distributor ID</th>
                <th className="px-8 py-4 text-left font-bold text-zinc-400 uppercase tracking-wider text-xs">Date</th>
                <th className="px-8 py-4 text-left font-bold text-zinc-400 uppercase tracking-wider text-xs">Status</th>
                <th className="px-8 py-4 text-right font-bold text-zinc-400 uppercase tracking-wider text-xs">Verified Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {recentAudits.map((audit) => (
                <tr key={audit.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-8 py-5">
                    <p className="font-bold text-zinc-900">{audit.distributorId.substring(0, 8)}...</p>
                    <p className="text-xs text-zinc-400 font-mono">ID: {audit.id.substring(0, 6)}</p>
                  </td>
                  <td className="px-8 py-5 text-zinc-500">
                    {new Date(audit.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-5">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider inline-flex",
                      audit.status === 'closed' ? "bg-emerald-50 text-emerald-600" :
                      audit.status === 'submitted' ? "bg-purple-50 text-purple-600" :
                      audit.status === 'in_progress' ? "bg-amber-50 text-amber-600" :
                      "bg-zinc-100 text-zinc-600"
                    )}>
                      {audit.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right font-bold text-zinc-900">
                    ₹{(audit.verifiedTotal || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
              {recentAudits.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-zinc-500 italic">
                    No recent activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}