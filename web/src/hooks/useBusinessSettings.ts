import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { normalizeHex } from '../lib/brandColor';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';

interface BusinessSettings {
  /** SSP for 1 USD, set by the owner; null when USD is not shown. */
  usdRate: number | null;
  /** '#rrggbb' chosen by the owner, or null (the Hotzonex blue). */
  brandColor: string | null;
  /** A short line shown under the business name, or null. */
  tagline: string | null;
}

/** The business's own settings that are not part of the login (kept apart so a login never fails on them). */
export function useBusinessSettings() {
  const { business } = useAuth();
  const businessId = business?.id ?? '';
  return useQuery({
    queryKey: ['business-settings', businessId],
    enabled: businessId !== '',
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BusinessSettings> => {
      const { data, error } = await supabase.from('tenants').select('usd_rate, brand_color, tagline').eq('id', businessId).maybeSingle();
      if (error) throw new Error(friendlyError(error));
      const rate = data?.usd_rate == null ? null : Number(data.usd_rate);
      return { usdRate: rate && rate > 0 ? rate : null, brandColor: normalizeHex(data?.brand_color), tagline: data?.tagline?.trim() || null };
    },
  });
}

/** The business's USD rate, or null (USD is then not shown). */
export function useUsdRate(): number | null {
  return useBusinessSettings().data?.usdRate ?? null;
}
