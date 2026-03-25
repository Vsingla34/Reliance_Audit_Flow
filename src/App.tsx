

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile, UserRole } from './types';
import { 
  LayoutDashboard, 
  Users, 
  Store, 
  Calendar, 
  ClipboardCheck, 
  BarChart3, 
  LogOut, 
  Menu, 
  ChevronRight,
  User as UserIcon,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Modules ---
import { DashboardModule } from './modules/Dashboard';
import { UsersModule } from './modules/Users';
import { DistributorsModule } from './modules/Distributors';
import { SchedulerModule } from './modules/Scheduler';
import { ExecutionModule } from './modules/Execution';
import { ReportsModule } from './modules/Reports';

// --- Components ---
import { ForcePasswordSetup } from './components/ForcePasswordSetup';

// --- Utility ---
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Context ---
interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// --- Components ---
const SidebarItem = ({ 
  icon: Icon, 
  label, 
  active, 
  onClick,
  collapsed 
}: { 
  icon: any, 
  label: string, 
  active: boolean, 
  onClick: () => void,
  collapsed: boolean
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 group relative",
      active 
        ? "bg-black text-white shadow-lg shadow-black/10" 
        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    )}
  >
    <Icon size={20} className={cn("shrink-0", active ? "text-white" : "text-zinc-400 group-hover:text-zinc-900")} />
    {!collapsed && <span className="font-medium text-sm truncate">{label}</span>}
    {collapsed && (
      <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </div>
    )}
  </button>
);

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<any>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.error.message);
        if (parsed.error) {
          setHasError(true);
          setErrorInfo(parsed);
        }
      } catch (e) {
        // Not a structured error
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-zinc-200">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6">
            <AlertCircle className="text-red-600" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 mb-2">Something went wrong</h2>
          <p className="text-zinc-500 mb-6">
            An error occurred while performing a database operation. This might be due to insufficient permissions.
          </p>
          <div className="bg-zinc-50 rounded-xl p-4 mb-6 font-mono text-xs overflow-auto max-h-40">
            {JSON.stringify(errorInfo, null, 2)}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// --- Main App ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Login Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    // Check active session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    // Listen for auth changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSession = async (session: any) => {
    if (session?.user) {
      setUser(session.user);
      try {
        // Fetch user profile from Supabase 'users' table
        const { data: currentProfile, error } = await supabase
          .from('users')
          .select('*')
          .eq('uid', session.user.id)
          .single();

        if (currentProfile) {
          setProfile(currentProfile as UserProfile);
        } else {
          // Fallback if profile doesn't exist yet in the public table
          const newProfile: UserProfile = {
            uid: session.user.id,
            name: session.user.email?.split('@')[0] || 'New User',
            email: session.user.email || '',
            role: 'ase', // Default role
            active: true
          };
          await supabase.from('users').insert([newProfile]);
          setProfile(newProfile);
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
      }
    } else {
      setUser(null);
      setProfile(null);
    }
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError(error.message);
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-12 h-12 bg-black rounded-2xl"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
        {/* We mount it here too just in case they click the link and aren't logged in yet */}
        <ForcePasswordSetup />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[2.5rem] p-12 shadow-2xl border border-zinc-200 text-center"
        >
          <div className="w-20 h-20 bg-zinc-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <ShieldCheck className="text-black" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-4 tracking-tight">Audit Portal</h1>
          <p className="text-zinc-500 mb-8 leading-relaxed">
            Please sign in with your corporate credentials to continue.
          </p>

          <form onSubmit={handleLogin} className="space-y-4 text-left">
            {authError && (
              <div className="p-3 bg-red-50 text-red-600 text-sm font-bold rounded-xl text-center">
                {authError}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Email Address</label>
              <input 
                required
                type="email"
                className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Password</label>
              <input 
                required
                type="password"
                className="w-full px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="pt-4">
              <button 
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50"
              >
                {isLoggingIn ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'ase', 'asm', 'sm', 'dm', 'auditor'] },
    { id: 'users', label: 'User Management', icon: Users, roles: ['admin'] },
    { id: 'distributors', label: 'Distributors', icon: Store, roles: ['admin', 'ase', 'asm', 'sm', 'dm'] },
    { id: 'scheduler', label: 'Audit Scheduler', icon: Calendar, roles: ['admin', 'ase', 'asm', 'auditor'] },
    { id: 'execution', label: 'Execution', icon: ClipboardCheck, roles: ['admin', 'auditor', 'ase'] },
    { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'sm', 'dm'] },
  ];

  const filteredNavItems = navItems.filter(item => profile && item.roles.includes(profile.role));

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      <ForcePasswordSetup />
      <ErrorBoundary>
        <div className="flex h-screen bg-zinc-50 font-sans text-zinc-900 overflow-hidden">
          {/* Sidebar */}
          <motion.aside 
            animate={{ width: sidebarCollapsed ? 80 : 280 }}
            className="bg-white border-r border-zinc-200 flex flex-col shrink-0 relative z-40"
          >
            <div className="p-6 flex items-center justify-between">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                    <ShieldCheck className="text-white" size={18} />
                  </div>
                  <span className="font-bold text-lg tracking-tight">AuditPro</span>
                </div>
              )}
              <button 
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-zinc-900 transition-colors"
              >
                {sidebarCollapsed ? <ChevronRight size={20} /> : <Menu size={20} />}
              </button>
            </div>

            <nav className="flex-1 px-4 space-y-1 mt-4">
              {filteredNavItems.map((item) => (
                <SidebarItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={activeTab === item.id}
                  onClick={() => setActiveTab(item.id)}
                  collapsed={sidebarCollapsed}
                />
              ))}
            </nav>

            <div className="p-4 mt-auto border-t border-zinc-100">
              <div className={cn("flex items-center gap-3 p-3 rounded-2xl bg-zinc-50", sidebarCollapsed && "justify-center")}>
                <div className="w-10 h-10 bg-zinc-200 rounded-xl flex items-center justify-center shrink-0">
                  <UserIcon size={20} className="text-zinc-500" />
                </div>
                {!sidebarCollapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{profile?.name}</p>
                    <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">{profile?.role}</p>
                  </div>
                )}
                {!sidebarCollapsed && (
                  <button 
                    onClick={logout}
                    className="p-2 text-zinc-400 hover:text-red-600 transition-colors"
                  >
                    <LogOut size={18} />
                  </button>
                )}
              </div>
              {sidebarCollapsed && (
                <button 
                  onClick={logout}
                  className="w-full mt-2 p-3 text-zinc-400 hover:text-red-600 flex justify-center"
                >
                  <LogOut size={20} />
                </button>
              )}
            </div>
          </motion.aside>

          {/* Main Content */}
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0">
              <h2 className="text-xl font-bold tracking-tight capitalize">
                {navItems.find(i => i.id === activeTab)?.label}
              </h2>
              <div className="flex items-center gap-4">
                <div className="text-xs font-medium px-3 py-1 bg-zinc-100 rounded-full text-zinc-500">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="max-w-7xl mx-auto"
                >
                  {activeTab === 'dashboard' && <DashboardModule />}
                  {activeTab === 'users' && <UsersModule />}
                  {activeTab === 'distributors' && <DistributorsModule />}
                  {activeTab === 'scheduler' && <SchedulerModule />}
                  {activeTab === 'execution' && <ExecutionModule />}
                  {activeTab === 'reports' && <ReportsModule />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </ErrorBoundary>
    </AuthContext.Provider>
  );
}