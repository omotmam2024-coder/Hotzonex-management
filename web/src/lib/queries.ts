import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { SiteRow } from './types';

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
