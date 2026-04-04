import React, { useState } from 'react';
import { supabase } from '../supabase';
import { ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';

// Notice we added the { user, onComplete } props so it works with App.tsx!
export function ForcePasswordSetup({ user, onComplete }: { user: any, onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    
    setLoading(true); 
    setError('');

    try {
      // 1. Save the new password to their Auth account
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // 2. Turn off the setup flag in the database so they don't see this again
      const { error: dbError } = await supabase.from('users').update({ password_setup_required: false }).eq('uid', user.id);
      if (dbError) throw dbError;

      setSuccess(true);
      setTimeout(() => { onComplete(); }, 1500);
      
    } catch (err: any) {
      setError(err.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl text-center border border-zinc-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-2xl font-bold mb-2 tracking-tight">Password Updated!</h2>
          <p className="text-zinc-500 font-medium">Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-zinc-100">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <ShieldAlert className="text-white" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-center mb-2 tracking-tight">Set Your Password</h2>
        <p className="text-center text-zinc-500 mb-8 text-sm">Welcome! Please set a secure personal password to activate your account.</p>
        
        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-bold rounded-xl text-center border border-red-100">{error}</div>}
        
        <form onSubmit={handleSetup}>
          <div className="mb-8">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 ml-1">New Password</label>
            <input 
              type="password" 
              required 
              placeholder="••••••••"
              className="w-full mt-1 px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all text-lg font-black tracking-widest" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
            />
          </div>
          <button type="submit" disabled={loading} className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-xl shadow-black/10 flex justify-center items-center">
            {loading ? <Loader2 className="animate-spin" size={20} /> : 'Save Password & Enter Portal'}
          </button>
        </form>
      </div>
    </div>
  );
}