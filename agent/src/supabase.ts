import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from './config.js';

/** Service-role client. Bypasses RLS, so it must only ever run on the agent computer. */
export function createServiceClient(config: AgentConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
