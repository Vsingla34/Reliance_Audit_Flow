import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { ShieldCheck, Loader2, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function ForcePasswordSetup() {
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Watch the URL for the secret Supabase invite/recovery tags
    const hash = window.location.hash;
    if (hash && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
      setIsOpen(true);
    }
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);
    try {
      // This securely updates the currently logged-in user's password
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) throw error;
      
      alert("Password secured! You can use this to log in normally next time.");
      setIsOpen(false);
      
      // Clean up the URL so the modal doesn't pop up again if they refresh the page
      window.history.replaceState(null, '', window.location.pathname);
      
    } catch (error: any) {
      console.error("Error setting password:", error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          {/* A solid backdrop so they can't click away without setting a password */}
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            className="absolute inset-0 bg-zinc-900/80 backdrop-blur-md" 
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.9, y: 20 }} 
            className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8"
          >
            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-emerald-100">
              <ShieldCheck className="text-emerald-600" size={28} />
            </div>
            
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold tracking-tight mb-2">Secure Your Account</h3>
              <p className="text-sm text-zinc-500">
                Welcome to the Audit Portal! Your email has been verified. Please set a permanent password for future logins.
              </p>
            </div>

            <form onSubmit={handleSetPassword} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                  <input 
                    required 
                    type="password" 
                    minLength={6}
                    className="w-full pl-12 pr-4 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-black transition-all font-medium" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder="Minimum 6 characters..." 
                    disabled={isLoading}
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isLoading || password.length < 6} 
                className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 text-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader2 className="animate-spin" size={20} /> Saving...</>
                ) : (
                  'Save Password & Continue'
                )}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}