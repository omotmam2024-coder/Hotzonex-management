import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from './logger.js';
import type { RouterOSClient } from './routeros.js';
import type { RouterRow } from './types.js';

interface ActiveSession {
  user?: string;
}

/**
 * "Sell on first login": records a cash sale (no seller) for every unused voucher
 * that is currently logged in on a router whose site has auto_sale_on_login.
 */
export async function recordFirstLoginSales(supabase: SupabaseClient, router: RouterRow, client: RouterOSClient): Promise<void> {
  const sessions = await client.get<ActiveSession[]>('/ip/hotspot/active', { '.proplist': 'user' });
  const codes = [...new Set(sessions.map((s) => s.user ?? '').filter((u) => /^\d{6,10}$/.test(u)))];
  if (codes.length === 0) return;

  for (let i = 0; i < codes.length; i += 200) {
    const { data, error } = await supabase
      .from('vouchers')
      .select('id, code')
      .eq('router_id', router.id)
      .eq('status', 'unused')
      .in('code', codes.slice(i, i + 200));
    if (error) {
      log.error('Could not check first logins', { router: router.name, error: error.message });
      return;
    }
    for (const v of data ?? []) {
      const { data: recorded, error: rpcError } = await supabase.rpc('record_auto_sale', { p_voucher_id: v.id });
      if (rpcError) log.error('Could not record automatic sale', { router: router.name, code: v.code, error: rpcError.message });
      else if (recorded) log.info('Automatic sale on first login', { router: router.name, code: v.code });
    }
  }
}
