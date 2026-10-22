import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { fromJson, supabase } from '../lib/supabase';

export interface Invoice {
  id: string;
  number: string;
  period_start: string;
  period_end: string;
  routers: number;
  price_per_router_ssp: number;
  amount_ssp: number;
  status: 'open' | 'paid' | 'void';
  due_at: string;
  customer_ref: string | null;
  customer_ref_at: string | null;
  paid_at: string | null;
}

export interface BillingOverview {
  status: 'trial' | 'active' | 'suspended';
  exempt: boolean;
  trial_ends_at: string | null;
  price_per_router_ssp: number;
  plan_name?: string | null;
  business_name?: string | null;
  /** The day the next invoice is made (YYYY-MM-DD); null when nothing is billed. */
  next_invoice_on?: string | null;
  next_invoice_amount?: number | null;
  routers: number;
  business_active: boolean;
  instructions: string;
  /** Pounds for one US dollar; null = no dollar amounts. */
  usd_rate?: number | null;
  invoices: Invoice[];
}

/** billing_overview's jsonb: a business with no billing row has no exempt flag or invoices. */
type BillingOverviewJson = Omit<BillingOverview, 'exempt' | 'invoices'> & { exempt?: boolean | null; invoices?: Invoice[] | null };

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: ['billing'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BillingOverview> => {
      const { data, error } = await supabase.rpc('billing_overview');
      if (error) throw new Error(friendlyError(error));
      const b = fromJson<BillingOverviewJson>(data ?? {});
      return { ...b, exempt: b.exempt ?? true, invoices: Array.isArray(b.invoices) ? b.invoices : [] };
    },
  });
}
