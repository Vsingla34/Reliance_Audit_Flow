import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Lock } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { motion } from 'motion/react';
import logo from '../public/favicon.png';

interface ForcePasswordSetupProps {
  user: User | null;
  onComplete: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function ForcePasswordSetup({ user, onComplete }: ForcePasswordSetupProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [resolvedUser, setResolvedUser] = useState<User | null>(user);
  const [waitingForSession, setWaitingForSession] = useState(!user);

  useEffect(() => {
    if (user) {
      setResolvedUser(user);
      setWaitingForSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setResolvedUser(session.user);
        setWaitingForSession(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setResolvedUser(session.user);
        setWaitingForSession(false);
      }
    });

    const timeout = setTimeout(() => {
      if (!resolvedUser) {
        setWaitingForSession(false);
        setError(
          'This password setup link has expired or is invalid. ' +
          'Please contact your Admin to resend the invitation email.'
        );
      }
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [user]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match.');
    }
    if (!resolvedUser) {
      return setError('Session not found. Please use the link from your email again.');
    }

    setLoading(true);
    setError('');

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { error: dbError } = await supabase
        .from('users')
        .update({ password_setup_required: false })
        .eq('uid', resolvedUser.id);
      if (dbError) throw dbError;

      setSuccess(true);
      setTimeout(() => onComplete(), 1500);
    } catch (err: any) {
      if (
        err.message?.toLowerCase().includes('expired') ||
        err.message?.toLowerCase().includes('invalid') ||
        err.message?.toLowerCase().includes('session') ||
        err.message?.toLowerCase().includes('token')
      ) {
        setError(
          'This password setup link has expired or is invalid. ' +
          'Please contact your Admin to resend the invitation email.'
        );
      } else {
        setError(err.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[#070b14] bg-dark-grid flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[25%] -right-[10%] w-[650px] h-[650px] bg-indigo-600/15 rounded-full blur-[130px]" />
        <div className="absolute -bottom-[25%] -left-[10%] w-[550px] h-[550px] bg-cyan-500/10 rounded-full blur-[120px]" />
      </div>
      {children}
    </div>
  );

  if (waitingForSession) {
    return (
      <Wrapper>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="max-w-md w-full bg-slate-900/75 backdrop-blur-2xl p-8 sm:p-10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] border border-slate-800/80 text-center relative z-10"
        >
          <Loader2 size={38} className="animate-spin text-indigo-400 mx-auto mb-4" />
          <h2 className="text-xl font-extrabold text-white mb-2 tracking-tight">Verifying Security Link…</h2>
          <p className="text-slate-400 text-sm font-medium">
            Please wait while we validate your invitation credentials.
          </p>
        </motion.div>
      </Wrapper>
    );
  }

  if (success) {
    return (
      <Wrapper>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="max-w-md w-full bg-slate-900/75 backdrop-blur-2xl p-8 sm:p-10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] border border-emerald-500/20 text-center relative z-10"
        >
          <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight">Password Configured</h2>
          <p className="text-slate-400 text-sm font-medium">Redirecting to your enterprise workspace…</p>
        </motion.div>
      </Wrapper>
    );
  }

  if (error && !resolvedUser) {
    return (
      <Wrapper>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="max-w-md w-full bg-slate-900/75 backdrop-blur-2xl p-8 sm:p-10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] border border-rose-500/20 relative z-10"
        >
          <div className="w-14 h-14 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="text-rose-400" size={28} />
          </div>
          <h2 className="text-2xl font-extrabold text-white text-center mb-2 tracking-tight">Link Expired</h2>
          <p className="text-center text-slate-400 text-sm mb-6 leading-relaxed">{error}</p>
          <button
            onClick={() => window.location.replace('/')}
            className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25"
          >
            Return to Sign In
          </button>
        </motion.div>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="max-w-[440px] w-full bg-slate-900/75 backdrop-blur-2xl p-8 sm:p-10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] border border-slate-800/80 relative z-10"
      >
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-indigo-500/15 border border-indigo-500/30 rounded-2xl flex items-center justify-center shadow-lg">
            <ShieldCheck className="text-indigo-400" size={28} />
          </div>
        </div>

        <h2 className="text-2xl font-extrabold text-white text-center mb-2 tracking-tight">Activate Your Account</h2>
        <p className="text-center text-slate-400 mb-8 text-sm leading-relaxed">
          Configure a strong password to secure your enterprise audit credentials.
        </p>

        {error && (
          <div className="mb-6 p-3.5 bg-rose-500/10 text-rose-400 text-xs font-bold rounded-xl border border-rose-500/20 flex items-start gap-2.5">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSetup} className="space-y-5">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">
              New Password
            </label>
            <div className="relative mt-1.5">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPw ? 'text' : 'password'}
                required
                placeholder="Minimum 6 characters"
                className="w-full pl-11 pr-12 py-3.5 bg-slate-950/70 border border-slate-800 text-white rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm placeholder:text-slate-600"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">
              Confirm Password
            </label>
            <div className="relative mt-1.5">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPw ? 'text' : 'password'}
                required
                placeholder="Re-enter your password"
                className="w-full pl-11 pr-4 py-3.5 bg-slate-950/70 border border-slate-800 text-white rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm placeholder:text-slate-600"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !resolvedUser}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-bold transition-all active:scale-[0.99] shadow-lg shadow-indigo-600/25 flex justify-center items-center gap-2 mt-2 disabled:opacity-60 text-sm"
          >
            {loading
              ? <Loader2 className="animate-spin" size={18} />
              : 'Save Password & Enter Portal'
            }
          </button>
        </form>
      </motion.div>
    </Wrapper>
  );
}
