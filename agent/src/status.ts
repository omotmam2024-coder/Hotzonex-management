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
