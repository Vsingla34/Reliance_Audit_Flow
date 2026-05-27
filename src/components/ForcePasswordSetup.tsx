import React, { useState } from 'react';
import { supabase } from '../supabase';
import { ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';

export function ForcePasswordSetup({ user, onComplete }: { user: any, onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      return setError("Password must be at least 6 characters.");
    }
    if (password !== confirmPassword) {
      return setError("Passwords do not match.");
    }

    setLoading(true);
    setError('');

    try {
      // 1. Update the password in Supabase Auth.
      //    This works because the recovery link already established a valid session.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // 2. Clear the setup flag in the users table.
      const { error: dbError } = await supabase
        .from('users')
        .update({ password_setup_required: false })
        .eq('uid', user.id);
      if (dbError) throw dbError;

      // 3. Show success, then let App.tsx take over via onComplete.
      setSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 1500);

    } catch (err: any) {
      // Common case: recovery token expired.
      if (
        err.message?.toLowerCase().includes('expired') ||
        err.message?.toLowerCase().includes('invalid') ||
        err.message?.toLowerCase().includes('session')
      ) {
        setError(
          "This password setup link has expired or is invalid. Please contact your Admin to resend the invitation email."
        );
      } else {
        setError(err.message || "Failed to update password. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl text-center border border-zinc-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-2xl font-bold mb-2 tracking-tight">Password Created!</h2>
          <p className="text-zinc-500 font-medium">Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-zinc-100">

        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <ShieldAlert className="text-white" size={32} />
        </div>

        <h2 className="text-2xl font-bold text-center mb-2 tracking-tight">Create Your Password</h2>
        <p className="text-center text-zinc-500 mb-8 text-sm">
          Welcome! Set a secure password to activate your account.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-bold rounded-xl text-center border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSetup} className="space-y-5">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">
              New Password
            </label>
            <input
              type="password"
              required
              placeholder="Min. 6 characters"
              className="w-full mt-1.5 px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-lg font-black tracking-widest"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">
              Confirm Password
            </label>
            <input
              type="password"
              required
              placeholder="Re-enter your password"
              className="w-full mt-1.5 px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-lg font-black tracking-widest"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-xl shadow-black/10 flex justify-center items-center mt-2"
          >
            {loading
              ? <Loader2 className="animate-spin" size={20} />
              : 'Save Password & Enter Portal'
            }
          </button>
        </form>
      </div>
    </div>
  );
}