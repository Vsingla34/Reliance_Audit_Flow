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

// --- PERSONAL NOTIFICATIONS SENDER ---
export const notifyLinkedUsers = async (distributorId: string, title: string, message: string) => {
  try {
    // 1. Fetch the distributor to get their linked users
    const { data: dist } = await supabase.from('distributors').select('*').eq('id', distributorId).single();
    if (!dist) return;

    // 2. Collect all linked user IDs (Using a Set to prevent duplicate notifications to the same person)
    const linkedIds = new Set<string>();
    ['hoIds', 'dmIds', 'smIds', 'asmIds', 'aseIds'].forEach(role => {
      if (dist[role] && Array.isArray(dist[role])) {
        dist[role].forEach((id: string) => linkedIds.add(id));
      }
    });

    // 3. Prepare the notifications payload
    const notifications = Array.from(linkedIds).map(userId => ({
      recipient_id: userId,
      title,
      message,
      is_read: false
    }));

    // 4. Send them to the database so the Bell Icon updates!
    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications);
    }
  } catch (error) {
    console.error("Error sending notifications:", error);
  }
};