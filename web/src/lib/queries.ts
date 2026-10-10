import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { PLAN_COLUMNS, ROUTER_COLUMNS, type Plan, type RouterInfo, type SiteRow } from './types';

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: async (): Promise<SiteRow[]> => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, name, timezone, auto_sale_on_login, is_active')
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
      return (data ?? []) as Plan[];
    },
  });
}
