import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { ensureProfile, PLAN_COLUMNS, type PlanRow } from '../plans.js';
import { clientFor, loadRouter } from '../routers.js';
import type { JobOutcome, RouterJob } from '../types.js';

/** payload.plan_id: sync one plan; no plan_id: sync every active plan. */
export async function runSyncProfiles(supabase: SupabaseClient, config: AgentConfig, job: RouterJob): Promise<JobOutcome> {
  if (!job.router_id) return { ok: false, result: { error: 'This router has been removed.' } };
  const router = await loadRouter(supabase, job.router_id);
  if (!router) return { ok: false, result: { error: 'This router has been removed.' } };

  const planId = typeof job.payload['plan_id'] === 'string' ? job.payload['plan_id'] : null;
  let query = supabase.from('plans').select(PLAN_COLUMNS);
  query = planId ? query.eq('id', planId) : query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load plans: ${error.message}`);

  const client = clientFor(router, config);
  const results: Record<string, string> = {};
  for (const plan of (data ?? []) as PlanRow[]) {
    results[plan.router_profile_name] = await ensureProfile(client, plan);
  }
  log.info('Profiles synced', { router: router.name, results });
  return { ok: true, result: { profiles: results } };
}
