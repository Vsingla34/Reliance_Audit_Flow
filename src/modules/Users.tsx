import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { UserProfile, UserRole } from '../types';
import { 
  Plus, 
  Search, 
  UserPlus, 
  Mail, 
  Phone, 
  MapPin, 
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  X
} from 'lucide-react';
import { cn } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function UsersModule() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    name: '',
    email: '',
    role: 'ase',
    mobile: '',
    region: '',
    active: true
  });

  const fetchUsers = async () => {
    const { data, error } = await supabase.from('users').select('*');
    if (data) setUsers(data as UserProfile[]);
    if (error) console.error("Error fetching users:", error);
  };

  useEffect(() => {
    // 1. Initial Fetch
    fetchUsers();

    // 2. Realtime Subscription
    const channel = supabase.channel('users-channel')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'users' }, 
        () => {
          fetchUsers(); // Re-fetch on any change to keep data perfectly synced
        }
      )
      .subscribe();

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, []);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        // Update existing user
        const { error } = await supabase
          .from('users')
          .update(formData)
          .eq('uid', editingUser.uid);
          
        if (error) throw error;
      } else {
        // Create new user profile
        const newUid = Math.random().toString(36).substring(7);
        const { error } = await supabase
          .from('users')
          .insert([{ ...formData, uid: newUid }]);
          
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', role: 'ase', mobile: '', region: '', active: true });
    } catch (error) {
      console.error("Error saving user:", error);
    }
  };

  const deleteUser = async (uid: string) => {
    if (window.confirm("Are you sure you want to delete this user?")) {
      try {
        const { error } = await supabase.from('users').delete().eq('uid', uid);
        if (error) throw error;
      } catch (error) {
         console.error("Error deleting user:", error);
      }
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-black transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search users by name, email or role..." 
            className="w-full pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-0 focus:border-black transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"
        >
          <UserPlus size={20} />
          Add New User
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map((user) => (
          <motion.div 
            layout
            key={user.uid}
            className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold text-xl">
                {user.name.charAt(0)}
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => { setEditingUser(user); setFormData(user); setIsModalOpen(true); }}
                  className="p-2 text-zinc-400 hover:text-black hover:bg-zinc-50 rounded-xl transition-all"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => deleteUser(user.uid)}
                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-1 mb-6">
              <h5 className="text-lg font-bold tracking-tight">{user.name}</h5>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest",
                  ['admin', 'ho'].includes(user.role) ? "bg-black text-white" : "bg-zinc-100 text-zinc-600"
                )}>
                  {user.role}
                </span>
                {user.active ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                    <CheckCircle2 size={10} /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    <XCircle size={10} /> Inactive
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm text-zinc-500">
              <div className="flex items-center gap-3">
                <Mail size={14} className="shrink-0" />
                <span className="truncate">{user.email}</span>
              </div>
              {user.mobile && (
                <div className="flex items-center gap-3">
                  <Phone size={14} className="shrink-0" />
                  <span>{user.mobile}</span>
                </div>
              )}
              {user.region && (
                <div className="flex items-center gap-3">
                  <MapPin size={14} className="shrink-0" />
                  <span>{user.region}</span>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
                <h4 className="text-2xl font-bold tracking-tight">{editingUser ? 'Edit User' : 'Add New User'}</h4>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Full Name</label>
                    <input 
                      required
                      className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Email Address</label>
                    <input 
                      required
                      type="email"
                      className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Role</label>
                    <select 
                      className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                    >
                      <option value="admin">System Admin</option>
                      <option value="ho">H.O (Head Office)</option>
                      <option value="dm">District Manager</option>
                      <option value="sm">Sales Manager</option>
                      <option value="asm">Area Sales Manager</option>
                      <option value="ase">Area Sales Executive</option>
                      <option value="distributor">Distributor</option>
                      <option value="auditor">Auditor</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Mobile</label>
                    <input 
                      className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                      value={formData.mobile}
                      onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Region</label>
                    <input 
                      className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                      value={formData.region}
                      onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-3 pt-4">
                    <input 
                      type="checkbox"
                      id="active"
                      className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black"
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    />
                    <label htmlFor="active" className="text-sm font-bold">Active Account</label>
                  </div>
                </div>
                <div className="pt-4">
                  <button type="submit" className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10">
                    {editingUser ? 'Update Profile' : 'Create User'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}