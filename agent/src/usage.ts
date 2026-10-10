import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from './logger.js';
import { RouterError, type RouterOSClient } from './routeros.js';
import { fromRouterOsTime } from './routerTime.js';
import type { RouterRow } from './types.js';

interface ActiveSession {
  '.id': string;
  user?: string;
  'mac-address'?: string;
  address?: string;
  uptime?: string;
  'bytes-in'?: string;
  'bytes-out'?: string;
}

interface HotspotUser {
  '.id': string;
  name: string;
  comment?: string;
  uptime?: string;
  'bytes-in'?: string;
  'bytes-out'?: string;
}

interface SyncResult {
  first_logins: number;
  auto_sales: number;
  expired: number;
  remove: { id: string; code: string }[];
  kick: { id: string; code: string }[];
}

const VOUCHER_TAG = /^hzc:([0-9a-f-]{36})$/i;
const toInt = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * One usage sync for an online router: reads who is online and each voucher user's counters,
 * lets the database update sessions / first login / expiry, then removes expired users that are
 * offline and closes sessions whose validity has run out. Every router write checks the hzc tag.
 */
export async function syncUsage(supabase: SupabaseClient, router: RouterRow, client: RouterOSClient): Promise<void> {
  const [active, users] = await Promise.all([
    client.get<ActiveSession[]>('/ip/hotspot/active', { '.proplist': '.id,user,mac-address,address,uptime,bytes-in,bytes-out' }),
    client.get<HotspotUser[]>('/ip/hotspot/user', { '.proplist': '.id,name,comment,uptime,bytes-in,bytes-out' }),
  ]);

  const sessions = active
    .filter((s) => s.user)
    .map((s) => ({
      code: s.user,
      mac: s['mac-address'] ?? '',
      ip: s.address ?? null,
      uptime: fromRouterOsTime(s.uptime),
      bytes_in: toInt(s['bytes-in']),
      bytes_out: toInt(s['bytes-out']),
    }));

  const tagged = new Map<string, HotspotUser>();
  const usage = [];
  for (const u of users) {
    const match = VOUCHER_TAG.exec(u.comment ?? '');
    if (!match?.[1]) continue;
    tagged.set(match[1].toLowerCase(), u);
    usage.push({ voucher_id: match[1], uptime: fromRouterOsTime(u.uptime), bytes: toInt(u['bytes-in']) + toInt(u['bytes-out']) });
  }

  const { data, error } = await supabase.rpc('sync_router_usage', { p_router_id: router.id, p_sessions: sessions, p_users: usage });
  if (error) throw new Error(`Usage sync failed: ${error.message}`);
  const result = data as SyncResult;

  // Close sessions of vouchers whose validity ran out (the router does not know about validity).
  for (const k of result.kick) {
    for (const s of active.filter((a) => a.user === k.code)) {
      try {
        await client.delete(`/ip/hotspot/active/${encodeURIComponent(s['.id'])}`);
      } catch (err) {
        if (!(err instanceof RouterError && err.kind === 'not_found')) throw err;
      }
    }
    log.info('Closed session: validity ended', { router: router.name, code: k.code });
  }

  // Remove expired vouchers that are not online. Only users carrying this voucher's tag are touched.
  const removed: string[] = [];
  for (const r of result.remove) {
    const user = tagged.get(r.id.toLowerCase());
    try {
      if (user && user.name === r.code) await client.delete(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`);
      removed.push(r.id);
    } catch (err) {
      // Already gone counts as removed; anything else is retried on the next sync.
      if (err instanceof RouterError && err.kind === 'not_found') removed.push(r.id);
      else if (err instanceof RouterError && (err.kind === 'timeout' || err.kind === 'unreachable' || err.kind === 'refused')) throw err;
      else log.warn('Could not remove expired voucher from router', { router: router.name, code: r.code, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (removed.length) {
    const { error: updateError } = await supabase.from('vouchers').update({ on_router: false }).in('id', removed);
    if (updateError) log.error('Could not record removed vouchers', { router: router.name, error: updateError.message });
  }

  if (result.first_logins || result.expired || removed.length || result.kick.length) {
    log.info('Usage synced', {
      router: router.name,
      online: sessions.length,
      firstLogins: result.first_logins,
      autoSales: result.auto_sales,
      expired: result.expired,
      removedFromRouter: removed.length,
      sessionsClosed: result.kick.length,
    });
  }
}

/** Clears the live user list of a router that cannot be reached, so nobody shows as online by mistake. */
export async function clearSessions(supabase: SupabaseClient, routerId: string): Promise<void> {
  await supabase.from('active_sessions').delete().eq('router_id', routerId);
}
