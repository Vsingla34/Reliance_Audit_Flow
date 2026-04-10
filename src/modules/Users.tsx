import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../supabase';
import { UserProfile } from '../types';
import { 
  Plus, Search, User as UserIcon, Mail, Shield, MapPin, Edit2, 
  X, CheckCircle2, Loader2, Phone, Upload, Download, ChevronLeft, ChevronRight, Ban, CheckCircle
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function UsersModule() {
  const { profile, user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25; 
  
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    name: '', email: '', mobile: '', role: 'auditor', region: '', active: true
  });

  const fetchData = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true });
      if (error) throw error;
      if (data) setUsers(data as UserProfile[]);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.mobile && u.mobile.includes(searchTerm))
  );

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (editingUser) {
        const { error } = await supabase.from('users').update(formData).eq('uid', editingUser.uid);
        if (error) throw error;
        
        logActivity(user, profile, "User Updated", `Admin updated profile details for ${formData.name}`);
        alert(`Successfully updated user profile for ${formData.name}.`);
      } else {
        const { data, error } = await supabase.functions.invoke('invite-user', {
          body: { email: formData.email, name: formData.name, role: formData.role, region: formData.region, mobile: formData.mobile }
        });
        if (error || data.error) throw new Error(error?.message || data.error);
        
        logActivity(user, profile, "User Invited", `Admin invited a new ${formData.role.toUpperCase()} (${formData.name}) to the portal`);
        alert(`User created successfully! An invite link has been dispatched to ${formData.email}.`);
      }
      
      setIsModalOpen(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', mobile: '', role: 'auditor', region: '', active: true });
    } catch (error: any) {
      console.error("Error saving user:", error);
      alert(`Failed to save user: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUserStatus = async (targetUser: UserProfile) => {
    const warningMsg = targetUser.active 
      ? `Are you sure you want to DEACTIVATE ${targetUser.name}? They will be instantly locked out of the portal, but their past audits and history will be safely preserved.`
      : `Are you sure you want to RESTORE access for ${targetUser.name}?`;

    if (window.confirm(warningMsg)) {
      try {
        const newStatus = !targetUser.active;
        const { error } = await supabase.from('users').update({ active: newStatus }).eq('uid', targetUser.uid);
        if (error) throw error;

        logActivity(user, profile, `Account ${newStatus ? 'Activated' : 'Deactivated'}`, `Admin ${newStatus ? 'restored' : 'revoked'} system access for ${targetUser.name}`);
        
      } catch (error: any) {
        console.error("Error updating user status:", error);
        alert(`Failed to update account status: ${error.message}`);
      }
    }
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', mobile: '', role: 'auditor', region: '', active: true });
    setIsModalOpen(true);
  };

  const downloadTemplate = () => {
    const csvContent = "Name,Email,Mobile,Role,Region\nJane Doe,jane@company.com,9876543210,ase,North\nJohn Smith,john@company.com,9123456789,auditor,Global";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "User_Import_Template.csv";
    link.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== '');
        
        const newUsers = lines.slice(1).map(line => {
          const [name, email, mobile, role, region] = line.split(',');
          if (!name || !email || !role) return null;
          return {
            name: name.trim(), email: email.trim(), mobile: mobile?.trim() || '', role: role.trim().toLowerCase(), region: region?.trim() || ''
          };
        }).filter(Boolean);

        if (newUsers.length === 0) return alert("No valid users found in CSV.");

        setIsImporting(true);
        let successCount = 0; let failCount = 0;

        for (const u of newUsers) {
          try {
            const { data, error } = await supabase.functions.invoke('invite-user', {
              body: { email: u?.email, name: u?.name, role: u?.role, region: u?.region, mobile: u?.mobile }
            });
            if (error || data?.error) throw new Error(error?.message || data?.error);
            successCount++;
          } catch (err) { failCount++; }
        }
        
        logActivity(user, profile, "Bulk Import", `Admin bulk imported ${successCount} new users`);
        alert(`Import complete! Successfully invited ${successCount} users. ${failCount > 0 ? `Failed to add ${failCount} users.` : ''}`);
      } catch (error) {
        alert("Error parsing CSV. Please check the format.");
      } finally {
        setIsImporting(false); setIsImportModalOpen(false); if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  if (!['admin', 'ho'].includes(profile?.role || '')) {
    return <div className="p-4 sm:p-8 text-center text-red-500 font-bold">Access Denied. Admin only.</div>;
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* Search and Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div className="relative flex-1 group w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search team by name, email, role, or mobile..." 
            className="w-full pl-12 pr-4 py-3 sm:py-4 bg-white border border-zinc-200 rounded-xl sm:rounded-2xl focus:ring-0 focus:border-black transition-all shadow-sm text-sm sm:text-base"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-3 w-full md:w-auto">
          <button onClick={() => setIsImportModalOpen(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 bg-zinc-100 text-zinc-900 rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95 whitespace-nowrap text-sm sm:text-base">
            <Upload size={18} className="sm:w-5 sm:h-5" /> Import
          </button>
          <button onClick={openCreateModal} className="flex-[2] md:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 whitespace-nowrap text-sm sm:text-base">
            <Plus size={18} className="sm:w-5 sm:h-5" /> Add Team Member
          </button>
        </div>
      </div>

      {/* Main Users Table */}
      <div className="bg-white rounded-[1.5rem] sm:rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden flex flex-col w-full">
        <div className="overflow-x-auto custom-scrollbar w-full flex-1">
          <table className="w-full text-left min-w-[700px]">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-wider">User Details</th>
                <th className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-wider">Role & Access</th>
                <th className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-wider">Region</th>
                <th className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {paginatedUsers.map((u) => {
                const isMe = u.uid === profile?.uid;
                return (
                  <tr key={u.uid} className={cn("transition-colors group", !u.active ? "bg-red-50/20 hover:bg-red-50/40" : "hover:bg-zinc-50/50")}>
                    <td className="px-4 sm:px-8 py-4 sm:py-5">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shrink-0 font-bold", !u.active ? "bg-red-100 text-red-600" : "bg-zinc-100 text-zinc-500")}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                            <p className={cn("font-bold text-sm sm:text-base", !u.active ? "text-red-900" : "text-zinc-900")}>{u.name}</p>
                            {isMe && <span className="bg-blue-100 text-blue-700 text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-md uppercase">You</span>}
                            {!u.active && <span className="bg-red-100 text-red-600 text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-md uppercase">Deactivated</span>}
                          </div>
                          <p className="text-[10px] sm:text-xs text-zinc-500 flex items-center gap-1"><Mail size={12} className="shrink-0" /> <span className="truncate">{u.email}</span></p>
                          {u.mobile && <p className="text-[10px] sm:text-xs text-zinc-500 flex items-center gap-1 mt-0.5 sm:mt-1"><Phone size={12} className="shrink-0" /> {u.mobile}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-8 py-4 sm:py-5">
                      <div className={cn("flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl inline-flex border font-bold uppercase tracking-wider text-[9px] sm:text-[10px]", !u.active ? "bg-red-50 border-red-100 text-red-700" : "bg-zinc-50 border-zinc-100 text-zinc-700")}>
                        <Shield size={12} className={cn("sm:w-3.5 sm:h-3.5", !u.active ? "text-red-400" : "text-zinc-400")} /> {u.role}
                      </div>
                    </td>
                    <td className="px-4 sm:px-8 py-4 sm:py-5">
                      {u.region ? (
                        <div className={cn("flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl inline-flex border text-xs sm:text-sm", !u.active ? "bg-red-50 border-red-100 text-red-700" : "bg-zinc-50 border-zinc-100 text-zinc-600")}>
                          <MapPin size={12} className={cn("shrink-0 sm:w-3.5 sm:h-3.5", !u.active ? "text-red-400" : "text-zinc-400")} /> <span className="truncate">{u.region}</span>
                        </div>
                      ) : <span className="text-xs sm:text-sm text-zinc-400 italic">Global</span>}
                    </td>
                    <td className="px-4 sm:px-8 py-4 sm:py-5 text-right">
                      <div className="flex items-center justify-end gap-1 sm:gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingUser(u); setFormData(u); setIsModalOpen(true); }} className="p-1.5 sm:p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-lg sm:rounded-xl transition-all" title="Edit Profile"><Edit2 size={16} className="sm:w-4 sm:h-4" /></button>
                        
                        {!isMe && (
                          <button 
                            onClick={() => toggleUserStatus(u)} 
                            className={cn("p-1.5 sm:p-2 rounded-lg sm:rounded-xl transition-all", u.active ? "text-zinc-400 hover:text-red-600 hover:bg-red-50" : "text-red-500 hover:text-emerald-600 hover:bg-emerald-50")} 
                            title={u.active ? "Deactivate Account" : "Restore Access"}
                          >
                            {u.active ? <Ban size={16} className="sm:w-4 sm:h-4" /> : <CheckCircle size={16} className="sm:w-4 sm:h-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 sm:px-8 py-12 sm:py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-400">
                      <UserIcon size={40} className="mb-3 sm:mb-4 text-zinc-200 sm:w-12 sm:h-12" />
                      <p className="text-base sm:text-lg font-medium text-zinc-900 mb-1">No users found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredUsers.length > 0 && (
          <div className="p-4 sm:p-6 border-t border-zinc-100 bg-zinc-50 flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4 shrink-0">
            <span className="text-xs sm:text-sm font-medium text-zinc-500">
              Showing <span className="font-bold text-zinc-900">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-bold text-zinc-900">{Math.min(currentPage * itemsPerPage, filteredUsers.length)}</span> of <span className="font-bold text-zinc-900">{filteredUsers.length}</span>
            </span>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                disabled={currentPage === 1}
                className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} className="sm:w-[18px] sm:h-[18px]" />
              </button>
              <span className="text-xs sm:text-sm font-bold text-zinc-700 px-3 sm:px-4">Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                disabled={currentPage === totalPages}
                className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} className="sm:w-[18px] sm:h-[18px]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- BULK IMPORT MODAL --- */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden p-6 sm:p-8 text-center z-10">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-zinc-100 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
                {isImporting ? <Loader2 className="text-black animate-spin" size={20} /> : <Upload className="text-black sm:w-6 sm:h-6" size={20} />}
              </div>
              <h4 className="text-xl sm:text-2xl font-bold tracking-tight mb-1 sm:mb-2">{isImporting ? 'Importing Users...' : 'Import Team'}</h4>
              <p className="text-xs sm:text-sm text-zinc-500 mb-4 sm:mb-6">
                Upload a CSV file with columns: <br/>
                <code className="bg-zinc-100 px-2 py-1 rounded text-[9px] sm:text-[10px] block mt-2 text-left overflow-x-auto whitespace-nowrap">Name, Email, Mobile, Role, Region</code>
              </p>
              
              {!isImporting && (
                <>
                  <div className="mb-4 sm:mb-6"><button onClick={downloadTemplate} className="flex items-center justify-center gap-2 w-full py-2.5 sm:py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-bold text-xs sm:text-sm transition-colors"><Download size={16} /> Download Example Template</button></div>
                  <div className="relative">
                    <input type="file" accept=".csv" onChange={handleImport} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div className="w-full py-6 border-2 border-dashed border-zinc-200 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-zinc-50 transition-colors px-4"><span className="font-bold text-zinc-900 text-sm sm:text-base">Click to browse or drag file</span><span className="text-[10px] sm:text-xs text-zinc-400">CSV files only</span></div>
                  </div>
                  <button onClick={() => setIsImportModalOpen(false)} className="mt-4 sm:mt-6 text-xs sm:text-sm font-bold text-zinc-400 hover:text-black transition-colors">Cancel</button>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- ADD/EDIT MODAL --- */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isLoading && setIsModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-3xl bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-5 sm:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-100 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0"><UserIcon className="text-black" size={18} /></div>
                  <div>
                    <h4 className="text-lg sm:text-2xl font-bold tracking-tight">{editingUser ? 'Edit Team Member' : 'Add New Team Member'}</h4>
                    <p className="text-[10px] sm:text-sm text-zinc-500">{editingUser ? 'Update user details and access.' : 'Create an account and securely email an invite link.'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => !isLoading && setIsModalOpen(false)} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg sm:rounded-xl transition-colors shrink-0"><X size={18} className="sm:w-5 sm:h-5" /></button>
              </div>
              
              <div className="p-5 sm:p-8 overflow-y-auto custom-scrollbar">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
                  <div>
                    <h5 className="text-[10px] sm:text-sm font-bold uppercase tracking-wider text-zinc-900 mb-3 sm:mb-4 flex items-center gap-2"><span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-blue-500"></span> User Identity</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-1.5 sm:space-y-2"><label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Full Name *</label><input required className="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all text-sm sm:text-base" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="John Doe" disabled={isLoading} /></div>
                      <div className="space-y-1.5 sm:space-y-2"><label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Email Address *</label><input required type="email" className="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all text-sm sm:text-base" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="john@company.com" disabled={isLoading || !!editingUser} /></div>
                      <div className="space-y-1.5 sm:space-y-2 md:col-span-2 lg:col-span-1"><label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Mobile No.</label><input type="tel" className="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all text-sm sm:text-base" value={formData.mobile || ''} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} placeholder="+91 98765 43210" disabled={isLoading} /></div>
                    </div>
                  </div>

                  {!editingUser && (
                    <div className="p-3 sm:p-4 bg-emerald-50 rounded-xl sm:rounded-2xl border border-emerald-100 flex items-start gap-2 sm:gap-3">
                      <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5 sm:w-5 sm:h-5" />
                      <div><h5 className="text-xs sm:text-sm font-bold text-emerald-900">Secure Invite Link</h5><p className="text-[10px] sm:text-xs text-emerald-700 mt-0.5 sm:mt-1">Instead of emailing a plain-text password, Supabase will securely email this user an invite link via Google SMTP to set their own password.</p></div>
                    </div>
                  )}

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-[10px] sm:text-sm font-bold uppercase tracking-wider text-zinc-900 mb-3 sm:mb-4 flex items-center gap-2"><span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-zinc-800"></span> Role & Access</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-1.5 sm:space-y-2">
                        <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">System Role *</label>
                        <select required className="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all text-sm sm:text-base" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as any })} disabled={isLoading}>
                          <option value="admin">Administrator (Full Access)</option><option value="ho">Head Office (HO)</option><option value="dm">Division Manager (DM)</option><option value="sm">Sales Manager (SM)</option><option value="asm">Area Sales Manager (ASM)</option><option value="ase">Area Sales Executive (ASE)</option><option value="auditor">Field Auditor</option>
                        </select>
                      </div>
                      <div className="space-y-1.5 sm:space-y-2"><label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">Region (Optional)</label><input className="w-full px-3 py-2.5 sm:px-4 sm:py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all text-sm sm:text-base" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} placeholder="e.g. North India" disabled={isLoading} /></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-zinc-50 p-3 sm:p-4 rounded-xl border border-zinc-100 w-full sm:w-max">
                    <input type="checkbox" id="userActive" className="w-4 h-4 sm:w-5 sm:h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer shrink-0" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} disabled={isLoading} />
                    <label htmlFor="userActive" className="text-xs sm:text-sm font-bold cursor-pointer select-none">Active Account (Can log in)</label>
                  </div>
                </form>
              </div>
              
              <div className="p-5 sm:p-8 border-t border-zinc-100 shrink-0 bg-white z-10 flex justify-end">
                <button type="submit" form="user-form" disabled={isLoading} className="w-full sm:w-auto px-6 py-3 sm:px-10 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md sm:shadow-xl sm:shadow-black/10 active:scale-95 text-sm sm:text-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  {isLoading ? <><Loader2 className="animate-spin sm:w-5 sm:h-5" size={18} /> Processing...</> : editingUser ? 'Save Changes' : 'Create User & Send Invite'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}