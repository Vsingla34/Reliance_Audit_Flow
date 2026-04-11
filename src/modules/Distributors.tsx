import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../supabase';
import { Distributor, UserProfile } from '../types';
import { 
  Plus, Search, Store, MapPin, Edit2, Trash2, X, Upload, Download,
  IndianRupee, User as UserIcon, Network, Filter, ChevronLeft, ChevronRight, Mail, Send, Loader2
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function DistributorsModule() {
  const { profile, user } = useAuth();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [filterAse, setFilterAse] = useState('all');
  const [filterAsm, setFilterAsm] = useState('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  
  // --- BULK EMAIL STATE ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  
  // Changed to an array to support MULTI-SELECT
  const [emailTargetRoles, setEmailTargetRoles] = useState<string[]>(['aseId']);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25; 
  
  const [editingDist, setEditingDist] = useState<Distributor | null>(null);
  const [formData, setFormData] = useState<Partial<Distributor>>({
    code: '', anchorName: '', name: '', approvedValue: 0, hoId: '', dmId: '', smId: '', asmId: '', aseId: '', active: true, address: '', city: '', state: '', region: ''
  });

  const fetchData = async () => {
    if (!profile) return;
    try {
      let distQuery = supabase.from('distributors').select('*');
      if (profile.role === 'ase') distQuery = distQuery.eq('aseId', profile.uid);
      if (profile.role === 'asm') distQuery = distQuery.eq('asmId', profile.uid);
      if (profile.role === 'sm') distQuery = distQuery.eq('smId', profile.uid);
      if (profile.role === 'dm') distQuery = distQuery.eq('dmId', profile.uid);

      const [distRes, usersRes] = await Promise.all([
        distQuery.order('name', { ascending: true }),
        supabase.from('users').select('*')
      ]);
      
      if (distRes.error) throw distRes.error;
      if (usersRes.error) throw usersRes.error;

      if (distRes.data) setDistributors(distRes.data as Distributor[]);
      if (usersRes.data) setUsers(usersRes.data as UserProfile[]);
    } catch (error) { console.error("Error fetching data:", error); }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('distributors-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'distributors' }, fetchData).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterAse, filterAsm]);

  const filteredDistributors = distributors.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (d.anchorName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (d.city?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesAse = filterAse === 'all' || d.aseId === filterAse;
    const matchesAsm = filterAsm === 'all' || d.asmId === filterAsm;
    return matchesSearch && matchesAse && matchesAsm;
  });

  const totalPages = Math.ceil(filteredDistributors.length / itemsPerPage);
  const paginatedDistributors = filteredDistributors.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDistributors.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDistributors.map(d => d.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const roleDisplayMap: Record<string, string> = {
    hoId: 'HO', dmId: 'DM', smId: 'SM', asmId: 'ASM', aseId: 'ASE'
  };

  // --- DYNAMIC MULTI-SELECT SEND EMAIL LOGIC ---
  const handleSendBulkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    if (emailTargetRoles.length === 0) {
      alert("Please select at least one target role.");
      return;
    }
    
    const selectedDistributors = distributors.filter(d => selectedIds.has(d.id));
    const targetEmailSet = new Set<string>();

    // Loop through every distributor, and inside, loop through every selected role
    selectedDistributors.forEach(d => {
      emailTargetRoles.forEach(roleKey => {
        const targetId = d[roleKey as keyof Distributor] as string;
        if (targetId) {
          const targetUser = users.find(u => u.uid === targetId);
          if (targetUser && targetUser.email && targetUser.email.trim() !== '') {
            targetEmailSet.add(targetUser.email.trim());
          }
        }
      });
    });

    const emails = Array.from(targetEmailSet);
    const roleNames = emailTargetRoles.map(r => roleDisplayMap[r]).join(', ');

    if (emails.length === 0) {
      alert(`None of the selected distributors have assigned users in the roles: ${roleNames} with valid email addresses.`);
      return;
    }

    setIsSendingEmail(true);
    try {
      const { error } = await supabase.functions.invoke('send-email', {
        body: { emails, subject: emailSubject, message: emailBody }
      });
      
      if (error) throw error;
      
      logActivity(user, profile, "Bulk Email Sent", `Sent email to ${emails.length} user(s) (${roleNames}) regarding selected distributors. Subject: "${emailSubject}"`);
      
      alert(`Successfully sent email to ${emails.length} user(s) in roles: ${roleNames}!`);
      setIsEmailModalOpen(false);
      setEmailSubject('');
      setEmailBody('');
      setSelectedIds(new Set());
      setEmailTargetRoles(['aseId']); // Reset to default
      
    } catch (error: any) {
      console.error("Email error full details:", error);
      let realMessage = error.message;
      if (error.context) {
        try {
          const contextData = await error.context.json();
          realMessage = contextData.error || error.message;
        } catch (e) {
          // Fallback if parsing fails
        }
      }
      alert(`Failed to send emails: ${realMessage}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitizedData = { ...formData };
      const fkFields: (keyof Distributor)[] = ['hoId', 'dmId', 'smId', 'asmId', 'aseId'];
      fkFields.forEach(field => { if (sanitizedData[field] === '') sanitizedData[field] = null as any; });

      if (editingDist) {
        const { error } = await supabase.from('distributors').update(sanitizedData).eq('id', editingDist.id);
        if (error) throw error;
        await supabase.from('auditTickets').update({ approvedValue: sanitizedData.approvedValue, maxAllowedValue: (sanitizedData.approvedValue || 0) * 1.05 }).eq('distributorId', editingDist.id).in('status', ['tentative', 'scheduled', 'in_progress']);
      } else {
        const newDistId = Math.random().toString(36).substring(7);
        const { error } = await supabase.from('distributors').insert([{ ...sanitizedData, id: newDistId }]);
        if (error) throw error;
        const tentativeTicket = {
          id: Math.random().toString(36).substring(7), distributorId: newDistId, proposedDate: null, auditorId: null, approvedValue: sanitizedData.approvedValue, maxAllowedValue: (sanitizedData.approvedValue || 0) * 1.05, status: 'tentative', verifiedTotal: 0, dateProposals: [], comments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        await supabase.from('auditTickets').insert([tentativeTicket]);
      }
      setIsModalOpen(false); setEditingDist(null); resetForm(); fetchData();
    } catch (error: any) { alert(`Failed to save distributor: ${error.message}`); }
  };

  const deleteDist = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this distributor?")) {
      try {
        const { data: tickets } = await supabase.from('auditTickets').select('id').eq('distributorId', id);
        if (tickets && tickets.length > 0) {
          const ticketIds = tickets.map(t => t.id);
          await supabase.from('auditLineItems').delete().in('ticketId', ticketIds);
          await supabase.from('auditTickets').delete().in('id', ticketIds);
        }
        await supabase.from('distributors').delete().eq('id', id);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      } catch (error) { alert("Failed to delete distributor."); }
    }
  };

  const resetForm = () => { setFormData({ code: '', anchorName: '', name: '', approvedValue: 0, hoId: '', dmId: '', smId: '', asmId: '', aseId: '', active: true, address: '', city: '', state: '', region: '' }); };

  const openEditModal = (dist: Distributor) => {
    setEditingDist(dist);
    setFormData({ ...dist, hoId: dist.hoId || '', dmId: dist.dmId || '', smId: dist.smId || '', asmId: dist.asmId || '', aseId: dist.aseId || '', anchorName: dist.anchorName || '', region: dist.region || '' });
    setIsModalOpen(true);
  };

  const downloadTemplate = () => {
    const csvContent = "Code,AnchorName,Name,ApprovedValue,HO_Email,DM_Email,SM_Email,ASM_Email,ASE_Email,Region,City,State\nDIST-001,Reliance,Reliance Smart Point,500000,,,,asm@comp.com,ase@comp.com,North,Delhi,Delhi";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = "Distributor_Import_Template.csv"; link.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== '');
        
        const findUserId = (emailStr: string, role: string) => {
          if (!emailStr || !emailStr.trim()) return null;
          const u = users.find(user => user.email.toLowerCase() === emailStr.trim().toLowerCase() && user.role === role);
          return u ? u.uid : null;
        };

        const newDistributors = lines.slice(1).map(line => {
          const [code, anchorName, name, approvedValue, hoEmail, dmEmail, smEmail, asmEmail, aseEmail, region, city, state] = line.split(',');
          if (!code || !name) return null;
          return {
            id: Math.random().toString(36).substring(7), code: code.trim(), anchorName: anchorName?.trim() || '', name: name.trim(), approvedValue: parseFloat(approvedValue) || 0, hoId: findUserId(hoEmail, 'ho'), dmId: findUserId(dmEmail, 'dm'), smId: findUserId(smEmail, 'sm'), asmId: findUserId(asmEmail, 'asm'), aseId: findUserId(aseEmail, 'ase'), region: region?.trim() || '', city: city?.trim() || '', state: state?.trim() || '', active: true
          };
        }).filter(Boolean);

        if (newDistributors.length > 0) {
          await supabase.from('distributors').insert(newDistributors);
          alert(`Successfully imported ${newDistributors.length} distributors!`);
        }
      } catch (error: any) { alert(`Failed to import. Make sure your CSV matches the template.`); } 
      finally { setIsImportModalOpen(false); if (e.target) e.target.value = ''; }
    };
    reader.readAsText(file);
  };

  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');
  const ases = users.filter(u => u.role === 'ase');
  const asms = users.filter(u => u.role === 'asm');

  const renderUserSelect = (label: string, roleFilter: string, fieldName: keyof Distributor) => (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</label>
      <select className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={(formData[fieldName] as string) || ''} onChange={(e) => setFormData({ ...formData, [fieldName]: e.target.value })}>
        <option value="">Unassigned...</option>
        {users.filter(u => u.role === roleFilter && u.active).map(u => (
          <option key={u.uid} value={u.uid}>{u.name} {u.region ? `(${u.region})` : ''}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col xl:flex-row justify-between gap-6">
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
            <input type="text" placeholder="Search distributors..." className="w-full pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-0 focus:border-black transition-all shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>

          {profile?.role !== 'ase' && (
            <div className="flex items-center gap-4">
              {['superadmin', 'admin', 'ho', 'dm', 'sm'].includes(profile?.role || '') && (
                <div className="relative group">
                  <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={16} />
                  <select className="w-full md:w-auto min-w-[160px] pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-black outline-none shadow-sm cursor-pointer appearance-none font-medium" value={filterAsm} onChange={(e) => setFilterAsm(e.target.value)}>
                    <option value="all">All ASMs</option>{asms.map(a => <option key={a.uid} value={a.uid}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div className="relative group">
                <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={16} />
                <select className="w-full md:w-auto min-w-[160px] pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-black outline-none shadow-sm cursor-pointer appearance-none font-medium" value={filterAse} onChange={(e) => setFilterAse(e.target.value)}>
                  <option value="all">All ASEs</option>{ases.map(a => <option key={a.uid} value={a.uid}>{a.name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        
        {isAdminOrHO && (
          <div className="flex flex-wrap md:flex-nowrap gap-4">
            <AnimatePresence>
              {selectedIds.size > 0 && (
                <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} onClick={() => setIsEmailModalOpen(true)} className="flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 active:scale-95 whitespace-nowrap">
                  <Mail size={20} /> Email Team ({selectedIds.size})
                </motion.button>
              )}
            </AnimatePresence>
            <button onClick={() => setIsImportModalOpen(true)} className="flex items-center justify-center gap-2 px-6 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95 whitespace-nowrap"><Upload size={20} /> Import</button>
            <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="flex items-center justify-center gap-2 px-6 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 whitespace-nowrap"><Plus size={20} /> Add Distributor</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-zinc-50/50 border-b border-zinc-100">
                {isAdminOrHO && (
                  <th className="px-6 py-5 w-10">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer"
                      checked={selectedIds.size === filteredDistributors.length && filteredDistributors.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Distributor</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Region / Location</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Hierarchy (ASE)</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Approved Limit</th>
                {isAdminOrHO && <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {paginatedDistributors.map((dist) => (
                <tr key={dist.id} className={cn("hover:bg-zinc-50/50 transition-colors group", selectedIds.has(dist.id) && "bg-blue-50/30")}>
                  {isAdminOrHO && (
                    <td className="px-6 py-5">
                      <input 
                        type="checkbox" 
                        className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer"
                        checked={selectedIds.has(dist.id)}
                        onChange={() => toggleSelect(dist.id)}
                      />
                    </td>
                  )}
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors", selectedIds.has(dist.id) ? "bg-blue-100 text-blue-600" : "bg-zinc-100 text-zinc-500")}>
                        <Store size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-zinc-900">{dist.name}</p>
                          {!dist.active && <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">Inactive</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded inline-block">{dist.code}</p>
                          {dist.anchorName && <p className="text-[10px] font-bold uppercase tracking-wider text-purple-600 bg-purple-50 px-2 py-0.5 rounded inline-block">Anchor: {dist.anchorName}</p>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex flex-col gap-1">
                      {dist.region && <span className="text-xs font-bold text-zinc-900">{dist.region}</span>}
                      <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                        <MapPin size={12} className="shrink-0" />
                        <span className="truncate max-w-[150px]">{dist.city || 'No City'}{dist.state ? `, ${dist.state}` : ''}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2 bg-zinc-50 px-3 py-1.5 rounded-xl inline-flex border border-zinc-100">
                      <Network size={14} className="text-zinc-400 shrink-0" />
                      <span className="text-sm font-medium text-zinc-700 truncate max-w-[120px]">{users.find(u => u.uid === dist.aseId)?.name || 'No ASE Assigned'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-1 font-bold text-zinc-900 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl inline-flex border border-emerald-100/50">
                      <IndianRupee size={14} /><span>{dist.approvedValue.toLocaleString('en-IN')}</span>
                    </div>
                  </td>
                  
                  {isAdminOrHO && (
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(dist)} className="p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-xl transition-all" title="Edit Distributor"><Edit2 size={16} /></button>
                        <button onClick={() => deleteDist(dist.id)} className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Delete Distributor"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredDistributors.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-8 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-400"><Store size={48} className="mb-4 text-zinc-200" /><p className="text-lg font-medium text-zinc-900 mb-1">No distributors found</p></div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredDistributors.length > 0 && (
          <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex flex-col md:flex-row items-center justify-between gap-4">
            <span className="text-sm font-medium text-zinc-500">
              Showing <span className="font-bold text-zinc-900">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-bold text-zinc-900">{Math.min(currentPage * itemsPerPage, filteredDistributors.length)}</span> of <span className="font-bold text-zinc-900">{filteredDistributors.length}</span> distributors
            </span>
            
            <div className="flex items-center gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 transition-colors"><ChevronLeft size={18} /></button>
              <span className="text-sm font-bold text-zinc-700 px-4">Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 transition-colors"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}
      </div>

      {/* --- BULK EMAIL MODAL WITH MULTI-SELECT --- */}
      <AnimatePresence>
        {isEmailModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isSendingEmail && setIsEmailModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
              
              <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center"><Mail className="text-blue-600" size={24} /></div>
                  <div>
                    <h4 className="text-2xl font-bold tracking-tight">Email Distributor Team</h4>
                    <p className="text-sm font-bold text-blue-600 mt-1">Notifying selected roles for {selectedIds.size} distributor(s)</p>
                  </div>
                </div>
                <button type="button" onClick={() => !isSendingEmail && setIsEmailModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X size={20} /></button>
              </div>
              
              {/* Added flex-1 min-h-0 here for scrolling */}
              <div className="p-6 md:p-8 flex-1 min-h-0 overflow-y-auto bg-zinc-50/50 custom-scrollbar">
                <form id="bulk-email-form" onSubmit={handleSendBulkEmail} className="space-y-6">
                  
                  {/* --- MULTI-SELECT TARGET ROLES --- */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Select Target Roles (Multi-Select)</label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[
                        { id: 'hoId', label: 'Head Office (HO)' },
                        { id: 'dmId', label: 'Division Manager (DM)' },
                        { id: 'smId', label: 'Sales Manager (SM)' },
                        { id: 'asmId', label: 'Area Sales Mgr (ASM)' },
                        { id: 'aseId', label: 'Area Sales Exec (ASE)' }
                      ].map(role => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            if (emailTargetRoles.includes(role.id)) {
                              if (emailTargetRoles.length > 1) {
                                setEmailTargetRoles(emailTargetRoles.filter(r => r !== role.id));
                              }
                            } else {
                              setEmailTargetRoles([...emailTargetRoles, role.id]);
                            }
                          }}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-xl border transition-all active:scale-95",
                            emailTargetRoles.includes(role.id)
                              ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                              : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                          )}
                        >
                          {role.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Subject</label>
                    <input required type="text" placeholder="Important Policy Update..." className="w-full mt-2 px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm font-bold text-lg" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Message</label>
                    <textarea required rows={6} placeholder={`Dear Team,\n\nWe are writing to inform you...`} className="w-full mt-2 p-4 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm resize-none custom-scrollbar" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
                  </div>
                </form>
              </div>
              
              <div className="p-6 md:p-8 border-t border-zinc-100 shrink-0 bg-white flex justify-end gap-3">
                <button type="button" onClick={() => setIsEmailModalOpen(false)} disabled={isSendingEmail} className="px-6 py-4 text-sm font-bold text-zinc-500 hover:text-black transition-colors disabled:opacity-50">Cancel</button>
                <button type="submit" form="bulk-email-form" disabled={isSendingEmail} className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 active:scale-95 flex items-center gap-2">
                  {isSendingEmail ? <><Loader2 size={18} className="animate-spin" /> Sending...</> : <><Send size={18} /> Send</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
              
              <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center"><Store className="text-black" size={20} /></div>
                  <div><h4 className="text-xl md:text-2xl font-bold tracking-tight">{editingDist ? 'Edit Distributor' : 'Add New Distributor'}</h4><p className="text-sm text-zinc-500">Configure hierarchy mapping and details.</p></div>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X size={20} /></button>
              </div>
              
              {/* Added flex-1 min-h-0 here for scrolling */}
              <div className="p-6 md:p-8 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <form id="distributor-form" onSubmit={handleSubmit} className="space-y-8">
                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-black"></span> Identification</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Code *</label><input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. DIST-001" /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Name *</label><input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Company Name Ltd." /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Anchor Name</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.anchorName} onChange={(e) => setFormData({ ...formData, anchorName: e.target.value })} placeholder="e.g. Reliance" /></div>
                    </div>
                  </div>

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Management Hierarchy Mapping</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 bg-purple-50/50 p-6 rounded-3xl border border-purple-100">
                      {renderUserSelect("Head Office", "ho", "hoId")}
                      {renderUserSelect("Division Mgr (DM)", "dm", "dmId")}
                      {renderUserSelect("Sales Mgr (SM)", "sm", "smId")}
                      {renderUserSelect("Area Sales Mgr", "asm", "asmId")}
                      {renderUserSelect("Area Sales Exec", "ase", "aseId")}
                    </div>
                  </div>

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Financials & Location</h5>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Budget Limit (₹) *</label><input required type="number" min="0" className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-blue-500 transition-all font-medium" value={formData.approvedValue} onChange={(e) => setFormData({ ...formData, approvedValue: parseFloat(e.target.value) })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Region</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} placeholder="North" /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">City</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">State</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} /></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-100 w-max">
                    <input type="checkbox" id="distActive" className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} />
                    <label htmlFor="distActive" className="text-sm font-bold cursor-pointer select-none">Active Distributor</label>
                  </div>
                </form>
              </div>
              
              <div className="p-6 md:p-8 border-t border-zinc-100 shrink-0 bg-white z-10 flex justify-end">
                <button type="submit" form="distributor-form" className="px-12 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 text-lg">
                  {editingDist ? 'Save Changes' : 'Create Distributor'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}