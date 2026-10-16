import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

interface BusinessSettings {
  /** SSP for 1 USD, set by the owner; null when USD is not shown. */
  usdRate: number | null;
  /** The database does not have business settings yet (migration 20261016180000 not applied). */
  needsUpdate: boolean;
}

/** The business's own settings that are not part of the login (kept apart so a login never fails on them). */
export function useBusinessSettings() {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['business-settings', business?.id],
    enabled: Boolean(business?.id),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BusinessSettings> => {
      const { data, error } = await supabase.from('tenants').select('usd_rate').eq('id', business!.id).maybeSingle();
      if (error) return { usdRate: null, needsUpdate: error.code === '42703' || /usd_rate/.test(error.message) };
      const rate = data?.usd_rate == null ? null : Number(data.usd_rate);
      return { usdRate: rate && rate > 0 ? rate : null, needsUpdate: false };
    },
  });
}

/** The business's USD rate, or null (USD is then not shown). */
export function useUsdRate(): number | null {
  return useBusinessSettings().data?.usdRate ?? null;
}
