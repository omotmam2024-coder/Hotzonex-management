import type { SupabaseClient } from '@supabase/supabase-js';
import type { RouterOSClient } from './routeros.js';

export interface PlanRow {
  id: string;
  name: string;
  price_ssp: number;
  uptime_seconds: number;
  validity_seconds: number | null;
  rate_limit: string | null;
  data_limit_mb: number | null;
  shared_users: number;
  router_profile_name: string;
  is_active: boolean;
}

export const PLAN_COLUMNS =
  'id, name, price_ssp, uptime_seconds, validity_seconds, rate_limit, data_limit_mb, shared_users, router_profile_name, is_active';

export async function loadPlan(supabase: SupabaseClient, id: string): Promise<PlanRow | null> {
  const { data, error } = await supabase.from('plans').select(PLAN_COLUMNS).eq('id', id).maybeSingle<PlanRow>();
  if (error) throw new Error(`Could not load plan: ${error.message}`);
  return data;
}

interface RouterProfile {
  '.id': string;
  name: string;
  'rate-limit'?: string;
  'shared-users'?: string;
}

/**
 * Creates or updates /ip/hotspot/user/profile for a plan. Safe to repeat.
 * Returns "created", "updated" or "unchanged".
 */
export async function ensureProfile(client: RouterOSClient, plan: PlanRow): Promise<'created' | 'updated' | 'unchanged'> {
  const wanted = {
    'rate-limit': plan.rate_limit ?? '',
    'shared-users': String(plan.shared_users),
  };
  const existing = await client.get<RouterProfile[]>('/ip/hotspot/user/profile', { name: plan.router_profile_name });
  const current = existing[0];
  if (!current) {
    await client.put('/ip/hotspot/user/profile', { name: plan.router_profile_name, ...wanted });
    return 'created';
  }
  if ((current['rate-limit'] ?? '') === wanted['rate-limit'] && (current['shared-users'] ?? '') === wanted['shared-users']) {
    return 'unchanged';
  }
  await client.patch(`/ip/hotspot/user/profile/${encodeURIComponent(current['.id'])}`, wanted);
  return 'updated';
}
