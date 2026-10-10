import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { clientFor, loadRouter } from '../routers.js';
import type { JobOutcome, RouterJob } from '../types.js';

interface HotspotUser {
  '.id': string;
  name: string;
  comment?: string;
  disabled?: string;
}

interface ActiveSession {
  '.id': string;
  user?: string;
}

/**
 * Disables a voided voucher's hotspot user and closes its open sessions.
 * Only touches the user tagged "hzc:<voucher_id>", so a manual user with the same name is safe.
 */
export async function runDisableVoucher(supabase: SupabaseClient, config: AgentConfig, job: RouterJob): Promise<JobOutcome> {
  const voucherId = typeof job.payload['voucher_id'] === 'string' ? job.payload['voucher_id'] : null;
  const code = typeof job.payload['code'] === 'string' ? job.payload['code'] : null;
  if (!voucherId || !code) return { ok: false, result: { error: 'The job has no voucher.' } };
  if (!job.router_id) return { ok: false, result: { error: 'This router has been removed.' } };
  const router = await loadRouter(supabase, job.router_id);
  if (!router) return { ok: false, result: { error: 'This router has been removed.' } };

  const client = clientFor(router, config);
  const users = await client.get<HotspotUser[]>('/ip/hotspot/user', { name: code, '.proplist': '.id,name,comment,disabled' });
  const user = users.find((u) => u.comment === `hzc:${voucherId}`);
  if (!user) {
    log.info('Voided voucher was not on the router', { router: router.name, code });
    return { ok: true, result: { disabled: false, note: 'The voucher was not on the router.' } };
  }
  if (user.disabled !== 'true' && user.disabled !== 'yes') {
    await client.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, { disabled: 'yes' });
  }

  const sessions = await client.get<ActiveSession[]>('/ip/hotspot/active', { user: code, '.proplist': '.id,user' });
  for (const s of sessions) await client.delete(`/ip/hotspot/active/${encodeURIComponent(s['.id'])}`);

  log.info('Voucher disabled on router', { router: router.name, code, sessionsClosed: sessions.length });
  return { ok: true, result: { disabled: true, sessions_closed: sessions.length } };
}
