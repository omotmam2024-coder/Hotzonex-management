import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from './config.js';
import { log } from './logger.js';
import { bareIp, clientFor, readSystemResource, ROUTER_COLUMNS } from './routers.js';
import type { RouterRow } from './types.js';

/** Checks every tested router once and records online/offline, version and last seen time. */
export async function checkRouterStatus(supabase: SupabaseClient, config: AgentConfig): Promise<void> {
  const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).neq('status', 'pending');
  if (error) {
    log.error('Could not load routers for the status check', { error: error.message });
    return;
  }

  await Promise.allSettled(
    ((data ?? []) as RouterRow[]).map(async (router) => {
      try {
        const resource = await readSystemResource(clientFor(router, config));
        if (router.status !== 'online') log.info('Router is back online', { router: router.name });
        await supabase
          .from('routers')
          .update({
            status: 'online',
            last_seen_at: new Date().toISOString(),
            model: resource['board-name'] ?? router.model,
            ros_version: resource.version ?? router.ros_version,
            last_error: null,
          })
          .eq('id', router.id);
        await resumeUnfinishedPushes(supabase, router);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (router.status !== 'offline' || router.last_error !== message) {
          log.warn('Router is offline', { router: router.name, ip: bareIp(router.ip_address), error: message });
          await supabase.from('routers').update({ status: 'offline', last_error: message }).eq('id', router.id);
        }
      }
    }),
  );
}

const RETRY_FAILED_PUSH_AFTER_MS = 5 * 60_000;

/**
 * Re-queues pushes that stopped part-way (for example the router went offline),
 * at most once every 5 minutes per batch. The push job itself skips vouchers already on the router.
 */
async function resumeUnfinishedPushes(supabase: SupabaseClient, router: RouterRow): Promise<void> {
  const { data: pending, error } = await supabase
    .from('vouchers')
    .select('batch_id')
    .eq('router_id', router.id)
    .eq('on_router', false)
    .neq('status', 'disabled')
    .limit(1000);
  if (error || !pending?.length) return;

  const batchIds = [...new Set(pending.map((v) => v.batch_id as string))];
  for (const batchId of batchIds) {
    const { data: lastJob } = await supabase
      .from('router_jobs')
      .select('status, finished_at')
      .eq('type', 'push_vouchers')
      .eq('payload->>batch_id', batchId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastJob && (lastJob.status === 'queued' || lastJob.status === 'running')) continue;
    if (lastJob?.finished_at && Date.now() - new Date(lastJob.finished_at).getTime() < RETRY_FAILED_PUSH_AFTER_MS) continue;

    await supabase.from('router_jobs').insert({ router_id: router.id, type: 'push_vouchers', payload: { batch_id: batchId, resumed: true } });
    log.info('Resuming unfinished voucher push', { router: router.name, batch: batchId });
  }
}
