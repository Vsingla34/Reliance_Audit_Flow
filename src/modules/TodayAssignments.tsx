import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, UserProfile } from '../types';
import { CalendarRange, Store, User as UserIcon, IndianRupee, MapPin, Search, CheckCircle2, Clock, PlayCircle, FileSignature } from 'lucide-react';
import { cn, useAuth } from '../App';

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

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-zinc-400"><span className="animate-pulse font-bold">Loading today's assignments...</span></div>;
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
            <CalendarRange className="text-blue-600" size={24} /> Today's Action Plan
          </h3>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="relative w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search by distributor or auditor..." 
            className="w-full pl-11 pr-4 py-3 sm:py-3.5 bg-white border border-zinc-200 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm font-medium" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>
      </div>

      {/* Stats/Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total Scheduled</p>
          <p className="text-2xl font-black text-zinc-900 mt-1">{tickets.length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Not Started</p>
          <p className="text-2xl font-black text-amber-600 mt-1">{tickets.filter(t => t.status === 'scheduled').length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">In Progress / Review</p>
          <p className="text-2xl font-black text-blue-600 mt-1">{tickets.filter(t => ['in_progress', 'auditor_submitted', 'submitted', 'drainage_pending'].includes(t.status)).length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Fully Closed</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{tickets.filter(t => t.status === 'closed').length}</p>
        </div>
      </div>

      {/* Assignments Table */}
      <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm overflow-hidden w-full">
        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Distributor Details</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Address & Location</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Assigned Auditor(s)</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Audit Value</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400">
                    <CalendarRange size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No audits scheduled for today.</p>
                  </td>
                </tr>
              ) : (
                filteredTickets.map(ticket => {
                  const dist = distMap[ticket.distributorId];
                  const auditorNames = ticket.auditorIds?.map(id => userMap[id]?.name).filter(Boolean) || [];

                  // Determine Advanced Status UI
                  let statusBadge = <span className="flex justify-end items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 w-max ml-auto"><Clock size={14}/> Scheduled</span>;
                  
                  if (ticket.status === 'in_progress') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 w-max ml-auto"><PlayCircle size={14}/> Occurring Now</span>;
                  } else if (['auditor_submitted', 'submitted', 'drainage_pending'].includes(ticket.status)) {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200 w-max ml-auto"><FileSignature size={14}/> Pending Review</span>;
                  } else if (ticket.status === 'closed' || ticket.status === 'completed') {
                    statusBadge = <span className="flex justify-end items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 w-max ml-auto"><CheckCircle2 size={14}/> Closed</span>;
                  }

                  return (
                    <tr key={ticket.id} className="hover:bg-zinc-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0">
                            <Store size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-zinc-900 text-sm">{dist?.name || 'Unknown'}</p>
                            <p className="text-[10px] sm:text-xs text-zinc-500 font-mono mt-0.5">{dist?.code || 'No Code'}</p>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <p className="text-xs text-zinc-700 max-w-[200px] truncate" title={dist?.address || 'Address not provided'}>
                            {dist?.address || 'Address not provided'}
                          </p>
                          <p className="text-[10px] sm:text-xs text-zinc-500 flex items-center gap-1 mt-1">
                            <MapPin size={12} className="shrink-0" /> {dist?.city || 'No City'}, {dist?.region || 'No Region'}
                          </p>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4">
                        {auditorNames.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {auditorNames.map((name, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-zinc-700">
                                <UserIcon size={14} className="text-zinc-400" /> {name}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded-md">Unassigned</span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50/50 px-3 py-1.5 rounded-lg border border-emerald-100 w-max">
                          <IndianRupee size={14} />
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
      </div>
    </div>
  );
}