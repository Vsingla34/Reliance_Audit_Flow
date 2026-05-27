import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { supabase, logActivity } from './supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile, ActivityLog } from './types';
import { LayoutDashboard, Users, Store, CalendarClock, PlaySquare, FileBarChart, LogOut, Menu, X, Database, Bell, Trash2, Search, CheckCheck, Loader2, CalendarDays, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { isToday, isThisWeek, isThisMonth } from 'date-fns';
import logo from './public/favicon.png'

// Modules
import { DashboardModule } from './modules/Dashboard';
import { UsersModule } from './modules/Users';
import { DistributorsModule } from './modules/Distributors';
import { SchedulerModule } from './modules/Scheduler';
import { ExecutionModule } from './modules/Execution';
import { MastersModule } from './modules/Masters';
import { ReportsModule } from './modules/Reports';
import { TodayAssignmentsModule } from './modules/TodayAssignments';

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

// --- REFINED COLOR ENGINE FOR ACTIVITY LOGS ---
const getLogStyle = (action: string) => {
  const a = action.toLowerCase();
  if (a.includes('scheduled')) return { bg: 'bg-indigo-50/50', border: 'border-indigo-100', text: 'text-indigo-900', tag: 'bg-indigo-100/50 text-indigo-700' };
  if (a.includes('drainage')) return { bg: 'bg-cyan-50/50', border: 'border-cyan-100', text: 'text-cyan-900', tag: 'bg-cyan-100/50 text-cyan-700' };
  if (a.includes('check-in') || a.includes('selfie')) return { bg: 'bg-sky-50/50', border: 'border-sky-100', text: 'text-sky-900', tag: 'bg-sky-100/50 text-sky-700' };
  if (a.includes('whatsapp') || a.includes('document')) return { bg: 'bg-fuchsia-50/50', border: 'border-fuchsia-100', text: 'text-fuchsia-900', tag: 'bg-fuchsia-100/50 text-fuchsia-700' };
  if (a.includes('verified') || a.includes('completed') || a.includes('signed off') || a.includes('approved')) return { bg: 'bg-emerald-50/50', border: 'border-emerald-100', text: 'text-emerald-900', tag: 'bg-emerald-100/50 text-emerald-700' };
  if (a.includes('buffer')) return { bg: 'bg-amber-50/50', border: 'border-amber-100', text: 'text-amber-900', tag: 'bg-amber-100/50 text-amber-700' };
  if (a.includes('reset') || a.includes('overridden') || a.includes('rejected') || a.includes('deleted')) return { bg: 'bg-rose-50/50', border: 'border-rose-100', text: 'text-rose-900', tag: 'bg-rose-100/50 text-rose-700' };
  
  return { bg: 'bg-slate-50/50', border: 'border-slate-200', text: 'text-slate-900', tag: 'bg-slate-100 text-slate-600' };
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: check URL for a recovery / invite token in BOTH hash and query string.
// Supabase can deliver the token either way depending on the Auth settings.
// ─────────────────────────────────────────────────────────────────────────────
const urlContainsRecoveryToken = (): boolean => {
  // Check hash fragment  → #access_token=xxx&type=recovery
  const hash = window.location.hash;
  if (hash.includes('type=recovery') || hash.includes('type=invite')) return true;

  // Check query string   → ?type=recovery  (PKCE flow)
  const search = window.location.search;
  if (search.includes('type=recovery') || search.includes('type=invite')) return true;

  return false;
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

  // ─── needsPasswordSetup: true forces the ForcePasswordSetup screen ───────
  // Initialise to true immediately if the page was opened from a recovery link.
  // This prevents a flash of the login screen before onAuthStateChange fires.
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState<boolean>(
    () => urlContainsRecoveryToken()
  );

  // --- LOG & NOTIFICATION DRAWER STATE ---
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'alerts' | 'activity'>('alerts');
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [logSearch, setLogSearch] = useState('');
  const [logTimeFilter, setLogTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [logRoleFilter, setLogRoleFilter] = useState('all');
  const [logActionFilter, setLogActionFilter] = useState('all');

  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');

  // ─── ROBUST AUTHENTICATION HANDLER ───────────────────────────────────────
  useEffect(() => {
    // Step 1 — resolve any existing session (handles page reload mid-recovery)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    // Step 2 — listen for future auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // PASSWORD_RECOVERY  → user clicked the reset-password email link
      // SIGNED_IN          → fires right after PASSWORD_RECOVERY on the same page load
      //                       We must NOT clear needsPasswordSetup on a plain SIGNED_IN
      //                       if we already know we are in recovery mode.
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordSetup(true);
        setUser(session?.user ?? null);
        setLoading(false);
        return; // don't call fetchProfile — user hasn't set a password yet
      }

      setUser(session?.user ?? null);

      if (session?.user) {
        // If we are already in "setup password" mode (detected from URL or PASSWORD_RECOVERY),
        // do NOT redirect away — just keep the user object updated.
        if (needsPasswordSetup) {
          setLoading(false);
          return;
        }
        fetchProfile(session.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Re-run fetchProfile whenever needsPasswordSetup flips to false ───────
  // This is the "onComplete" path: after the user saves their new password,
  // ForcePasswordSetup calls onComplete() → needsPasswordSetup → false →
  // the effect below fires fetchProfile so the dashboard loads cleanly.
  useEffect(() => {
    if (!needsPasswordSetup && user) {
      fetchProfile(user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPasswordSetup]);

  useEffect(() => {
    if (!user || !profile) return;
    
    const isPrivileged = ['superadmin', 'admin', 'ho'].includes(profile.role);

    const fetchLogs = async () => {
      if (!isPrivileged) return;
      const { data } = await supabase.from('activityLogs').select('*').order('timestamp', { ascending: false }).limit(200);
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

  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    activityLogs.forEach(log => actions.add(log.action));
    return Array.from(actions).sort();
  }, [activityLogs]);

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

      let matchesRole = true;
      if (logRoleFilter !== 'all') {
        if (logRoleFilter === 'admin') {
           matchesRole = ['superadmin', 'admin', 'ho'].includes(log.userRole.toLowerCase());
        } else {
           matchesRole = log.userRole.toLowerCase() === logRoleFilter.toLowerCase();
        }
      }

      const matchesAction = logActionFilter === 'all' || log.action === logActionFilter;

      return matchesTime && matchesSearch && matchesRole && matchesAction;
    });
  }, [activityLogs, logTimeFilter, logSearch, logRoleFilter, logActionFilter]);

  const downloadLogsCSV = () => {
    if (filteredLogs.length === 0) {
      return alert("No logs match the current filters to download.");
    }

    const headers = ["Date", "Time", "Action Status", "User Name", "User Role", "Log Details"];
    const csvRows = filteredLogs.map(log => {
      const d = new Date(log.timestamp);
      const cleanDetails = log.details ? log.details.replace(/"/g, '""') : '';
      
      return [
        d.toLocaleDateString(),
        d.toLocaleTimeString(),
        `"${log.action}"`,
        `"${log.userName}"`,
        `"${log.userRole}"`,
        `"${cleanDetails}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Reliance_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['superadmin', 'admin', 'ho'] },
    { id: 'today', label: 'Today\'s Audits', icon: CalendarDays, roles: ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm', 'ase', 'auditor'] },
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

  const fetchProfile = async (authUser: User) => {
    try {
      let { data } = await supabase.from('users').select('*').eq('uid', authUser.id).maybeSingle();
      
      if (!data && authUser.email) {
        const { data: emailMatch } = await supabase.from('users').select('*').eq('email', authUser.email).maybeSingle();
        
        if (emailMatch) {
          await supabase.from('users').update({ uid: authUser.id }).eq('email', authUser.email);
          data = { ...emailMatch, uid: authUser.id }; 
        }
      }

      if (!data) {
        await supabase.auth.signOut();
        setAuthError(`Account error. No profile found for ${authUser.email}.`);
        setLoading(false);
        return;
      }
      
      if (!data.active) {
        await supabase.auth.signOut();
        setAuthError("Your account has been deactivated. Contact Admin.");
        setLoading(false);
        return;
      }
      
      // If the DB row still has password_setup_required, show the setup screen.
      if (data.active === true && data.password_setup_required === true) {
        setNeedsPasswordSetup(true);
        setLoading(false);
        return;
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

  // ─── LOADING SPINNER ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 bg-slate-200 rounded-3xl mb-4"></div>
          <div className="h-4 w-32 bg-slate-200 rounded mb-2"></div>
          <div className="h-3 w-24 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  // ─── FORCE PASSWORD SETUP ────────────────────────────────────────────────
  // Show as soon as we detect a recovery token in the URL OR after onAuthStateChange
  // fires PASSWORD_RECOVERY — even before a profile is loaded.
  if (needsPasswordSetup && user) {
    return (
      <ForcePasswordSetup
        user={user}
        onComplete={() => {
          setNeedsPasswordSetup(false);
          // fetchProfile is triggered by the useEffect that watches needsPasswordSetup
        }}
      />
    );
  }

  // ─── LOGIN SCREEN ─────────────────────────────────────────────────────────
  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-[#0f172a] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900 via-slate-900 to-black flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
        {/* Abstract shapes for depth */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
          <div className="absolute -top-[20%] -right-[10%] w-[600px] h-[600px] bg-indigo-500/20 rounded-full blur-[120px]"></div>
          <div className="absolute -bottom-[20%] -left-[10%] w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[100px]"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-[420px] w-full bg-slate-900/60 backdrop-blur-2xl p-8 sm:p-10 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.4)] border border-slate-700/50 relative z-10"
        >
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/10 p-2.5 border border-white/10 backdrop-blur-sm">
              <img src={logo} alt="Logo" className="w-full h-full object-contain" />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-white">Reliance Audit</h2>
            <p className="text-slate-400 text-sm mt-2 font-medium">Enterprise Management Portal</p>
          </div>
          
          {authError && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 bg-rose-500/10 text-rose-400 text-sm font-bold rounded-2xl text-center border border-rose-500/20">
              {authError}
            </motion.div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-2">Email Address</label>
              <input type="email" required className="w-full mt-1.5 px-5 py-4 bg-slate-800/50 border border-slate-700 text-white rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm placeholder:text-slate-500" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-2">Password</label>
              <input type="password" required className="w-full mt-1.5 px-5 py-4 bg-slate-800/50 border border-slate-700 text-white rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm placeholder:text-slate-500" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button type="submit" disabled={isLoggingIn} className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/30 active:scale-[0.98] disabled:opacity-70 flex justify-center items-center text-sm sm:text-base">
              {isLoggingIn ? <Loader2 size={20} className="animate-spin text-white/70" /> : 'Secure Sign In'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const renderModule = () => {
    switch (activeModuleState) {
      case 'dashboard': return <DashboardModule />;
      case 'today': return <TodayAssignmentsModule />; 
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
      <div className="min-h-screen bg-slate-50 flex flex-col w-full overflow-x-hidden font-sans text-slate-900">
        
        {/* --- REDESIGNED DESKTOP SIDEBAR WITH CUSTOM LOGO --- */}
        <aside className="hidden lg:flex flex-col w-[280px] bg-white border-r border-slate-200 fixed h-full z-40 shadow-sm">
          <div className="p-8 pb-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-slate-100 p-1.5 bg-slate-50 shadow-sm">
              <img src={logo} alt="Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="font-black text-xl tracking-tight leading-none text-slate-900">Reliance</h1>
              <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Audit System</span>
            </div>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar mt-2">
            <div className="px-4 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Main Menu</div>
            {allowedNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeModuleState === item.id;
              return (
                <button key={item.id} onClick={() => setActiveModule(item.id)} className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-[14px] font-semibold text-sm transition-all group relative overflow-hidden",
                  isActive ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100/50" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
                )}>
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} className={cn("z-10 transition-colors", isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600")} />
                  <span className="z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-6 border-t border-slate-100 bg-slate-50/50">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-3">
              <p className="font-bold text-sm text-slate-900 truncate">{profile.name}</p>
              <p className={cn("text-[9px] font-black uppercase tracking-wider mt-1.5 w-fit px-2 py-0.5 rounded-md", profile.role === 'superadmin' ? "bg-fuchsia-100 text-fuchsia-700" : "bg-indigo-100 text-indigo-700")}>
                {profile.role.replace('_', ' ')}
              </p>
            </div>
            <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 font-bold text-sm rounded-xl transition-all shadow-sm active:scale-95">
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </aside>

        {/* MOBILE HEADER WITH CUSTOM LOGO */}
        <div className="lg:hidden fixed top-0 w-full bg-white/90 backdrop-blur-xl border-b border-slate-200 z-40 px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-slate-100 p-1 bg-slate-50 shadow-sm">
               <img src={logo} alt="Logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-black text-lg tracking-tight">Reliance<span className="text-indigo-600">Audit</span></span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setIsActivityOpen(true)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl relative transition-all">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"><Menu size={20} /></button>
          </div>
        </div>

        {/* MOBILE SLIDE-OUT MENU WITH CUSTOM LOGO */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
                onClick={() => setIsMobileMenuOpen(false)} 
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 lg:hidden" 
              />
              <motion.div 
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} 
                transition={{ type: 'spring', damping: 25, stiffness: 200 }} 
                className="fixed top-0 left-0 w-[85%] max-w-[340px] h-full bg-white shadow-2xl z-50 flex flex-col lg:hidden border-r border-slate-200"
              >
                <div className="p-6 flex items-center justify-between border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-slate-100 p-1 bg-slate-50">
                       <img src={logo} alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-black text-lg tracking-tight">RelianceAudit</span>
                  </div>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"><X size={20} /></button>
                </div>
                
                <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
                  <div className="px-4 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Main Menu</div>
                  {allowedNavItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeModuleState === item.id;
                    return (
                      <button 
                        key={item.id} 
                        onClick={() => { setActiveModule(item.id); setIsMobileMenuOpen(false); }} 
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-4 rounded-[14px] font-semibold text-sm transition-all",
                          isActive ? "bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
                        )}
                      >
                        <Icon size={18} className={isActive ? "text-indigo-600" : "text-slate-400"} />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm mb-4">
                    <p className="font-bold text-sm text-slate-900 truncate">{profile.name}</p>
                    <p className={cn("text-[9px] font-black uppercase tracking-wider mt-1 w-fit px-2 py-0.5 rounded-md", profile.role === 'superadmin' ? "bg-fuchsia-100 text-fuchsia-700" : "bg-indigo-100 text-indigo-600")}>{profile.role}</p>
                  </div>
                  <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-slate-200 text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 font-bold text-sm rounded-xl shadow-sm active:scale-95 transition-all"><LogOut size={16} /> Sign Out</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 lg:pl-[280px] flex flex-col min-h-screen pt-16 lg:pt-0 w-full">
          
          <header className="hidden lg:flex bg-white/80 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-30 px-8 py-4 items-center justify-between w-full shadow-sm">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900 capitalize">{activeModuleState.replace('_', ' ')}</h2>
              <p className="text-[11px] font-semibold text-slate-500 mt-0.5 uppercase tracking-widest">Enterprise Portal</p>
            </div>
            <div className="flex items-center gap-4">
              
              <button onClick={() => setIsActivityOpen(true)} className="relative p-3 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-[14px] transition-all shadow-sm" title="Notifications & Activity">
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              <div className="flex items-center gap-3 bg-white pl-2.5 pr-4 py-2 rounded-2xl border border-slate-200 shadow-sm">
                <div className={cn("w-9 h-9 rounded-[10px] flex items-center justify-center font-black text-sm shrink-0", profile.role === 'superadmin' ? "bg-fuchsia-100 text-fuchsia-700" : "bg-indigo-100 text-indigo-700")}>{profile.name.charAt(0)}</div>
                <div className="hidden sm:block">
                  <p className="text-sm font-bold text-slate-900 leading-none truncate max-w-[150px]">{profile.name}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{profile.role.replace('_', ' ')}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0">
            <div className="lg:hidden mb-6 mt-2">
              <h2 className="text-2xl font-black tracking-tight text-slate-900 capitalize">{activeModuleState.replace('_', ' ')}</h2>
              <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest">Enterprise Portal</p>
            </div>
            
            {renderModule()}
          </div>
        </main>
      </div>

      {/* --- REDESIGNED NOTIFICATIONS & ACTIVITY DRAWER --- */}
      <AnimatePresence>
        {isActivityOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsActivityOpen(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50" />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }} 
              className="fixed top-0 right-0 w-full sm:w-[480px] max-w-[100vw] h-full bg-white shadow-2xl z-50 border-l border-slate-200 flex flex-col"
            >
              <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 text-white rounded-[14px] flex items-center justify-center shadow-md shadow-indigo-600/20 shrink-0"><Bell size={20} /></div>
                  <div><h3 className="font-bold text-base sm:text-lg text-slate-900">Notifications</h3><p className="text-[10px] sm:text-xs font-medium text-slate-500">Alerts and System Activity</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setIsActivityOpen(false)} className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 rounded-xl transition-colors"><X size={20} /></button>
                </div>
              </div>

              {/* TABS (DYNAMIC) */}
              <div className="flex px-4 pt-4 border-b border-slate-200 shrink-0 bg-slate-50/50">
                <button 
                  onClick={() => setDrawerTab('alerts')} 
                  className={cn(
                    "pb-3 text-sm font-bold border-b-2 transition-all relative flex items-center justify-center gap-2", 
                    drawerTab === 'alerts' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700",
                    isAdminOrHO ? "flex-1" : "w-full"
                  )}
                >
                  {isAdminOrHO ? 'My Alerts' : 'My Activity & Alerts'}
                  {unreadCount > 0 && <span className="px-1.5 py-0.5 bg-rose-500 text-white rounded-md text-[10px]">{unreadCount}</span>}
                </button>
                
                {isAdminOrHO && (
                  <button 
                    onClick={() => setDrawerTab('activity')} 
                    className={cn("flex-1 pb-3 text-sm font-bold border-b-2 transition-all", drawerTab === 'activity' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700")}
                  >
                    Global Activity
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-white flex flex-col">
                {drawerTab === 'alerts' ? (
                  <div className="p-4 space-y-3">
                    {unreadCount > 0 && (
                      <div className="flex justify-end mb-2">
                        <button onClick={markAllAsRead} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"><CheckCheck size={14}/> Mark all read</button>
                      </div>
                    )}
                    {notifications.length === 0 ? (
                      <div className="text-center py-16 text-slate-400 flex flex-col items-center"><Bell size={32} className="mb-3 opacity-20" /><p className="font-bold">All caught up!</p><p className="text-xs mt-1">You have no personal alerts.</p></div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} onClick={() => markAsRead(n.id)} className={cn("p-4 rounded-[1rem] border transition-all cursor-pointer", n.is_read ? "bg-slate-50 border-slate-200 opacity-70" : "bg-indigo-50/50 border-indigo-200 shadow-sm")}>
                          <div className="flex justify-between items-start mb-1">
                            <h4 className={cn("font-bold text-sm", n.is_read ? "text-slate-700" : "text-indigo-900")}>{n.title}</h4>
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-indigo-600 mt-1 shrink-0 shadow-sm"></span>}
                          </div>
                          <p className={cn("text-xs leading-relaxed mt-1.5", n.is_read ? "text-slate-500" : "text-indigo-800")}>{n.message}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-3">{new Date(n.created_at).toLocaleString()}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    {/* --- ADVANCED FILTER PANEL --- */}
                    <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/80 shrink-0">
                      
                      <div className="flex justify-between items-center mb-1">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Filter Logs</h4>
                        <button onClick={downloadLogsCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold rounded-[10px] hover:bg-emerald-700 transition-colors shadow-sm active:scale-95">
                          <Download size={14}/> Export CSV
                        </button>
                      </div>

                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input type="text" placeholder="Search distributors, users, details..." className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <select className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer text-slate-700 shadow-sm" value={logTimeFilter} onChange={(e) => setLogTimeFilter(e.target.value as any)}>
                          <option value="all">All Time</option>
                          <option value="today">Today</option>
                          <option value="week">This Week</option>
                          <option value="month">This Month</option>
                        </select>

                        <select className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer text-slate-700 shadow-sm" value={logRoleFilter} onChange={(e) => setLogRoleFilter(e.target.value)}>
                          <option value="all">All Roles</option>
                          <option value="ase">ASE</option>
                          <option value="auditor">Auditor</option>
                          <option value="admin">Admin / Head Office</option>
                        </select>
                      </div>

                      <select className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer text-slate-700 shadow-sm" value={logActionFilter} onChange={(e) => setLogActionFilter(e.target.value)}>
                         <option value="all">All Statuses / Actions</option>
                         {uniqueActions.map(action => <option key={action} value={action}>{action}</option>)}
                      </select>

                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/30">
                      {filteredLogs.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 flex flex-col items-center"><Bell size={32} className="mb-3 opacity-20" /><p className="font-bold">No activity matches your filters.</p></div>
                      ) : (
                        filteredLogs.map(log => {
                          const style = getLogStyle(log.action);
                          return (
                            <div key={log.id} className={cn("p-4 rounded-[1rem] border transition-all shadow-sm", style.bg, style.border)}>
                              <div className="flex items-start justify-between mb-2 gap-3 sm:gap-4">
                                <div className="min-w-0 flex-1">
                                  <p className={cn("text-xs sm:text-sm leading-snug break-words", style.text)}>
                                    <span className="font-black block text-sm mb-0.5 tracking-tight">{log.action}</span>
                                    <span className="font-semibold text-slate-600">{log.userName}</span>
                                  </p>
                                  {log.details && <p className={cn("text-[10px] sm:text-xs mt-2 font-medium opacity-80 break-words leading-relaxed", style.text)}>"{log.details}"</p>}
                                </div>
                                {profile.role === 'superadmin' && (
                                  <button onClick={() => deleteActivityLog(log.id)} className="text-slate-400 hover:text-rose-500 bg-white/50 hover:bg-rose-100 p-1.5 rounded-lg transition-colors shrink-0 border border-transparent hover:border-rose-200"><Trash2 size={14} /></button>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-3 text-[9px] font-bold uppercase tracking-wider">
                                <span className={cn("px-2 py-0.5 rounded-md", style.tag)}>{log.userRole.replace('_', ' ')}</span>
                                <span className={cn("opacity-70 font-medium", style.text)}>{new Date(log.timestamp).toLocaleString()}</span>
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