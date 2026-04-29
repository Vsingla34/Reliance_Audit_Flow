import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { supabase, logActivity } from './supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile, ActivityLog } from './types';
import { LayoutDashboard, Users, Store, CalendarClock, PlaySquare, FileBarChart, LogOut, Menu, X, Database, Bell, Trash2, ShieldAlert, Search, CheckCheck, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { isToday, isThisWeek, isThisMonth } from 'date-fns';

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

  const getInitialModule = () => {
    const path = window.location.pathname.replace('/', '');
    return path || 'dashboard'; 
  };

  const [activeModuleState, setActiveModuleState] = useState(getInitialModule);

  const setActiveModule = (moduleId: string) => {
    setActiveModuleState(moduleId);
    window.history.pushState({}, '', `/${moduleId}`);
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace('/', '');
      setActiveModuleState(path || 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  // --- LOG & NOTIFICATION DRAWER STATE ---
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'alerts' | 'activity'>('alerts');
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [logSearch, setLogSearch] = useState('');
  const [logTimeFilter, setLogTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');

  // --- ROBUST AUTHENTICATION HANDLER ---
  useEffect(() => {
    // 1. Instantly check if this URL is from an email recovery link
    if (window.location.href.includes('type=recovery')) {
       setNeedsPasswordSetup(true);
    }

    // 2. Fetch Initial Session (Supabase automatically handles the URL secure code here)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // 3. Listen for Background Authentication Events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      
      // If Supabase natively detects a password reset link was successfully consumed
      if (event === 'PASSWORD_RECOVERY') {
         setNeedsPasswordSetup(true);
      }

      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch Logs & Notifications
  useEffect(() => {
    if (!user || !profile) return;
    
    const isPrivileged = ['superadmin', 'admin', 'ho'].includes(profile.role);

    const fetchLogs = async () => {
      if (!isPrivileged) return;
      const { data } = await supabase.from('activityLogs').select('*').order('timestamp', { ascending: false }).limit(100);
      if (data) {
        const filteredLogs = (data as ActivityLog[]).filter(log => 
          !log.action.toLowerCase().includes('logged in') && 
          !log.action.toLowerCase().includes('logged out')
        );
        setActivityLogs(filteredLogs);
      }
    };
    
    if (isPrivileged) fetchLogs();

    const fetchNotifications = async () => {
      const { data } = await supabase.from('notifications').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(50);
      if (data) {
        setNotifications(data);
        setUnreadCount(data.filter((n: any) => !n.is_read).length);
      }
    };
    fetchNotifications();

    let channel1: any;
    if (isPrivileged) {
      channel1 = supabase.channel('global-activity')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activityLogs' }, fetchLogs).subscribe();
    }

    const channel2 = supabase.channel('personal-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, fetchNotifications).subscribe();

    return () => { 
      if (channel1) supabase.removeChannel(channel1); 
      supabase.removeChannel(channel2); 
    };
  }, [user, profile]);

  const markAllAsRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', user.id).eq('is_read', false);
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  // --- FILTER ENGINE ---
  const filteredLogs = useMemo(() => {
    return activityLogs.filter(log => {
      let matchesTime = true;
      if (logTimeFilter !== 'all') {
        const logDate = new Date(log.timestamp);
        if (logTimeFilter === 'today') matchesTime = isToday(logDate);
        else if (logTimeFilter === 'week') matchesTime = isThisWeek(logDate, { weekStartsOn: 1 });
        else if (logTimeFilter === 'month') matchesTime = isThisMonth(logDate);
      }

      const searchLower = logSearch.toLowerCase().trim();
      const matchesSearch = searchLower === '' || 
        (log.details && log.details.toLowerCase().includes(searchLower)) ||
        (log.action && log.action.toLowerCase().includes(searchLower)) ||
        (log.userName && log.userName.toLowerCase().includes(searchLower));

      return matchesTime && matchesSearch;
    });
  }, [activityLogs, logTimeFilter, logSearch]);

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
        const fallbackId = allowedNavItems[0].id;
        setActiveModuleState(fallbackId);
        window.history.replaceState({}, '', `/${fallbackId}`);
      } else if (window.location.pathname === '/' || window.location.pathname !== `/${activeModuleState}`) {
        window.history.replaceState({}, '', `/${activeModuleState}`);
      }
    }
  }, [profile, activeModuleState]); 

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('uid', userId).single();
      
      if (error) {
        console.error("Database fetch error:", error);
        if (error.code === 'PGRST116') {
          await supabase.auth.signOut();
          setAuthError("No authorized profile found for this user. (Check Database Permissions)");
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
    if (profile?.role !== 'superadmin') {
      alert("Action Denied: Only SuperAdmins can delete activity logs.");
      return;
    }
    try {
      await supabase.from('activityLogs').delete().eq('id', logId);
    } catch (error) { console.error("Failed to delete log:", error); }
  };

  const clearAllLogs = async () => {
    if (profile?.role !== 'superadmin') {
      alert("Action Denied: Only SuperAdmins can clear system logs.");
      return;
    }
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

  // 1. PASSWORD SETUP INTERCEPTION (Must be placed before Login Screen)
  if (needsPasswordSetup && user) {
     return <ForcePasswordSetup user={user} onComplete={() => {
        setNeedsPasswordSetup(false);
        fetchProfile(user.id);
     }} />;
  }

  // 2. LOGIN SCREEN
  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50"></div>
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-100 rounded-full blur-3xl opacity-50"></div>
        </div>

        <div className="max-w-[420px] w-full bg-white/80 backdrop-blur-2xl p-8 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl border border-white/60 relative z-10">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-black rounded-2xl flex items-center justify-center shadow-lg">
              <ShieldAlert className="text-white" size={28} />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Welcome Back</h2>
            <p className="text-zinc-500 text-sm mt-2">Sign in to your enterprise auditing portal.</p>
          </div>
          
          {authError && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 bg-red-50/80 text-red-600 text-sm font-bold rounded-2xl text-center border border-red-100">
              {authError}
            </motion.div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 ml-2">Email Address</label>
              <input type="email" required className="w-full mt-1.5 px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm shadow-sm" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 ml-2">Password</label>
              <input type="password" required className="w-full mt-1.5 px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm shadow-sm" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button type="submit" disabled={isLoggingIn} className="w-full mt-8 py-4 bg-gradient-to-r from-blue-700 to-blue-900 text-white rounded-2xl font-bold hover:from-blue-800 hover:to-black transition-all shadow-xl shadow-blue-900/20 active:scale-95 disabled:opacity-70 flex justify-center items-center text-sm sm:text-base">
              {isLoggingIn ? <Loader2 size={20} className="animate-spin text-white/70" /> : 'Secure Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. MAIN APPLICATION ROUTING
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
      <div className="min-h-screen bg-[#F4F5F7] flex flex-col w-full overflow-x-hidden font-sans">
        
        {/* DESKTOP SIDEBAR */}
        <aside className="hidden lg:flex flex-col w-72 bg-white/70 backdrop-blur-3xl border-r border-zinc-200/60 fixed h-full z-40 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
          <div className="p-8 pb-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg"><ShieldAlert className="text-white" size={20} /></div>
            <div><h1 className="font-black text-xl tracking-tight leading-none">Reliance<br/><span className="text-zinc-400">Audit</span></h1></div>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar mt-4">
            <div className="px-4 mb-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Main Menu</div>
            {allowedNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeModuleState === item.id;
              return (
                <button key={item.id} onClick={() => setActiveModule(item.id)} className={cn(
                  "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl font-bold text-sm transition-all group relative overflow-hidden",
                  isActive ? "text-blue-700 shadow-sm border border-blue-100" : "text-zinc-500 hover:bg-white hover:text-zinc-900 border border-transparent"
                )}>
                  {isActive && <motion.div layoutId="active-nav" className="absolute inset-0 bg-gradient-to-r from-blue-50 to-blue-100/50 -z-10" />}
                  <Icon size={18} className={cn("z-10 transition-colors", isActive ? "text-blue-600" : "text-zinc-400 group-hover:text-zinc-600")} />
                  <span className="z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-6 border-t border-zinc-200/60 bg-white/50">
            <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm mb-3">
              <p className="font-bold text-sm text-zinc-900 truncate">{profile.name}</p>
              <p className={cn("text-[9px] font-black uppercase tracking-wider mt-1 w-fit px-1.5 py-0.5 rounded", profile.role === 'superadmin' ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-600")}>
                {profile.role}
              </p>
            </div>
            <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-zinc-600 hover:text-red-600 hover:bg-red-50 border border-zinc-100 hover:border-red-100 font-bold text-sm rounded-xl transition-all shadow-sm active:scale-95">
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </aside>

        {/* MOBILE HEADER */}
        <div className="lg:hidden fixed top-0 w-full bg-white/80 backdrop-blur-2xl border-b border-zinc-200/60 z-40 px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shadow-md"><ShieldAlert className="text-white" size={16} /></div>
            <span className="font-black text-lg tracking-tight">Reliance<span className="text-zinc-400">Audit</span></span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setIsActivityOpen(true)} className="p-2 text-zinc-600 hover:bg-white rounded-xl relative shadow-sm border border-transparent hover:border-zinc-200 transition-all">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-zinc-600 hover:bg-white rounded-xl shadow-sm border border-transparent hover:border-zinc-200 transition-all"><Menu size={20} /></button>
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
                className="fixed top-0 left-0 w-[85%] max-w-[340px] h-full bg-white/95 backdrop-blur-3xl shadow-2xl z-50 flex flex-col lg:hidden border-r border-zinc-200/60"
              >
                <div className="p-6 flex items-center justify-between border-b border-zinc-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center"><ShieldAlert className="text-white" size={16} /></div>
                    <span className="font-black text-lg tracking-tight">RelianceAudit</span>
                  </div>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200"><X size={20} /></button>
                </div>
                
                <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
                  <div className="px-4 mb-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Main Menu</div>
                  {allowedNavItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeModuleState === item.id;
                    return (
                      <button 
                        key={item.id} 
                        onClick={() => { setActiveModule(item.id); setIsMobileMenuOpen(false); }} 
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-sm transition-all",
                          isActive ? "bg-gradient-to-r from-blue-50 to-blue-100/50 text-blue-700 border border-blue-100 shadow-sm" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 border border-transparent"
                        )}
                      >
                        <Icon size={18} className={isActive ? "text-blue-600" : "text-zinc-400"} />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>

                <div className="p-6 border-t border-zinc-100 bg-white/50">
                  <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm mb-4">
                    <p className="font-bold text-sm text-zinc-900 truncate">{profile.name}</p>
                    <p className={cn("text-[9px] font-black uppercase tracking-wider mt-1 w-fit px-1.5 py-0.5 rounded", profile.role === 'superadmin' ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-600")}>{profile.role}</p>
                  </div>
                  <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-zinc-200 text-zinc-600 hover:text-red-600 hover:border-red-100 hover:bg-red-50 font-bold text-sm rounded-xl shadow-sm active:scale-95 transition-all"><LogOut size={16} /> Sign Out</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 lg:pl-72 flex flex-col min-h-screen pt-16 lg:pt-0 w-full relative z-10">
          
          <header className="hidden lg:flex bg-white/60 backdrop-blur-2xl border-b border-zinc-200/60 sticky top-0 z-30 px-8 py-4 items-center justify-between w-full shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-zinc-900 capitalize">{activeModuleState.replace('_', ' ')}</h2>
              <p className="text-xs font-medium text-zinc-500 mt-1 uppercase tracking-widest">Enterprise Management Portal</p>
            </div>
            <div className="flex items-center gap-4">
              
              <button onClick={() => setIsActivityOpen(true)} className="relative p-3 bg-white border border-zinc-200 hover:border-blue-200 hover:bg-blue-50 text-zinc-600 hover:text-blue-600 rounded-xl transition-all shadow-sm" title="Notifications & Activity">
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              <div className="flex items-center gap-3 bg-white pl-2 pr-4 py-2 rounded-2xl border border-zinc-200 shadow-sm">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0", profile.role === 'superadmin' ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700")}>{profile.name.charAt(0)}</div>
                <div className="hidden sm:block">
                  <p className="text-sm font-bold text-zinc-900 leading-none truncate max-w-[150px]">{profile.name}</p>
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-1">{profile.role}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0">
            <div className="lg:hidden mb-6 mt-2">
              <h2 className="text-2xl font-black tracking-tight text-zinc-900 capitalize">{activeModuleState.replace('_', ' ')}</h2>
              <p className="text-[10px] font-bold text-zinc-400 mt-1 uppercase tracking-widest">Enterprise Portal</p>
            </div>
            
            {renderModule()}
          </div>
        </main>
      </div>

      {/* NOTIFICATIONS & ACTIVITY DRAWER */}
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
                  <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-md shrink-0"><Bell size={20} /></div>
                  <div><h3 className="font-bold text-base sm:text-lg">Notifications</h3><p className="text-[10px] sm:text-xs text-zinc-500">Alerts and System Activity</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setIsActivityOpen(false)} className="p-2 hover:bg-zinc-200 rounded-xl transition-colors"><X size={20} /></button>
                </div>
              </div>

              {/* TABS (DYNAMIC) */}
              <div className="flex px-4 pt-4 border-b border-zinc-100 shrink-0">
                <button 
                  onClick={() => setDrawerTab('alerts')} 
                  className={cn(
                    "pb-3 text-sm font-bold border-b-2 transition-all relative flex items-center justify-center gap-2", 
                    drawerTab === 'alerts' ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-400 hover:text-zinc-600",
                    isAdminOrHO ? "flex-1" : "w-full"
                  )}
                >
                  {isAdminOrHO ? 'My Alerts' : 'My Activity & Alerts'}
                  {unreadCount > 0 && <span className="px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[9px]">{unreadCount}</span>}
                </button>
                
                {isAdminOrHO && (
                  <button 
                    onClick={() => setDrawerTab('activity')} 
                    className={cn("flex-1 pb-3 text-sm font-bold border-b-2 transition-all", drawerTab === 'activity' ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-400 hover:text-zinc-600")}
                  >
                    Global Activity
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 flex flex-col">
                {drawerTab === 'alerts' ? (
                  <div className="p-4 space-y-3">
                    {unreadCount > 0 && (
                      <div className="flex justify-end mb-2">
                        <button onClick={markAllAsRead} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"><CheckCheck size={14}/> Mark all read</button>
                      </div>
                    )}
                    {notifications.length === 0 ? (
                      <div className="text-center py-12 text-zinc-400 flex flex-col items-center"><Bell size={32} className="mb-3 opacity-20" /><p className="font-bold">All caught up!</p><p className="text-xs mt-1">You have no personal alerts.</p></div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} onClick={() => markAsRead(n.id)} className={cn("p-4 rounded-2xl border shadow-sm transition-all cursor-pointer", n.is_read ? "bg-white border-zinc-200 opacity-70" : "bg-blue-50 border-blue-200")}>
                          <div className="flex justify-between items-start mb-1">
                            <h4 className={cn("font-bold text-sm", n.is_read ? "text-zinc-700" : "text-blue-900")}>{n.title}</h4>
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0"></span>}
                          </div>
                          <p className={cn("text-xs leading-relaxed", n.is_read ? "text-zinc-500" : "text-blue-800")}>{n.message}</p>
                          <p className="text-[10px] font-bold text-zinc-400 mt-3">{new Date(n.created_at).toLocaleString()}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-zinc-100 space-y-3 bg-white shrink-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" placeholder="Search logs, distributors, users..." className="w-full pl-9 pr-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
                      </div>
                      <select className="w-full p-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer text-zinc-700" value={logTimeFilter} onChange={(e) => setLogTimeFilter(e.target.value as any)}>
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                      </select>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                      {filteredLogs.length === 0 ? (
                        <div className="text-center py-12 text-zinc-400 flex flex-col items-center"><Bell size={32} className="mb-3 opacity-20" /><p className="font-bold">No activity found</p></div>
                      ) : (
                        filteredLogs.map(log => {
                          const style = getLogStyle(log.action);
                          return (
                            <div key={log.id} className={cn("p-4 rounded-2xl border shadow-sm transition-all", style.bg, style.border)}>
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
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AuthContext.Provider>
  );
}