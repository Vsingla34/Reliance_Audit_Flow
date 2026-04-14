import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, logActivity } from './supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile, ActivityLog } from './types';
import { LayoutDashboard, Users, Store, CalendarClock, PlaySquare, FileBarChart, LogOut, Menu, X, Database, Bell, Trash2, ShieldAlert } from 'lucide-react';
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

// --- COLOR ENGINE FOR ACTIVITY LOGS ---
const getLogStyle = (action: string) => {
  const a = action.toLowerCase();
  if (a.includes('scheduled')) return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', tag: 'bg-blue-100 text-blue-700' };
  if (a.includes('drainage')) return { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-900', tag: 'bg-teal-100 text-teal-700' };
  if (a.includes('check-in') || a.includes('selfie')) return { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900', tag: 'bg-indigo-100 text-indigo-700' };
  if (a.includes('whatsapp') || a.includes('document')) return { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-900', tag: 'bg-fuchsia-100 text-fuchsia-700' };
  if (a.includes('verified') || a.includes('completed') || a.includes('signed off') || a.includes('approved')) return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', tag: 'bg-emerald-100 text-emerald-700' };
  if (a.includes('buffer')) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', tag: 'bg-amber-100 text-amber-700' };
  if (a.includes('reset') || a.includes('overridden') || a.includes('rejected') || a.includes('deleted')) return { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900', tag: 'bg-rose-100 text-rose-700' };
  
  return { bg: 'bg-white', border: 'border-zinc-200', text: 'text-zinc-900', tag: 'bg-zinc-100 text-zinc-600' };
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // ==========================================
  // CUSTOM URL ROUTING SYSTEM
  // ==========================================
  const getInitialModule = () => {
    const path = window.location.pathname.replace('/', '');
    return path || 'dashboard'; // Default to dashboard if root '/' is hit
  };

  const [activeModuleState, setActiveModuleState] = useState(getInitialModule);

  // Wrapper function to update both the UI state AND the browser URL
  const setActiveModule = (moduleId: string) => {
    setActiveModuleState(moduleId);
    window.history.pushState({}, '', `/${moduleId}`);
  };

  // Listen for the Browser's Back/Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace('/', '');
      setActiveModuleState(path || 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  // ==========================================

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

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

  useEffect(() => {
    if (!user) return;
    
    const fetchLogs = async () => {
      const { data } = await supabase.from('activityLogs').select('*').order('timestamp', { ascending: false }).limit(100);
      if (data) {
        const filteredLogs = (data as ActivityLog[]).filter(log => 
          !log.action.toLowerCase().includes('logged in') && 
          !log.action.toLowerCase().includes('logged out')
        );
        setActivityLogs(filteredLogs);
      }
    };
    fetchLogs();

    const channel = supabase.channel('global-activity')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activityLogs' }, fetchLogs)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // ==========================================
  // ROLE-BASED NAVIGATION & SMART REDIRECT
  // ==========================================
  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['superadmin', 'admin', 'ho'] },
    { id: 'masters', label: 'Data Masters', icon: Database, roles: ['superadmin', 'admin', 'ho'] },
    { id: 'users', label: 'Team', icon: Users, roles: ['superadmin', 'admin'] },
    { id: 'distributors', label: 'Distributors', icon: Store, roles: ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm', 'ase'] },
    { id: 'scheduler', label: 'Schedule', icon: CalendarClock, roles: ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm', 'ase', 'auditor'] },
    { id: 'execution', label: 'Execution', icon: PlaySquare, roles: ['superadmin', 'admin', 'ho', 'ase', 'auditor'] },
    { id: 'reports', label: 'Reports', icon: FileBarChart, roles: ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm'] },
  ];

  const allowedNavItems = navItems.filter(item => {
    const userRole = (profile?.role || '').toLowerCase().trim();
    return item.roles.includes(userRole);
  });

  useEffect(() => {
    if (profile && allowedNavItems.length > 0) {
      const isAllowed = allowedNavItems.some(item => item.id === activeModuleState);
      
      if (!isAllowed) {
        // If they forcefully try to access a URL they aren't allowed to see, redirect and replace history
        const fallbackId = allowedNavItems[0].id;
        setActiveModuleState(fallbackId);
        window.history.replaceState({}, '', `/${fallbackId}`);
      } else if (window.location.pathname === '/' || window.location.pathname !== `/${activeModuleState}`) {
        // Ensure the URL perfectly syncs with the loaded component (e.g. if they just typed localhost:5173/)
        window.history.replaceState({}, '', `/${activeModuleState}`);
      }
    }
  }, [profile, activeModuleState]); 
  // ==========================================

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
    await supabase.auth.signOut();
  };

  const deleteActivityLog = async (logId: string) => {
    if (profile?.role !== 'superadmin') return;
    try {
      await supabase.from('activityLogs').delete().eq('id', logId);
    } catch (error) { console.error("Failed to delete log:", error); }
  };

  const clearAllLogs = async () => {
    if (profile?.role !== 'superadmin') return;
    if (window.confirm("WARNING: This will permanently delete ALL system activity logs. Continue?")) {
      try {
        await supabase.from('activityLogs').delete().neq('id', '0');
      } catch (error) { console.error("Failed to clear logs:", error); }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
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
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl border border-zinc-100">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-black rounded-2xl flex items-center justify-center mb-6 sm:mb-8 mx-auto shadow-lg">
            <ShieldAlert className="text-white" size={28} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-center tracking-tight mb-2">Audit Portal Access</h2>
          <p className="text-center text-zinc-500 mb-6 sm:mb-8 text-xs sm:text-sm">Sign in to your enterprise account.</p>
          
          {authError && <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-bold rounded-xl text-center border border-red-100">{authError}</div>}
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">Email Address</label>
              <input type="email" required className="w-full mt-1 px-4 py-3 sm:py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-sm sm:text-base" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">Password</label>
              <input type="password" required className="w-full mt-1 px-4 py-3 sm:py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-sm sm:text-base" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={isLoggingIn} className="w-full mt-6 py-3.5 sm:py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-70 flex justify-center items-center text-sm sm:text-base">
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

  const renderModule = () => {
    switch (activeModuleState) {
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
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col w-full overflow-x-hidden">
        
        {/* DESKTOP SIDEBAR */}
        <aside className="hidden lg:flex flex-col w-72 bg-white border-r border-zinc-200 fixed h-full z-40">
          <div className="p-8 pb-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg"><ShieldAlert className="text-white" size={20} /></div>
            <div><h1 className="font-black text-xl tracking-tight leading-none">Audit<br/><span className="text-zinc-400">Pro</span></h1></div>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar mt-4">
            <div className="px-4 mb-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Main Menu</div>
            {allowedNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeModuleState === item.id;
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
              <p className={cn("text-[10px] font-black uppercase tracking-wider mt-0.5 w-fit px-1.5 rounded", profile.role === 'superadmin' ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-600")}>
                {profile.role}
              </p>
            </div>
            <button onClick={signOut} className="w-full flex items-center gap-2 px-4 py-3 text-red-600 font-bold text-sm rounded-xl hover:bg-red-50 transition-colors"><LogOut size={16} /> Sign Out</button>
          </div>
        </aside>

        {/* MOBILE HEADER */}
        <div className="lg:hidden fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-zinc-200 z-40 px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shadow-md"><ShieldAlert className="text-white" size={16} /></div>
            <span className="font-black text-lg tracking-tight">Audit<span className="text-zinc-400">Pro</span></span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setIsActivityOpen(true)} className="p-2 text-zinc-600 hover:bg-zinc-100 rounded-lg relative">
              <Bell size={20} />
              {activityLogs.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
            </button>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-black bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"><Menu size={20} /></button>
          </div>
        </div>

        {/* MOBILE SLIDE-OUT MENU */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
                onClick={() => setIsMobileMenuOpen(false)} 
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 lg:hidden" 
              />
              <motion.div 
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} 
                transition={{ type: 'spring', damping: 25, stiffness: 200 }} 
                className="fixed top-0 left-0 w-[80%] max-w-[320px] h-full bg-white shadow-2xl z-50 flex flex-col lg:hidden border-r border-zinc-200"
              >
                <div className="p-6 flex items-center justify-between border-b border-zinc-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center"><ShieldAlert className="text-white" size={16} /></div>
                    <span className="font-black text-lg tracking-tight">AuditPro</span>
                  </div>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200"><X size={20} /></button>
                </div>
                
                <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
                  {allowedNavItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeModuleState === item.id;
                    return (
                      <button 
                        key={item.id} 
                        onClick={() => { setActiveModule(item.id); setIsMobileMenuOpen(false); }} 
                        className={cn("w-full flex items-center gap-3 px-4 py-4 rounded-xl font-bold text-sm transition-all", isActive ? "bg-black text-white shadow-md" : "text-zinc-600 hover:bg-zinc-50 hover:text-black")}
                      >
                        <Icon size={18} className={isActive ? "text-white" : "text-zinc-400"} />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>

                <div className="p-6 border-t border-zinc-100 bg-zinc-50">
                  <div className="mb-4">
                    <p className="font-bold text-sm text-zinc-900 truncate">{profile.name}</p>
                    <p className={cn("text-[10px] font-black uppercase tracking-wider mt-1", profile.role === 'superadmin' ? "text-purple-600" : "text-blue-600")}>{profile.role}</p>
                  </div>
                  <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-100 text-red-600 font-bold text-sm rounded-xl shadow-sm active:scale-95 transition-all"><LogOut size={16} /> Sign Out</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 lg:pl-72 flex flex-col min-h-screen pt-16 lg:pt-0 w-full relative">
          
          <header className="hidden lg:flex bg-white/80 backdrop-blur-md border-b border-zinc-200 sticky top-0 z-30 px-8 py-5 items-center justify-between w-full">
            <div>
              <h2 className="text-2xl font-bold tracking-tight capitalize">{activeModuleState.replace('_', ' ')}</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Manage your audit execution and tracking.</p>
            </div>
            <div className="flex items-center gap-4">
              
              <button onClick={() => setIsActivityOpen(true)} className="relative p-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-full transition-colors" title="System Activity Logs">
                <Bell size={20} />
                {activityLogs.length > 0 && <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />}
              </button>

              <div className="flex items-center gap-3 bg-zinc-50 pl-2 pr-4 py-2 rounded-full border border-zinc-200">
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0", profile.role === 'superadmin' ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700")}>{profile.name.charAt(0)}</div>
                <div className="hidden sm:block">
                  <p className="text-sm font-bold text-zinc-900 leading-none truncate max-w-[150px]">{profile.name}</p>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">{profile.role}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0">
            <div className="lg:hidden mb-6 mt-2">
              <h2 className="text-xl font-bold tracking-tight capitalize">{activeModuleState.replace('_', ' ')}</h2>
            </div>
            
            {renderModule()}
          </div>
        </main>
      </div>

      {/* ACTIVITY LOG DRAWER */}
      <AnimatePresence>
        {isActivityOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsActivityOpen(false)} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }} 
              className="fixed top-0 right-0 w-full sm:w-[450px] max-w-[100vw] h-full bg-white shadow-2xl z-50 border-l border-zinc-200 flex flex-col"
            >
              <div className="p-4 sm:p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-zinc-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center shadow-md shrink-0"><Bell size={20} /></div>
                  <div><h3 className="font-bold text-base sm:text-lg">System Activity</h3><p className="text-[10px] sm:text-xs text-zinc-500">Live global assignment logs</p></div>
                </div>
                <div className="flex items-center gap-2">
                  {profile.role === 'superadmin' && activityLogs.length > 0 && <button onClick={clearAllLogs} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Clear All Logs"><Trash2 size={18} /></button>}
                  <button onClick={() => setIsActivityOpen(false)} className="p-2 hover:bg-zinc-200 rounded-xl transition-colors"><X size={20} /></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-zinc-50/50">
                {activityLogs.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400 flex flex-col items-center"><Bell size={32} className="mb-3 opacity-20" /><p className="font-bold">No activity yet</p><p className="text-xs mt-1">Actions performed in the system will appear here.</p></div>
                ) : (
                  activityLogs.map(log => {
                    const style = getLogStyle(log.action);
                    return (
                      <div key={log.id} className={cn("p-4 sm:p-5 rounded-2xl border shadow-sm relative group transition-all", style.bg, style.border)}>
                        <div className="flex items-start justify-between mb-2 gap-3 sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-xs sm:text-sm leading-snug break-words", style.text)}>
                              <span className="font-black block text-sm sm:text-base mb-0.5">{log.action}</span>
                              <span className="font-bold">{log.userName}</span>
                            </p>
                            {log.details && <p className={cn("text-[10px] sm:text-xs mt-2 font-medium opacity-90 break-words", style.text)}>"{log.details}"</p>}
                          </div>
                          {profile.role === 'superadmin' && (
                            <button onClick={() => deleteActivityLog(log.id)} className="text-zinc-400 hover:text-red-500 bg-white/50 p-1.5 rounded-lg transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100 shrink-0"><Trash2 size={14} /></button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-3 sm:mt-4 text-[9px] sm:text-[10px] font-black uppercase tracking-wider">
                          <span className={cn("px-2 py-1 rounded shadow-sm", style.tag)}>{log.userRole}</span>
                          <span className={cn("opacity-70", style.text)}>{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AuthContext.Provider>
  );
}