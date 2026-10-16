import type { RouterInfo, RouterStatus } from './types';

/** Routers call in every 30 seconds; one silent for 2 minutes is shown as offline. */
const SILENT_AFTER_MS = 120_000;

/** Status to show now: "online" only while the router keeps calling in. */
export function routerStatus(router: Pick<RouterInfo, 'status' | 'last_seen_at'>): RouterStatus {
  if (router.status !== 'online') return router.status;
  const seen = router.last_seen_at ? new Date(router.last_seen_at).getTime() : 0;
  return Date.now() - seen > SILENT_AFTER_MS ? 'offline' : 'online';
}

/**
 * The IP the router's hotspot answers on (e.g. 10.5.50.1), from the last connection test; '' when
 * not known yet. Its login page works there on any phone, even one whose DNS ignores the router.
 */
export function hotspotAddress(router: { hotspot_info?: unknown; hotspot_server?: string | null } | null | undefined): string {
  const info = router?.hotspot_info;
  const list = info && typeof info === 'object' && 'servers' in info ? (info as { servers: unknown }).servers : null;
  const servers = Array.isArray(list)
    ? list.filter((sv): sv is { name?: unknown; disabled?: unknown; address?: unknown } => Boolean(sv) && typeof sv === 'object')
    : [];
  const server = servers.find((sv) => sv.name === router?.hotspot_server) ?? servers.find((sv) => sv.disabled !== true);
  const address = server?.address;
  return typeof address === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? address : '';
}
