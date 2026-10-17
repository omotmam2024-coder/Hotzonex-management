import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PLAN_COLUMNS, ROUTER_COLUMNS, type Plan, type RouterInfo, type SiteRow } from '../lib/types';

/** After a sale, a void, a confirmed payment or new vouchers: every screen that counts sales, cash or stock reloads. */
export function invalidateSalesData(queryClient: QueryClient): void {
  for (const key of ['sales', 'dashboard', 'report', 'profit', 'cash-up', 'stock', 'expiring', 'vouchers', 'batches', 'mark-batches', 'print-batches', 'mark-candidates', 'billing-usage']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: async (): Promise<SiteRow[]> => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, name, timezone, auto_sale_on_login, is_active, buy_enabled, buy_slug, buy_instructions')
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useRouters(refetchInterval: number | false = false) {
  return useQuery({
    queryKey: ['routers'],
    queryFn: async (): Promise<RouterInfo[]> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as RouterInfo[];
    },
    refetchInterval,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase.from('plans').select(PLAN_COLUMNS).order('price_ssp');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
