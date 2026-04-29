import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../supabase';
import { UserProfile } from '../types';
import { Plus, Search, Edit2, Trash2, X, Shield, Mail, MapPin, User as UserIcon, Filter, CheckCircle2, Lock, Phone, Loader2 } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { createClient } from '@supabase/supabase-js';

export function UsersModule() {
  const { profile, user } = useAuth();
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    name: '', email: '', phone: '', role: 'auditor', region: '', active: true
  });

  const isMeSuperadmin = profile?.role === 'superadmin';
  const isMeAdmin = profile?.role === 'admin';
  const canManageUsers = isMeSuperadmin || isMeAdmin;

  const fetchData = async () => {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('role', { ascending: true });
        
      if (error) throw error;
      if (data) setUsersList(data as UserProfile[]);
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
  }, [profile]);

  const filteredUsers = usersList.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (u.phone?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (u.region?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', phone: '', role: 'auditor', region: '', active: true });
    setIsModalOpen(true);
  };

  const openEditModal = (targetUser: UserProfile) => {
    setEditingUser(targetUser);
    setFormData({ ...targetUser });
    setIsModalOpen(true);
  };

  const deleteUser = async (targetUid: string, targetName: string) => {
    if (!window.confirm(`Are you sure you want to delete the user: ${targetName}?`)) return;
    try {
      await supabase.from('users').delete().eq('uid', targetUid);
      logActivity(user, profile, "User Deleted", `Deleted user account for ${targetName}`);
      fetchData();
    } catch (error: any) {
      alert(`Failed to delete user: ${error.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;

    if (isMeAdmin && formData.role === 'superadmin') {
      return alert("Action Denied: You do not have permission to assign the Super Admin role.");
    }

    setIsSubmitting(true);

    try {
      if (editingUser) {
        // UPDATE EXISTING USER
        const { error } = await supabase.from('users').update(formData).eq('uid', editingUser.uid);
        if (error) throw error;
        logActivity(user, profile, "User Updated", `Updated details/role for ${formData.name}`);
        
        setIsModalOpen(false);
        fetchData();
        
      } else {
        // CREATE NEW USER + SEND PASSWORD EMAIL
        
        // 1. Create a secondary Supabase client that DOES NOT save the session. 
        // This prevents the Admin from being logged out when creating a new user.
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const adminAuthClient = createClient(supabaseUrl, supabaseKey, { 
          auth: { persistSession: false, autoRefreshToken: false } 
        });
        
        // 2. Generate a secure, random temporary password just to fulfill Supabase requirements
        const tempPassword = Math.random().toString(36).slice(-10) + 'A1!@';
        
        // 3. Register the user in Supabase Auth
        const { data: authData, error: authError } = await adminAuthClient.auth.signUp({
          email: formData.email!,
          password: tempPassword,
        });
        
        if (authError) throw authError;
        
        const newUid = authData.user?.id;
        if (!newUid) throw new Error("Failed to generate user ID from Authentication service.");

        // 4. Insert the new profile into the public users table
        const { error: dbError } = await supabase.from('users').insert([{ 
          ...formData, 
          uid: newUid,
          password_setup_required: true 
        }]);
        
        if (dbError) throw dbError;

        // 5. Fire the Password Generation/Reset Email automatically and explicitly set the live redirect URL
       // 5. Fire the Password Generation/Reset Email automatically
        const { error: resetError } = await adminAuthClient.auth.resetPasswordForEmail(formData.email!, {
          redirectTo: 'https://reliance-audit-flow.vercel.app/',
        });
        
        if (resetError) {
          console.error("Failed to trigger password email:", resetError);
          alert("User was created successfully, but the password generation email failed to send. Please check your Supabase email settings.");
        } else {
          alert(`Success! An email has been sent to ${formData.email} for password generation.`);
        }

        logActivity(user, profile, "User Added", `Created new user account for ${formData.name} as ${formData.role.toUpperCase()}`);
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error: any) {
      alert(`Failed to save user: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const roleOptions = [
    { value: 'superadmin', label: 'Super Admin', requiresSuperAdmin: true },
    { value: 'admin', label: 'System Admin', requiresSuperAdmin: false },
    { value: 'ho', label: 'Head Office (HO)', requiresSuperAdmin: false },
    { value: 'dm', label: 'Division Manager (DM)', requiresSuperAdmin: false },
    { value: 'sm', label: 'Sales Manager (SM)', requiresSuperAdmin: false },
    { value: 'asm', label: 'Area Sales Mgr (ASM)', requiresSuperAdmin: false },
    { value: 'ase', label: 'Area Sales Exec (ASE)', requiresSuperAdmin: false },
    { value: 'auditor', label: 'Field Auditor', requiresSuperAdmin: false },
  ];

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
            <input type="text" placeholder="Search users by name, email, or phone..." className="w-full pl-11 pr-4 py-3 sm:py-3.5 bg-white border border-zinc-200 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>

          <div className="relative group min-w-[160px]">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={16} />
            <select className="w-full pl-11 pr-4 py-3 sm:py-3.5 bg-white border border-zinc-200 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-black outline-none shadow-sm cursor-pointer appearance-none text-sm font-medium" value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
              <option value="all">All Roles</option>
              {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>

        {canManageUsers && (
          <button onClick={openAddModal} className="flex justify-center items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md active:scale-95 text-sm sm:text-base whitespace-nowrap">
            <Plus size={18} /> Add User
          </button>
        )}
      </div>

      {/* --- USERS TABLE --- */}
      <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm overflow-hidden w-full">
        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">User Details</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Role & Access</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Region</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider text-center">Status</th>
                {canManageUsers && <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredUsers.map(u => {
                const isTargetSuperadmin = u.role === 'superadmin';
                const canEditThisUser = isMeSuperadmin || (isMeAdmin && !isTargetSuperadmin);

                return (
                  <tr key={u.uid} className="hover:bg-zinc-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", isTargetSuperadmin ? "bg-amber-100 text-amber-600" : "bg-zinc-100 text-zinc-600")}>
                          {isTargetSuperadmin ? <Shield size={18} /> : <UserIcon size={18} />}
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 text-sm">{u.name}</p>
                          <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5"><Mail size={12}/> {u.email}</p>
                          {u.phone && <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5"><Phone size={12}/> {u.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn("px-3 py-1 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-wider", isTargetSuperadmin ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-zinc-100 text-zinc-700")}>
                        {roleOptions.find(r => r.value === u.role)?.label || u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-zinc-600">
                        <MapPin size={14} className="text-zinc-400" />
                        {u.region || <span className="text-zinc-400 italic">No region</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center">
                        {u.active ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100"><CheckCircle2 size={14}/> Active</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-md border border-red-100"><X size={14}/> Inactive</span>
                        )}
                      </div>
                    </td>
                    {canManageUsers && (
                      <td className="px-6 py-4 text-right">
                        {canEditThisUser ? (
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEditModal(u)} className="p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-lg transition-colors" title="Edit User"><Edit2 size={16} /></button>
                            <button onClick={() => deleteUser(u.uid, u.name)} className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete User"><Trash2 size={16} /></button>
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-end gap-1">
                            <Lock size={12} /> Restricted
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400">
                    <UserIcon size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No users found matching your criteria.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- ADD / EDIT MODAL --- */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isSubmitting && setIsModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-lg bg-white rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="p-5 sm:p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0"><UserIcon className="text-blue-600 sm:w-5 sm:h-5" size={18} /></div>
                  <div>
                    <h4 className="text-lg sm:text-xl font-bold tracking-tight">{editingUser ? 'Edit User' : 'Add New User'}</h4>
                    <p className="text-[10px] sm:text-xs text-zinc-500">Configure profile details and system access.</p>
                  </div>
                </div>
                <button onClick={() => !isSubmitting && setIsModalOpen(false)} className="p-1.5 sm:p-2 hover:bg-zinc-100 rounded-lg transition-colors"><X size={18}/></button>
              </div>
              
              <div className="p-5 sm:p-6 md:p-8 overflow-y-auto bg-zinc-50/30 flex-1 custom-scrollbar min-h-0">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Full Name *</label>
                    <input required type="text" placeholder="e.g. Jane Doe" className="w-full mt-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Email Address *</label>
                    <input required type="email" placeholder="jane@company.com" disabled={!!editingUser} className="w-full mt-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm disabled:bg-zinc-100 disabled:text-zinc-500" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                    {editingUser && <p className="text-[10px] text-amber-600 font-medium mt-1 ml-1">Email cannot be changed after creation.</p>}
                    {!editingUser && <p className="text-[10px] text-blue-600 font-medium mt-1 ml-1">An email will be sent automatically to generate a password.</p>}
                  </div>

                  <div>
                    <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Phone Number</label>
                    <input type="tel" placeholder="+91 9876543210" className="w-full mt-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm" value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">System Role *</label>
                      <select 
                        required 
                        className="w-full mt-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm cursor-pointer" 
                        value={formData.role} 
                        onChange={e => setFormData({...formData, role: e.target.value})}
                      >
                        {roleOptions.map(r => {
                          if (r.requiresSuperAdmin && !isMeSuperadmin) return null;
                          return <option key={r.value} value={r.value}>{r.label}</option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">Region / Location</label>
                      <input type="text" placeholder="e.g. North" className="w-full mt-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all shadow-sm text-sm" value={formData.region} onChange={e => setFormData({...formData, region: e.target.value})} />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-100">
                    <label className="flex items-center gap-3 cursor-pointer p-3 bg-white border border-zinc-200 rounded-xl shadow-sm hover:bg-zinc-50 transition-colors w-max">
                      <input 
                        type="checkbox" 
                        checked={formData.active} 
                        onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                        className="w-4 h-4 rounded border-zinc-300 text-black focus:ring-black"
                      />
                      <span className="text-sm font-bold text-zinc-900 select-none">Active Account Access</span>
                    </label>
                  </div>
                </form>
              </div>

              <div className="p-4 sm:p-6 border-t border-zinc-100 shrink-0 bg-white">
                <button type="submit" form="user-form" disabled={isSubmitting} className="w-full py-3 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-md active:scale-95 text-sm sm:text-base flex justify-center items-center gap-2 disabled:opacity-70">
                  {isSubmitting && <Loader2 size={18} className="animate-spin" />}
                  {editingUser ? 'Save Changes' : (isSubmitting ? 'Creating & Sending Email...' : 'Create User & Send Email')}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}