import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, logActivity } from './supabase'; // Added logActivity
import { User } from '@supabase/supabase-js';
import { UserProfile, ActivityLog } from './types';
import { LayoutDashboard, Users, Store, CalendarClock, PlaySquare, FileBarChart, Settings, LogOut, Menu, X, Database, Bell, Trash2, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Modules
import { DashboardModule } from './modules/Dashboard';
import { UsersModule } from './modules/Users';
import { DistributorsModule } from './modules/Distributors';
import { SchedulerModule } from './modules/Scheduler';
import { ExecutionModule } from './modules/Execution';
import { MastersModule } from './modules/Masters';
import { ReportsModule } from './modules/Reports';

// Setup Force Password
import { ForcePasswordSetup } from './components/ForcePasswordSetup';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeModule, setActiveModule] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  // --- NEW: Global Alert/Activity State ---
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Real-time Activity Listener ---
  useEffect(() => {
    if (!user) return;
    
    const fetchLogs = async () => {
      const { data } = await supabase.from('activityLogs').select('*').order('timestamp', { ascending: false }).limit(100);
      if (data) setActivityLogs(data as ActivityLog[]);
    };
    fetchLogs();

    const channel = supabase.channel('global-activity')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activityLogs' }, fetchLogs)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('uid', userId).single();
      if (error) {
        if (error.code === 'PGRST116') {
          await supabase.auth.signOut();
          setAuthError("No authorized profile found for this user.");
        }
        throw error;
      }
      
      if (!data.active) {
        await supabase.auth.signOut();
        setAuthError("Your account has been deactivated. Contact Admin.");
        setLoading(false);
        return;
      }
      
      if (data.active === true && data.password_setup_required === true) {
         setNeedsPasswordSetup(true);
      } else {
         setNeedsPasswordSetup(false);
      }

      setProfile(data as UserProfile);
      
      // Log login activity automatically
      logActivity(user, data, "Logged into the system");

    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const signOut = async () => {
    logActivity(user, profile, "Logged out of the system");
    await supabase.auth.signOut();
  };

  const deleteActivityLog = async (logId: string) => {
    if (profile?.role !== 'admin') return;
    try {
      await supabase.from('activityLogs').delete().eq('id', logId);
    } catch (error) {
      console.error("Failed to delete log:", error);
    }
  };

  const clearAllLogs = async () => {
    if (profile?.role !== 'admin') return;
    if (window.confirm("WARNING: This will permanently delete ALL system activity logs. Continue?")) {
      try {
        await supabase.from('activityLogs').delete().neq('id', '0');
      } catch (error) {
        console.error("Failed to clear logs:", error);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 bg-zinc-200 rounded-2xl mb-4"></div>
          <div className="h-4 w-32 bg-zinc-200 rounded mb-2"></div>
          <div className="h-3 w-24 bg-zinc-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-zinc-100">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mb-8 mx-auto">
            <ShieldAlert className="text-white" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-center tracking-tight mb-2">Audit Portal Access</h2>
          <p className="text-center text-zinc-500 mb-8 text-sm">Sign in to your enterprise account.</p>
          
          {authError && <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-bold rounded-xl text-center border border-red-100">{authError}</div>}
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">Email Address</label>
              <input type="email" required className="w-full mt-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">Password</label>
              <input type="password" required className="w-full mt-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={isLoggingIn} className="w-full mt-6 py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-70 flex justify-center items-center">
              {isLoggingIn ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Secure Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (needsPasswordSetup) {
     return <ForcePasswordSetup user={user} onComplete={() => setNeedsPasswordSetup(false)} />;
  }

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['admin', 'ho', 'dm', 'sm', 'asm', 'ase', 'auditor'] },
    { id: 'masters', label: 'Data Masters', icon: Database, roles: ['admin', 'ho'] },
    { id: 'users', label: 'Team', icon: Users, roles: ['admin', 'ho'] },
    { id: 'distributors', label: 'Distributors', icon: Store, roles: ['admin', 'ho', 'dm', 'sm', 'asm', 'ase'] },
    { id: 'scheduler', label: 'Schedule', icon: CalendarClock, roles: ['admin', 'ho', 'dm', 'sm', 'asm', 'ase', 'auditor'] },
    { id: 'execution', label: 'Execution', icon: PlaySquare, roles: ['admin', 'ho', 'ase', 'auditor'] },
    { id: 'reports', label: 'Reports', icon: FileBarChart, roles: ['admin', 'ho', 'dm', 'sm', 'asm'] },
  ];

  const allowedNavItems = navItems.filter(item => item.roles.includes(profile.role));

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule />;
      case 'users': return <UsersModule />;
      case 'distributors': return <DistributorsModule />;
      case 'scheduler': return <SchedulerModule />;
      case 'execution': return <ExecutionModule />;
      case 'masters': return <MastersModule />;
      case 'reports': return <ReportsModule />;
      default: return <DashboardModule />;
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, signOut }}>
      <div className="min-h-screen bg-[#F8F9FA] flex">
        
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex flex-col w-72 bg-white border-r border-zinc-200 fixed h-full z-40">
          <div className="p-8 pb-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg"><ShieldAlert className="text-white" size={20} /></div>
            <div><h1 className="font-black text-xl tracking-tight leading-none">Audit<br/><span className="text-zinc-400">Pro</span></h1></div>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar mt-4">
            <div className="px-4 mb-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Main Menu</div>
            {allowedNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button key={item.id} onClick={() => setActiveModule(item.id)} className={cn("w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl font-bold text-sm transition-all group relative overflow-hidden", isActive ? "bg-black text-white shadow-md" : "text-zinc-500 hover:bg-zinc-100 hover:text-black")}>
                  {isActive && <motion.div layoutId="active-nav" className="absolute inset-0 bg-black -z-10" />}
                  <Icon size={18} className={cn("z-10", isActive ? "text-white" : "text-zinc-400 group-hover:text-black")} />
                  <span className="z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-6 border-t border-zinc-100">
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200/50 mb-3">
              <p className="font-bold text-sm truncate">{profile.name}</p>
              <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 mt-0.5 bg-blue-50 w-fit px-1.5 rounded">{profile.role}</p>
            </div>
            <button onClick={signOut} className="w-full flex items-center gap-2 px-4 py-3 text-red-600 font-bold text-sm rounded-xl hover:bg-red-50 transition-colors"><LogOut size={16} /> Sign Out</button>
          </div>
        </aside>

        {/* Mobile Header */}
        <div className="lg:hidden fixed top-0 w-full bg-white border-b border-zinc-200 z-40 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center"><ShieldAlert className="text-white" size={16} /></div><span className="font-black text-lg tracking-tight">AuditPro</span></div>
          
          <div className="flex items-center gap-3">
            <button onClick={() => setIsActivityOpen(true)} className="p-2 text-zinc-600 hover:bg-zinc-100 rounded-lg relative">
              <Bell size={20} />
              {activityLogs.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
            </button>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-black bg-zinc-100 rounded-lg"><Menu size={20} /></button>
          </div>
        </div>

        <main className="flex-1 lg:ml-72 flex flex-col min-h-screen pt-16 lg:pt-0">
          
          {/* Desktop Top Header */}
          <header className="hidden lg:flex bg-white/80 backdrop-blur-md border-b border-zinc-200 sticky top-0 z-30 px-8 py-5 items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight capitalize">{activeModule.replace('_', ' ')}</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Manage your audit execution and tracking.</p>
            </div>
            <div className="flex items-center gap-4">
              
              {/* --- NOTIFICATION BELL --- */}
              <button 
                onClick={() => setIsActivityOpen(true)} 
                className="relative p-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-full transition-colors"
                title="System Activity Logs"
              >
                <Bell size={20} />
                {activityLogs.length > 0 && (
                  <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
                )}
              </button>

              <div className="flex items-center gap-3 bg-zinc-50 pl-2 pr-4 py-2 rounded-full border border-zinc-200">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">{profile.name.charAt(0)}</div>
                <div className="hidden sm:block">
                  <p className="text-sm font-bold text-zinc-900 leading-none">{profile.name}</p>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">{profile.role}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
            {renderModule()}
          </div>
        </main>
      </div>

      {/* --- GLOBAL ACTIVITY ALERT BOX (SLIDE-OVER) --- */}
      <AnimatePresence>
        {isActivityOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsActivityOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 w-full sm:w-[400px] h-full bg-white shadow-2xl z-50 border-l border-zinc-200 flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-zinc-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center shadow-md">
                    <Bell size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">System Activity</h3>
                    <p className="text-xs text-zinc-500">Live global logs</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {profile.role === 'admin' && activityLogs.length > 0 && (
                    <button onClick={clearAllLogs} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Clear All Logs">
                      <Trash2 size={18} />
                    </button>
                  )}
                  <button onClick={() => setIsActivityOpen(false)} className="p-2 hover:bg-zinc-200 rounded-xl transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-zinc-50/50">
                {activityLogs.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400 flex flex-col items-center">
                    <Bell size={32} className="mb-3 opacity-20" />
                    <p className="font-bold">No activity yet</p>
                    <p className="text-xs mt-1">Actions performed in the system will appear here.</p>
                  </div>
                ) : (
                  activityLogs.map(log => (
                    <div key={log.id} className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm relative group">
                      <div className="flex items-start justify-between mb-2 gap-4">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">
                            <span className="font-bold">{log.userName}</span> {log.action}
                          </p>
                          {log.details && <p className="text-xs text-zinc-500 mt-1 italic">"{log.details}"</p>}
                        </div>
                        {profile.role === 'admin' && (
                          <button 
                            onClick={() => deleteActivityLog(log.id)}
                            className="text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-3 text-[10px] font-bold uppercase tracking-wider">
                        <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{log.userRole}</span>
                        <span className="text-zinc-400">{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </AuthContext.Provider>
  );
}