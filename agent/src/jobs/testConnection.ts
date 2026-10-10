import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { RouterError } from '../routeros.js';
import { bareIp, clientFor, loadRouter, readSystemResource } from '../routers.js';
import type { JobOutcome, RouterJob } from '../types.js';

interface HotspotServer {
  name?: string;
  profile?: string;
}

interface HotspotProfile {
  name?: string;
  'dns-name'?: string;
}

/**
 * Logs in to the router, reads its model/version and confirms the hotspot server exists.
 * payload.mode = "create": a failed first test removes the pending router row.
 */
export async function runTestConnection(supabase: SupabaseClient, config: AgentConfig, job: RouterJob): Promise<JobOutcome> {
  if (!job.router_id) return { ok: false, result: { error: 'This router has been removed.' } };
  const router = await loadRouter(supabase, job.router_id);
  if (!router) return { ok: false, result: { error: 'This router has been removed.' } };

  const isCreate = job.payload['mode'] === 'create';
  const ip = bareIp(router.ip_address);

  try {
    const client = clientFor(router, config);
    const resource = await readSystemResource(client);
    const servers = await client.get<HotspotServer[]>('/ip/hotspot');
    const server = servers.find((s) => s.name === router.hotspot_server);
    if (!server) {
      const names = servers.map((s) => s.name).filter(Boolean);
      throw new RouterError(
        'not_found',
        `Hotspot server ${router.hotspot_server} not found on ${ip}.` +
          (names.length ? ` Servers on this router: ${names.join(', ')}.` : ' This router has no hotspot server set up.'),
      );
    }

    const warnings: string[] = [];
    if (server.profile) {
      const profiles = await client.get<HotspotProfile[]>('/ip/hotspot/profile', { name: server.profile });
      const routerDns = profiles[0]?.['dns-name'] ?? '';
      if (routerDns.toLowerCase() !== router.dns_name.toLowerCase()) {
        warnings.push(
          routerDns
            ? `The router's hotspot DNS name is "${routerDns}", but you entered "${router.dns_name}". Cards will print "${router.dns_name}".`
            : `The router's hotspot profile has no DNS name set. Cards will print "${router.dns_name}".`,
        );
      }
    }

    const model = resource['board-name'] ?? null;
    const rosVersion = resource.version ?? null;
    const { error } = await supabase
      .from('routers')
      .update({ status: 'online', last_seen_at: new Date().toISOString(), model, ros_version: rosVersion, last_error: null })
      .eq('id', router.id);
    if (error) throw new Error(`Could not save router status: ${error.message}`);

    if (isCreate) {
      await supabase.from('audit_log').insert({
        user_id: job.created_by,
        action: 'router.added',
        details: { router_id: router.id, name: router.name, ip },
      });
      // A new router gets every plan's hotspot profile straight away.
      await supabase.from('router_jobs').insert({ router_id: router.id, type: 'sync_profiles', payload: {}, created_by: job.created_by });
    }

    log.info('Router test passed', { router: router.name, ip, model, rosVersion });
    return { ok: true, result: { model, ros_version: rosVersion, uptime: resource.uptime ?? null, warnings } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Router test failed', { router: router.name, ip, error: message });

    if (isCreate) {
      // Nothing is saved when the first test fails.
      const { error } = await supabase.from('routers').delete().eq('id', router.id).eq('status', 'pending');
      if (error) log.error('Could not remove the failed router', { router: router.name, error: error.message });
    } else {
      await supabase.from('routers').update({ status: 'offline', last_error: message }).eq('id', router.id);
    }
    return { ok: false, result: { error: message, removed: isCreate } };
  }
}
