import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Distributor, UserProfile } from '../types';
import { Plus, Search, Store, MapPin, Edit2, Trash2, X, Upload, Download, IndianRupee, User as UserIcon, Network, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function DistributorsModule() {
  const { profile } = useAuth();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [filterAse, setFilterAse] = useState('all');
  const [filterAsm, setFilterAsm] = useState('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25; 
  
  const [editingDist, setEditingDist] = useState<Distributor | null>(null);
  const [formData, setFormData] = useState<Partial<Distributor>>({
    code: '', anchorName: '', name: '', email: '', contactPerson: '', contactNumber: '', address: '', city: '', state: '', region: '', approvedValue: 0, hoId: '', dmId: '', smId: '', asmId: '', aseId: '', active: true
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
      
      if (distRes.data) setDistributors(distRes.data as Distributor[]);
      if (usersRes.data) setUsers(usersRes.data as UserProfile[]);
    } catch (error) { console.error("Error fetching data:", error); }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('distributors-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'distributors' }, fetchData).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterAse, filterAsm]);

  const filteredDistributors = distributors.filter(d => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = d.name.toLowerCase().includes(searchLower) || 
                          d.code.toLowerCase().includes(searchLower) ||
                          (d.anchorName?.toLowerCase() || '').includes(searchLower) ||
                          (d.city?.toLowerCase() || '').includes(searchLower);
    const matchesAse = filterAse === 'all' || d.aseId === filterAse;
    const matchesAsm = filterAsm === 'all' || d.asmId === filterAsm;
    return matchesSearch && matchesAse && matchesAsm;
  });

  const totalPages = Math.ceil(filteredDistributors.length / itemsPerPage);
  const paginatedDistributors = filteredDistributors.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // SANITIZATION: Convert empty strings to proper database nulls to prevent UUID format crashes
      const sanitizedData = { ...formData };
      const fkFields: (keyof Distributor)[] = ['hoId', 'dmId', 'smId', 'asmId', 'aseId'];
      fkFields.forEach(field => {
        if (sanitizedData[field] === '') {
          sanitizedData[field] = null as any;
        }
      });

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
      setIsModalOpen(false); setEditingDist(null); resetForm();
      fetchData(); // Refresh the UI immediately
    } catch (error: any) { 
      console.error("Database Error:", error);
      alert(`Failed to save distributor: ${error.message || 'Unknown database error.'}`); 
    }
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
      } catch (error) { alert("Failed to delete distributor."); }
    }
  };

  const resetForm = () => { setFormData({ code: '', anchorName: '', name: '', email: '', approvedValue: 0, hoId: '', dmId: '', smId: '', asmId: '', aseId: '', active: true, address: '', city: '', state: '', region: '' }); };

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
      } catch (error: any) { alert(`Failed to import distributors.`); } 
      finally { setIsImportModalOpen(false); if (e.target) e.target.value = ''; }
    };
    reader.readAsText(file);
  };

  const isAdminOrHO = ['admin', 'ho'].includes(profile?.role || '');
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
              {['admin', 'ho', 'dm', 'sm'].includes(profile?.role || '') && (
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
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Distributor</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Region / Location</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Hierarchy (ASE)</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Approved Limit</th>
                {isAdminOrHO && <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {paginatedDistributors.map((dist) => (
                <tr key={dist.id} className="hover:bg-zinc-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center shrink-0">
                        <Store size={20} className="text-zinc-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-zinc-900">{dist.name}</p>
                          {!dist.active && <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">Inactive</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded inline-block">{dist.code}</p>
                          {dist.anchorName && <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded inline-block">Anchor: {dist.anchorName}</p>}
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

      {/* --- MODALS --- */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
              
              <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center"><Store className="text-black" size={20} /></div>
                  <div><h4 className="text-xl md:text-2xl font-bold tracking-tight">{editingDist ? 'Edit Distributor' : 'Add New Distributor'}</h4></div>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X size={20} /></button>
              </div>
              
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
                <form id="distributor-form" onSubmit={handleSubmit} className="space-y-8">
                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4">Identification</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Code *</label><input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Anchor Name</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.anchorName} onChange={(e) => setFormData({ ...formData, anchorName: e.target.value })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Name *</label><input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4">Hierarchy Mapping</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 bg-purple-50/50 p-6 rounded-3xl border border-purple-100">
                      {renderUserSelect("Head Office", "ho", "hoId")}
                      {renderUserSelect("Division Mgr (DM)", "dm", "dmId")}
                      {renderUserSelect("Sales Mgr (SM)", "sm", "smId")}
                      {renderUserSelect("Area Sales Mgr", "asm", "asmId")}
                      {renderUserSelect("Area Sales Exec", "ase", "aseId")}
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4">Financials & Location</h5>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Budget Limit (₹) *</label><input required type="number" min="0" className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-blue-500 transition-all font-medium" value={formData.approvedValue} onChange={(e) => setFormData({ ...formData, approvedValue: parseFloat(e.target.value) })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Region</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">City</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} /></div>
                      <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-zinc-400">State</label><input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} /></div>
                    </div>
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