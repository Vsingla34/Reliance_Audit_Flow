import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. Paste your exact URL inside the quotes below
const supabaseUrl = "https://qxtdyegsbqvcklbjvvxw.supabase.co";

// 2. Paste your exact Anon Key inside the quotes below
const supabaseAnonKey = "sb_publishable_ADs82Sql4KPCeJfREHAiFg_O_RbYsPg";

// Initialize the client directly
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleSupabaseError(error: unknown, operationType: OperationType, table: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    table
  };
  console.error('Supabase Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}