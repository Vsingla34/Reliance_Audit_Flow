import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { UserProfile } from '../types';
import { 
  Plus, 
  Search, 
  User as UserIcon, 
  Mail, 
  Shield, 
  MapPin, 
  Edit2, 
  Trash2, 
  X,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function UsersModule() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    name: '',
    email: '',
    role: 'auditor',
    region: '',
    active: true
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

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (editingUser) {
        // UPDATE EXISTING USER IN PUBLIC TABLE
        const { error } = await supabase
          .from('users')
          .update(formData)
          .eq('uid', editingUser.uid);
        if (error) throw error;
        
        alert(`Successfully updated user profile for ${formData.name}.`);
      } else {
        // CALL EDGE FUNCTION TO INVITE NEW USER
        const { data, error } = await supabase.functions.invoke('invite-user', {
          body: { 
            email: formData.email, 
            name: formData.name, 
            role: formData.role, 
            region: formData.region 
          }
        });

        if (error || data.error) throw new Error(error?.message || data.error);

        alert(`User created successfully! An invite link has been dispatched to ${formData.email} via Google SMTP.`);
      }
      
      setIsModalOpen(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', role: 'auditor', region: '', active: true });
    } catch (error: any) {
      console.error("Error saving user:", error);
      alert(`Failed to save user: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteUser = async (uid: string) => {
    if (window.confirm("Are you sure you want to delete this user? This will remove their access to the portal.")) {
      try {
        const { error } = await supabase.from('users').delete().eq('uid', uid);
        if (error) throw error;
      } catch (error) {
        console.error("Error deleting user:", error);
      }
    }
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', role: 'auditor', region: '', active: true });
    setIsModalOpen(true);
  };

  if (!['admin', 'ho'].includes(profile?.role || '')) {
    return <div className="p-8 text-center text-red-500 font-bold">Access Denied. Admin only.</div>;
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search team members by name, email, or role..." 
            className="w-full pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-0 focus:border-black transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <button 
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"
        >
          <Plus size={20} />
          Add Team Member
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">User Details</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Role & Access</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider">Region</th>
                <th className="px-8 py-5 text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredUsers.map((u) => {
                const isMe = u.uid === profile?.uid;
                
                return (
                  <tr key={u.uid} className="hover:bg-zinc-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 text-zinc-500 font-bold">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-bold text-zinc-900">{u.name}</p>
                            {isMe && <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">You</span>}
                            {!u.active && <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">Inactive</span>}
                          </div>
                          <p className="text-xs text-zinc-500 flex items-center gap-1">
                            <Mail size={12} /> {u.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2 text-sm font-bold bg-zinc-50 px-3 py-1.5 rounded-xl inline-flex border border-zinc-100 uppercase tracking-wider text-[10px] text-zinc-700">
                        <Shield size={14} className="text-zinc-400" />
                        {u.role}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      {u.region ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-600 bg-zinc-50 px-3 py-1.5 rounded-xl inline-flex border border-zinc-100">
                          <MapPin size={14} className="text-zinc-400 shrink-0" />
                          <span>{u.region}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-400 italic">Global</span>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingUser(u); setFormData(u); setIsModalOpen(true); }}
                          className="p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-xl transition-all"
                          title="Edit User"
                        >
                          <Edit2 size={16} />
                        </button>
                        {!isMe && (
                          <button 
                            onClick={() => deleteUser(u.uid)}
                            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            title="Delete User"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-8 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-400">
                      <UserIcon size={48} className="mb-4 text-zinc-200" />
                      <p className="text-lg font-medium text-zinc-900 mb-1">No users found</p>
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
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              onClick={() => !isLoading && setIsModalOpen(false)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center">
                    <UserIcon className="text-black" size={20} />
                  </div>
                  <div>
                    <h4 className="text-xl md:text-2xl font-bold tracking-tight">{editingUser ? 'Edit Team Member' : 'Add New Team Member'}</h4>
                    <p className="text-sm text-zinc-500">{editingUser ? 'Update user details and access.' : 'Create an account and securely email an invite link.'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => !isLoading && setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-8">
                  
                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span> User Identity
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Full Name *</label>
                        <input required className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="John Doe" disabled={isLoading} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Email Address *</label>
                        <input required type="email" className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="john@company.com" disabled={isLoading || !!editingUser} />
                      </div>
                    </div>
                  </div>

                  {!editingUser && (
                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-3">
                      <CheckCircle2 size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                        <h5 className="text-sm font-bold text-emerald-900">Secure Invite Link</h5>
                        <p className="text-xs text-emerald-700 mt-1">
                          Instead of emailing a plain-text password, Supabase will securely email this user an invite link via Google SMTP to set their own password.
                        </p>
                      </div>
                    </div>
                  )}

                  <hr className="border-zinc-100" />

                  <div>
                    <h5 className="text-sm font-bold uppercase tracking-wider text-zinc-900 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-zinc-800"></span> Role & Access
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">System Role *</label>
                        <select 
                          required
                          className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" 
                          value={formData.role} 
                          onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                          disabled={isLoading}
                        >
                          <option value="admin">Administrator (Full Access)</option>
                          <option value="ho">Head Office (View/Approve)</option>
                          <option value="ase">Area Sales Executive</option>
                          <option value="auditor">Field Auditor</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Region (Optional)</label>
                        <input className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} placeholder="e.g. North India" disabled={isLoading} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                    <input type="checkbox" id="userActive" className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} disabled={isLoading} />
                    <label htmlFor="userActive" className="text-sm font-bold cursor-pointer select-none">Active Account (Can log in)</label>
                  </div>

                </form>
              </div>
              
              <div className="p-6 md:p-8 border-t border-zinc-100 shrink-0 bg-white z-10">
                <button type="submit" form="user-form" disabled={isLoading} className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 text-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  {isLoading ? (
                    <><Loader2 className="animate-spin" size={20} /> Processing...</>
                  ) : (
                    editingUser ? 'Save Changes' : 'Create User & Send Invite'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}