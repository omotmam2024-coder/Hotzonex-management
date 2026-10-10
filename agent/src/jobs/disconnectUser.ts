import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { clientFor, loadRouter } from '../routers.js';
import type { JobOutcome, RouterJob } from '../types.js';

interface ActiveSession {
  '.id': string;
  user?: string;
  'mac-address'?: string;
}

/** Closes a user's hotspot session(s). payload: { code, mac_address? } — with a MAC only that device is closed. */
export async function runDisconnectUser(supabase: SupabaseClient, config: AgentConfig, job: RouterJob): Promise<JobOutcome> {
  const code = typeof job.payload['code'] === 'string' ? job.payload['code'] : null;
  const mac = typeof job.payload['mac_address'] === 'string' ? job.payload['mac_address'] : '';
  if (!code) return { ok: false, result: { error: 'The job has no user.' } };
  if (!job.router_id) return { ok: false, result: { error: 'This router has been removed.' } };
  const router = await loadRouter(supabase, job.router_id);
  if (!router) return { ok: false, result: { error: 'This router has been removed.' } };

  const client = clientFor(router, config);
  const sessions = (await client.get<ActiveSession[]>('/ip/hotspot/active', { user: code, '.proplist': '.id,user,mac-address' })).filter(
    (s) => !mac || (s['mac-address'] ?? '').toLowerCase() === mac.toLowerCase(),
  );
  for (const s of sessions) await client.delete(`/ip/hotspot/active/${encodeURIComponent(s['.id'])}`);

  let query = supabase.from('active_sessions').delete().eq('router_id', router.id).eq('code', code);
  if (mac) query = query.eq('mac_address', mac);
  await query;

  log.info('User disconnected', { router: router.name, code, sessions: sessions.length });
  return { ok: true, result: { sessions_closed: sessions.length } };
}
