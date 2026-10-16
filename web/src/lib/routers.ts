import type { RouterInfo, RouterStatus } from './types';

/** Routers call in every 30 seconds; one silent for 2 minutes is shown as offline. */
const SILENT_AFTER_MS = 120_000;

/** Status to show now: "online" only while the router keeps calling in. */
export function routerStatus(router: Pick<RouterInfo, 'status' | 'last_seen_at'>): RouterStatus {
  if (router.status !== 'online') return router.status;
  const seen = router.last_seen_at ? new Date(router.last_seen_at).getTime() : 0;
  return Date.now() - seen > SILENT_AFTER_MS ? 'offline' : 'online';
}
