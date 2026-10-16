/**
 * Database objects that exist only in migrations NOT YET APPLIED to the Supabase project, so they
 * are missing from the generated `database.types.ts` (the app already calls them and copes with
 * their absence at runtime).
 *
 *   20261016171000_idempotent_sell.sql     sales.request_id, sell_voucher(p_request_id)
 *   20261016180000_business_settings.sql   tenants.usd_rate, save_business_settings()
 *   20261016181000_dashboard_expiring.sql  expiring_soon()
 *   20261016190000_subscription_plans.sql  subscription_plans, tenant_billing.plan_id, billing_usage(),
 *                                          public_pricing(), platform_plans(), platform_set_business_plan(),
 *                                          platform_save_plan()  (APPLIED)
 *   20261016210000_expenses.sql            expenses, save_expense(), remove_expense(), profit_report()
 *                                          (APPLIED; drop these entries at the next type regeneration)
 *
 * These entries go away once the migrations are applied and the types are regenerated: delete the
 * matching entry from `PendingTables` / `PendingFunctions`.
 *
 * The "Generator gaps" section at the end is different: it corrects what the generator cannot see
 * (trigger-filled tenant_id, arguments that accept null) and stays after regenerating.
 */
import type { Database, Json } from './database.types';

/** Flattens an intersection into one object type (keeps optional and readonly modifiers). */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** B's keys replace A's; everything else in A is kept. */
type Merge<A, B> = Simplify<Omit<A, keyof B> & B>;

type TableDef = { Row: object; Insert: object; Update: object; Relationships: readonly unknown[] };

/** A generated table with extra columns (all new columns are nullable or have a default). */
type WithColumns<T extends TableDef, Cols extends object, Rels extends readonly unknown[] = []> = {
  Row: Merge<T['Row'], Cols>;
  Insert: Merge<T['Insert'], Partial<Cols>>;
  Update: Merge<T['Update'], Partial<Cols>>;
  Relationships: [...T['Relationships'], ...Rels];
};

type Public = Database['public'];

type SubscriptionPlanRow = {
  id: string;
  name: string;
  description: string;
  price_per_router_ssp: number | null;
  max_routers: number | null;
  max_sites: number | null;
  max_staff: number | null;
  max_vouchers_month: number | null;
  sort: number;
  is_public: boolean;
  updated_at: string;
};

type ExpenseRow = {
  id: string;
  tenant_id: string;
  site_id: string | null;
  spent_on: string;
  category: string;
  amount_ssp: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PendingTables = {
  expenses: {
    Row: ExpenseRow;
    Insert: Partial<ExpenseRow>;
    Update: Partial<ExpenseRow>;
    Relationships: [];
  };
  sales: WithColumns<Public['Tables']['sales'], { request_id: string | null }>;
  tenants: WithColumns<Public['Tables']['tenants'], { usd_rate: number | null }>;
  tenant_billing: WithColumns<
    Public['Tables']['tenant_billing'],
    { plan_id: string },
    [
      {
        foreignKeyName: 'tenant_billing_plan_id_fkey';
        columns: ['plan_id'];
        isOneToOne: false;
        referencedRelation: 'subscription_plans';
        referencedColumns: ['id'];
      },
    ]
  >;
  subscription_plans: {
    Row: SubscriptionPlanRow;
    Insert: Pick<SubscriptionPlanRow, 'id' | 'name'> & Partial<Omit<SubscriptionPlanRow, 'id' | 'name'>>;
    Update: Partial<SubscriptionPlanRow>;
    Relationships: [];
  };
};

type PendingFunctions = {
  save_expense: {
    Args: { p_id: string | null; p_spent_on: string; p_category: string; p_amount_ssp: number; p_note: string | null; p_site_id: string | null };
    Returns: string;
  };
  remove_expense: { Args: { p_id: string }; Returns: undefined };
  profit_report: { Args: { p_period: string; p_date: string; p_site_id?: string | null }; Returns: Json };
  sell_voucher: {
    Args: { p_plan_id: string; p_router_id: string; p_request_id?: string | null };
    Returns: Public['Functions']['sell_voucher']['Returns'];
  };
  save_business_settings: {
    Args: { p_name: string; p_logo_url: string | null; p_usd_rate: number | null };
    Returns: undefined;
  };
  expiring_soon: {
    Args: { p_site_id?: string | null; p_hours?: number };
    Returns: { plan_id: string; plan_name: string; plan_color: string; cards: number }[];
  };
  billing_usage: { Args: never; Returns: Json };
  public_pricing: { Args: never; Returns: Json };
  platform_plans: { Args: never; Returns: Json };
  platform_set_business_plan: {
    Args: { p_tenant_id: string; p_plan_id: string };
    Returns: undefined;
  };
  platform_save_plan: {
    Args: {
      p_id: string;
      p_name: string;
      p_description: string | null;
      p_price_per_router_ssp: number | null;
      p_max_routers: number | null;
      p_max_sites: number | null;
      p_max_staff: number | null;
      p_max_vouchers_month: number | null;
      p_is_public: boolean | null;
    };
    Returns: undefined;
  };
};

// ---------------------------------------------------------------------------------------------
// Generator gaps. Unlike everything above, these STAY after regenerating: the generator cannot see
// them in the catalog, so they are re-applied on top of every generated `Database`.
// ---------------------------------------------------------------------------------------------

/**
 * Tables whose tenant_id is filled in by the `aa_set_tenant` BEFORE INSERT trigger: the browser
 * never sends it, but the column is NOT NULL without a default, so the generator makes it required.
 */
type TenantStampedTable =
  | 'active_sessions'
  | 'plan_routers'
  | 'plans'
  | 'portal_configs'
  | 'profiles'
  | 'router_jobs'
  | 'router_logins'
  | 'router_profile_ignores'
  | 'routers'
  | 'sales'
  | 'sites'
  | 'voucher_batches'
  | 'vouchers';

type TenantOptional<T extends TableDef & { Insert: { tenant_id: string } }> = Merge<
  T,
  { Insert: Merge<T['Insert'], { tenant_id?: string }> }
>;

type MergedTables = Merge<Public['Tables'], PendingTables>;
type StampedTables = { [K in TenantStampedTable]: TenantOptional<MergedTables[K]> };

/** Function arguments the SQL accepts as null (the generator types every argument as non-null). */
type NullableArgs<F extends { Args: object; Returns: unknown }, K extends keyof F['Args']> = {
  Args: Merge<F['Args'], { [P in K]: F['Args'][P] | null }>;
  Returns: F['Returns'];
};

type Fn = Public['Functions'];

type NullableArgFunctions = {
  cash_up: NullableArgs<Fn['cash_up'], 'p_site_id'>;
  dashboard_summary: NullableArgs<Fn['dashboard_summary'], 'p_site_id'>;
  list_sales: NullableArgs<Fn['list_sales'], 'p_plan_id' | 'p_seller_id' | 'p_site_id'>;
  platform_mark_invoice: NullableArgs<Fn['platform_mark_invoice'], 'p_ref'>;
  platform_set_business_billing: NullableArgs<Fn['platform_set_business_billing'], 'p_price' | 'p_trial_ends_at'>;
  record_cash_handover: NullableArgs<Fn['record_cash_handover'], 'p_note'>;
  report_period: NullableArgs<Fn['report_period'], 'p_plan_id' | 'p_seller_id' | 'p_site_id'>;
  set_seller_terms: NullableArgs<Fn['set_seller_terms'], 'p_credit_limit_ssp'>;
};

/** The generated schema plus the pending migrations and the generator gaps. Used by the Supabase client. */
export type AppDatabase = Merge<
  Database,
  {
    public: Merge<
      Public,
      {
        Tables: Merge<MergedTables, StampedTables>;
        Functions: Merge<Fn, Merge<PendingFunctions, NullableArgFunctions>>;
      }
    >;
  }
>;
