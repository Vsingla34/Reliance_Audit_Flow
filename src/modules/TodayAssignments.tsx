import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, UserProfile } from '../types';
import { CalendarRange, Store, User as UserIcon, IndianRupee, MapPin, Search, CheckCircle2, Clock, PlayCircle, FileSignature } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion } from 'motion/react';

export function TodayAssignmentsModule() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Generate today's date string in local timezone (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    const todayObj = new Date();
    const localOffset = todayObj.getTimezoneOffset();
    const localToday = new Date(todayObj.getTime() - (localOffset * 60000));
    return localToday.toISOString().split('T')[0];
  }, []);

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
        // 1. Fetch Distributors based on Role
        let dQuery = supabase.from('distributors').select('*');
        if (profile.role === 'ase') dQuery = dQuery.contains('aseIds', [profile.uid]);
        else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm') dQuery = dQuery.contains('smIds', [profile.uid]);
        else if (profile.role === 'dm') dQuery = dQuery.contains('dmIds', [profile.uid]);
        
        const [dRes, uRes] = await Promise.all([dQuery, supabase.from('users').select('*')]);
        if (dRes.error) throw dRes.error;
        const fetchedDistributors = (dRes.data || []) as any[];
        setDistributors(fetchedDistributors);
        
        if (uRes.data) setAllUsers(uRes.data as UserProfile[]);

        // 2. Fetch Today's Tickets based on Role
        let tQuery = supabase.from('auditTickets').select('*').eq('scheduledDate', todayStr).neq('status', 'tentative');
        
        if (profile.role === 'auditor') {
          tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        } else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
          const distIds = fetchedDistributors.map(d => d.id);
          if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
          else { setTickets([]); setIsLoading(false); return; }
        }

        const tRes = await tQuery;
        if (tRes.error) throw tRes.error;
        if (tRes.data) {
          // Double check to ensure we only show tickets for valid distributors
          const validTickets = (tRes.data as AuditTicket[]).filter(t => fetchedDistributors.some(d => d.id === t.distributorId));
          setTickets(validTickets);
        }
      } catch (error) {
        console.error("Error fetching today's assignments:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // Setup real-time listener for today's tickets
    const channel = supabase.channel('today-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, todayStr]);

  // Search Filter
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const dist = distMap[t.distributorId];
      if (!dist) return false;
      const searchLower = searchTerm.toLowerCase();
      const distNameMatch = dist.name.toLowerCase().includes(searchLower);
      const auditorMatch = t.auditorIds?.some(id => userMap[id]?.name.toLowerCase().includes(searchLower));
      return distNameMatch || auditorMatch;
    });
  }, [tickets, distMap, userMap, searchTerm]);

  // --- SKELETON UI LOADING STATE ---
  if (isLoading) {
    return (
      <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0 animate-[pulse_1.2s_ease-in-out_infinite]">
        {/* Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <div>
            <div className="h-8 w-48 bg-slate-200 rounded-lg mb-2"></div>
            <div className="h-4 w-32 bg-slate-200 rounded-md"></div>
          </div>
          <div className="w-full sm:max-w-md h-12 bg-slate-200 rounded-xl sm:rounded-2xl"></div>
        </div>

        {/* Stats Row Skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center h-[90px]">
              <div className="h-3 w-24 bg-slate-100 rounded mb-3"></div>
              <div className="h-8 w-12 bg-slate-200 rounded-lg"></div>
            </div>
          ))}
        </div>

        {/* Table Skeleton */}
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between gap-4">
            <div className="h-4 w-1/4 bg-slate-200 rounded opacity-70"></div>
            <div className="h-4 w-1/4 bg-slate-200 rounded opacity-70 hidden sm:block"></div>
            <div className="h-4 w-1/4 bg-slate-200 rounded opacity-70 hidden md:block"></div>
            <div className="h-4 w-24 bg-slate-200 rounded opacity-70 ml-auto"></div>
          </div>
          <div className="divide-y divide-slate-50">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 sm:p-6 flex items-center justify-between">
                <div className="flex items-center gap-4 w-1/3">
                   <div className="w-10 h-10 rounded-[12px] bg-slate-200 shrink-0"></div>
                   <div className="w-full">
                     <div className="h-4 w-3/4 bg-slate-200 rounded mb-1.5"></div>
                     <div className="h-3 w-1/2 bg-slate-100 rounded"></div>
                   </div>
                </div>
                <div className="w-1/4 hidden sm:block">
                  <div className="h-4 w-24 bg-slate-200 rounded mb-1.5"></div>
                  <div className="h-3 w-20 bg-slate-100 rounded"></div>
                </div>
                <div className="w-1/5 hidden md:block">
                   <div className="h-4 w-16 bg-slate-200 rounded"></div>
                </div>
                <div className="h-6 w-24 bg-slate-200 rounded-md shrink-0 ml-auto"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* Header & Search */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2 tracking-tight">
            <CalendarRange className="text-indigo-600" size={24} /> Today's Action Plan
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="relative w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search by distributor or auditor..." 
            className="w-full pl-11 pr-4 py-3 sm:py-3.5 bg-white border border-slate-200 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm text-sm font-medium text-slate-700 placeholder:text-slate-400" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>
      </motion.div>

      {/* Stats/Summary Row */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center transition-shadow hover:shadow-md">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Scheduled</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{tickets.length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center transition-shadow hover:shadow-md">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Not Started</p>
          <p className="text-2xl font-black text-amber-600 mt-1">{tickets.filter(t => t.status === 'scheduled').length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center transition-shadow hover:shadow-md">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">In Progress / Review</p>
          <p className="text-2xl font-black text-indigo-600 mt-1">{tickets.filter(t => ['in_progress', 'auditor_submitted', 'submitted', 'drainage_pending'].includes(t.status)).length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center transition-shadow hover:shadow-md">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fully Closed</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{tickets.filter(t => t.status === 'closed').length}</p>
        </div>
      </motion.div>

      {/* Assignments Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full">
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
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <CalendarRange size={32} className="mx-auto mb-3 opacity-20 text-indigo-500" />
                    <p className="text-sm font-semibold">No audits scheduled for today.</p>
                  </td>
                </tr>
              ) : (
                filteredTickets.map(ticket => {
                  const dist = distMap[ticket.distributorId];
                  const auditorNames = ticket.auditorIds?.map(id => userMap[id]?.name).filter(Boolean) || [];

                  // Refined Status Badges matching Dashboard
                  let statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50/80 px-2.5 py-1 rounded-md border border-amber-200/60 w-max ml-auto"><Clock size={12}/> Scheduled</span>;
                  
                  if (ticket.status === 'in_progress') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50/80 px-2.5 py-1 rounded-md border border-indigo-200/60 w-max ml-auto"><PlayCircle size={12}/> Occurring Now</span>;
                  } else if (['auditor_submitted', 'submitted', 'drainage_pending'].includes(ticket.status)) {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-fuchsia-700 bg-fuchsia-50/80 px-2.5 py-1 rounded-md border border-fuchsia-200/60 w-max ml-auto"><FileSignature size={12}/> Pending Review</span>;
                  } else if (ticket.status === 'closed' || ticket.status === 'completed') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-md border border-emerald-200/60 w-max ml-auto"><CheckCircle2 size={12}/> Closed</span>;
                  }

                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-[12px] bg-slate-100 text-slate-500 border border-slate-200/50 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors flex items-center justify-center shrink-0">
                            <Store size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{dist?.name || 'Unknown'}</p>
                            <p className="text-[10px] sm:text-xs text-slate-500 font-mono mt-0.5 tracking-wide">{dist?.code || 'No Code'}</p>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <p className="text-xs font-medium text-slate-700 max-w-[200px] truncate" title={dist?.address || 'Address not provided'}>
                            {dist?.address || 'Address not provided'}
                          </p>
                          <p className="text-[10px] sm:text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <MapPin size={12} className="shrink-0" /> {dist?.city || 'No City'}, {dist?.region || 'No Region'}
                          </p>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4">
                        {auditorNames.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {auditorNames.map((name, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                                <UserIcon size={14} className="text-slate-400" /> {name}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] font-bold text-rose-500 bg-rose-50/80 px-2 py-0.5 rounded-md border border-rose-100">Unassigned</span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-bold text-slate-700">
                          <IndianRupee size={14} className="text-slate-400" />
                          {dist?.approvedValue ? dist.approvedValue.toLocaleString('en-IN') : '0'}
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