import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Distributor, UserProfile } from '../types';
import { 
  Plus, 
  Search, 
  Store, 
  MapPin, 
  Edit2, 
  Trash2, 
  X, 
  Upload, 
  IndianRupee, 
  User as UserIcon
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function DistributorsModule() {
  const { profile } = useAuth();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  
  const [editingDist, setEditingDist] = useState<Distributor | null>(null);
  const [formData, setFormData] = useState<Partial<Distributor>>({
    code: '',
    name: '',
    email: '',
    contactPerson: '',
    contactNumber: '',
    address: '',
    city: '',
    state: '',
    approvedValue: 0,
    aseId: '',
    active: true
  });

  const fetchData = async () => {
    if (!profile) return;

    try {
      let distQuery = supabase.from('distributors').select('*');
      
      if (profile.role === 'ase') {
        distQuery = distQuery.eq('aseId', profile.uid);
      }

      const [distRes, usersRes] = await Promise.all([
        distQuery,
        supabase.from('users').select('*')
      ]);
      
      if (distRes.error) throw distRes.error;
      if (usersRes.error) throw usersRes.error;

      if (distRes.data) setDistributors(distRes.data as Distributor[]);
      if (usersRes.data) setUsers(usersRes.data as UserProfile[]);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  useEffect(() => {
    fetchData();

    const channel = supabase.channel('distributors-changes')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'distributors' }, 
        () => {
          fetchData(); 
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const filteredDistributors = distributors.filter(d => 
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.city?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const simulateEmailSend = ({ toAseEmail, distributorName, ticketId }: any) => {
    console.log(`
=================================================
📧 MOCK EMAIL SENT
To: ${toAseEmail || '[No ASE Assigned]'}
Subject: Action Required: Audit Scheduling for ${distributorName}

Body:
Hello,

A new distributor (${distributorName}) has been added to the system. 
Please log in to the Audit Portal to propose tentative dates for the upcoming audit.

You can add your proposed dates and remarks here: 
http://localhost:5173/scheduler?ticket=${ticketId}

Or reply to this email to suggest a date manually.
=================================================
    `);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingDist) {
        const { error } = await supabase
          .from('distributors')
          .update(formData)
          .eq('id', editingDist.id);
        if (error) throw error;
      } else {
        const newDistId = Math.random().toString(36).substring(7);
        const { error } = await supabase
          .from('distributors')
          .insert([{ ...formData, id: newDistId }]);
        if (error) throw error;

        const assignedAse = users.find(u => u.uid === formData.aseId);
        
        const newTicketId = Math.random().toString(36).substring(7);
        const tentativeTicket = {
          id: newTicketId,
          distributorId: newDistId,
          proposedDate: null,
          auditorId: null,
          approvedValue: formData.approvedValue,
          maxAllowedValue: (formData.approvedValue || 0) * 1.05,
          status: 'tentative',
          verifiedTotal: 0,
          dateProposals: [], 
          comments: [], 
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        const { error: ticketError } = await supabase.from('auditTickets').insert([tentativeTicket]);
        if (ticketError) {
          console.error("Ticket Creation Error:", ticketError);
          alert(`Database Error: ${ticketError.message}`);
          return;
        }

        simulateEmailSend({
          toAseEmail: assignedAse?.email,
          distributorName: formData.name,
          ticketId: newTicketId
        });
      }
      
      setIsModalOpen(false);
      setEditingDist(null);
      setFormData({ code: '', name: '', email: '', approvedValue: 0, aseId: '', active: true, address: '', city: '', state: '' });
    } catch (error) {
      console.error("Error saving distributor:", error);
    }
  };

  const deleteDist = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this distributor? This will permanently erase all of their scheduled audits, counted items, and chat history.")) {
      try {
        const { data: tickets } = await supabase
          .from('auditTickets')
          .select('id')
          .eq('distributorId', id);
          
        if (tickets && tickets.length > 0) {
          const ticketIds = tickets.map(t => t.id);
          await supabase.from('auditLineItems').delete().in('ticketId', ticketIds);
          await supabase.from('auditTickets').delete().in('id', ticketIds);
        }

        const { error: distError } = await supabase
          .from('distributors')
          .delete()
          .eq('id', id);
          
        if (distError) throw distError;
        
      } catch (error) {
        console.error("Error deleting distributor:", error);
        alert("Failed to delete distributor. Check the console for details.");
      }
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').slice(1);
        
        const newDistributors = lines.map(line => {
          const [code, name, approvedValue, aseEmail, city, state] = line.split(',');
          if (!code || !name) return null;
          
          const ase = users.find(u => u.email.toLowerCase() === aseEmail?.trim().toLowerCase());
          
          return {
            id: Math.random().toString(36).substring(7),
            code: code.trim(),
            name: name.trim(),
            approvedValue: parseFloat(approvedValue) || 0,
            aseId: ase?.uid || null,
            city: city?.trim() || '',
            state: state?.trim() || '',
            active: true
          };
        }).filter(Boolean);

        if (newDistributors.length > 0) {
          const { error } = await supabase.from('distributors').insert(newDistributors);
          if (error) throw error;
          alert(`Successfully imported ${newDistributors.length} distributors!`);
        }
      } catch (error) {
        console.error("Error importing distributors:", error);
        alert("Failed to import distributors. Please check the console for details.");
      } finally {
        setIsImportModalOpen(false);
      }
    };
    reader.readAsText(file);
  };

  const isAdminOrHO = ['admin', 'ho'].includes(profile?.role || '');

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search distributors by name, code or city..." 
            className="w-full pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-0 focus:border-black transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        {isAdminOrHO && (
          <div className="flex gap-4">
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center justify-center gap-2 px-6 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95"
            >
              <Upload size={20} />
              Import Master
            </button>
            <button 
              onClick={() => { setEditingDist(null); setFormData({ code: '', name: '', email: '', approvedValue: 0, aseId: '', active: true, address: '', city: '', state: '' }); setIsModalOpen(true); }}
              className="flex items-center justify-center gap-2 px-6 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"
            >
              <Plus size={20} />
              Add Distributor
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Code & Name</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Location</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Approved Value</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Mapped ASE</th>
                {isAdminOrHO && <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredDistributors.map((dist) => (
                <tr key={dist.id} className="hover:bg-zinc-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center shrink-0">
                        <Store size={20} className="text-zinc-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-zinc-900">{dist.name}</p>
                          {!dist.active && (
                            <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-mono text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded inline-block">
                          {dist.code}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {dist.city || dist.state ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-600 bg-zinc-50 px-3 py-1.5 rounded-xl inline-flex border border-zinc-100">
                        <MapPin size={14} className="text-zinc-400 shrink-0" />
                        <span className="truncate max-w-[150px]">{dist.city}{dist.city && dist.state ? ', ' : ''}{dist.state}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400 italic">Not specified</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-1 font-bold text-zinc-900 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl inline-flex border border-emerald-100/50">
                      <IndianRupee size={14} />
                      <span>{dist.approvedValue.toLocaleString('en-IN')}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3 bg-zinc-50 px-3 py-1.5 rounded-xl inline-flex border border-zinc-100">
                      <div className="w-6 h-6 rounded-full bg-white border border-zinc-200 flex items-center justify-center shrink-0 shadow-sm">
                        <UserIcon size={12} className="text-zinc-400" />
                      </div>
                      <span className="text-sm font-medium text-zinc-700 truncate max-w-[120px]">
                        {users.find(u => u.uid === dist.aseId)?.name || 'Unassigned'}
                      </span>
                    </div>
                  </td>
                  
                  {isAdminOrHO && (
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingDist(dist); setFormData(dist); setIsModalOpen(true); }}
                          className="p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-xl transition-all"
                          title="Edit Distributor"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => deleteDist(dist.id)}
                          className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          title="Delete Distributor"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredDistributors.length === 0 && (
                <tr>
                  <td colSpan={isAdminOrHO ? 5 : 4} className="px-8 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-400">
                      <Store size={48} className="mb-4 text-zinc-200" />
                      <p className="text-lg font-medium text-zinc-900 mb-1">No distributors found</p>
                      <p className="text-sm">Try adjusting your search.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              onClick={() => setIsImportModalOpen(false)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Upload className="text-black" size={24} />
              </div>
              <h4 className="text-2xl font-bold tracking-tight mb-2">Import Distributors</h4>
              <p className="text-sm text-zinc-500 mb-8">
                Upload a CSV file with columns: <br/>
                <code className="bg-zinc-100 px-2 py-1 rounded text-xs">Code, Name, ApprovedValue, ASE_Email, City, State</code>
              </p>
              
              <div className="relative">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleImport}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="w-full py-4 border-2 border-dashed border-zinc-200 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-zinc-50 transition-colors">
                  <span className="font-bold text-zinc-900">Click to browse or drag file</span>
                  <span className="text-xs text-zinc-400">CSV files only</span>
                </div>
              </div>
              
              <button onClick={() => setIsImportModalOpen(false)} className="mt-6 text-sm font-bold text-zinc-400 hover:text-black transition-colors">
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              onClick={() => setIsModalOpen(false)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center">
                    <Store className="text-black" size={20} />
                  </div>
                  <div>
                    <h4 className="text-xl md:text-2xl font-bold tracking-tight">{editingDist ? 'Edit Distributor' : 'Add New Distributor'}</h4>
                    <p className="text-sm text-zinc-500">Fill in the details for this distributor record.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
                <form id="distributor-form" onSubmit={handleSubmit} className="space-y-8">
                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-black"></span> Basic Details
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Code *</label>
                        <input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. DIST-001" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Name *</label>
                        <input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Company Name Ltd." />
                      </div>
                      <div className="col-span-1 md:col-span-2 space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Distributor Email Address</label>
                        <input type="email" className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="contact@distributor.com" />
                      </div>
                    </div>
                  </div>

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Financials & Mapping
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Approved Budget Value (₹) *</label>
                        <input required type="number" min="0" className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-medium" value={formData.approvedValue} onChange={(e) => setFormData({ ...formData, approvedValue: parseFloat(e.target.value) })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Mapped ASE *</label>
                        <select 
                          required
                          className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" 
                          value={formData.aseId || ''} 
                          onChange={(e) => setFormData({ ...formData, aseId: e.target.value })}
                        >
                          <option value="">Select an ASE...</option>
                          {users
                            .filter(user => user.role === 'ase' && user.active)
                            .map(user => (
                              <option key={user.uid} value={user.uid}>
                                {user.name} {user.region ? `(${user.region})` : ''}
                              </option>
                            ))
                          }
                        </select>
                      </div>
                    </div>
                  </div>

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span> Location Details
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="col-span-1 md:col-span-2 space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Full Address</label>
                        <input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street address..." />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">City</label>
                        <input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">State</label>
                        <input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                    <input type="checkbox" id="distActive" className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} />
                    <label htmlFor="distActive" className="text-sm font-bold cursor-pointer select-none">Active Distributor</label>
                  </div>

                </form>
              </div>
              
              <div className="p-6 md:p-8 border-t border-zinc-100 shrink-0 bg-white z-10">
                <button type="submit" form="distributor-form" className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 text-lg">
                  {editingDist ? 'Save Changes' : 'Create Distributor & Notify ASE'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}