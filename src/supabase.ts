import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- GLOBAL ACTIVITY LOGGER ---
export const logActivity = async (user: any, profile: any, action: string, details?: string) => {
  if (!user || !profile) return;
  
  try {
    await supabase.from('activityLogs').insert([{
      id: Math.random().toString(36).substring(7),
      userId: user.id,
      userName: profile.name,
      userRole: profile.role,
      action: action,
      details: details || '',
      timestamp: new Date().toISOString()
    }]);
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
};