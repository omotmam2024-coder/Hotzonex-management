import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { friendlyError } from './errors';
import type { Period } from './period';
import { fromJson, supabase } from './supabase';
import { EXPENSE_CATEGORIES } from './validation';

export interface Money {
  revenue: number;
  commission: number;
  expenses: number;
  profit: number;
}

export interface Expense {
  id: string;
  spent_on: string;
  category: string;
  amount_ssp: number;
  note: string | null;
  site_id: string | null;
  site_name: string | null;
  created_by: string | null;
}

export interface ProfitReport {
  period: Period;
  start: string;
  end: string;
  site_id: string | null;
  summary: Money;
  previous: Omit<Money, 'commission'>;
  days: (Money & { day: string })[];
  by_category: { category: string; amount: number }[];
  items: Expense[];
}

export const categoryLabel = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? key;

/** Green for a profit, red for a loss. */
export const profitTone = (n: number) => (n > 0 ? 'text-green-700' : n < 0 ? 'text-red-700' : 'text-slate-900');

/** Sales − agent commission − expenses for a day, week or month (shared by Reports and Expenses & profit). */
export function useProfit(period: Period, date: string, siteId: string, enabled = true) {
  return useQuery({
    queryKey: ['profit', period, date, siteId],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProfitReport> => {
      const { data, error } = await supabase.rpc('profit_report', { p_period: period, p_date: date, p_site_id: siteId || null });
      if (error) throw new Error(friendlyError(error));
      return fromJson<ProfitReport>(data);
    },
  });
}
