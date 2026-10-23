/**
 * Type overrides layered on top of the generated `database.types.ts`.
 *
 * Pending types: 20261023194330_momo_api.sql is applied to production (23 October 2026); its
 * columns and function are declared below until the types are regenerated (supabase gen types),
 * after which those entries go. Every other migration is in the generated types.
 *
 * When a new migration adds tables, columns or functions the app needs before it is applied (and
 * before the types are regenerated), declare them in `PendingTables` / `PendingFunctions` below and
 * list the migration here. Once it is applied and the types are regenerated, delete those entries.
 *
 * The "Generator gaps" section is different: it corrects what the generator cannot see
 * (trigger-filled tenant_id, arguments that accept null) and stays after regenerating.
 */
import type { Database, Json } from './database.types';

/** Flattens an intersection into one object type (keeps optional and readonly modifiers). */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** B's keys replace A's; everything else in A is kept. */
type Merge<A, B> = Simplify<Omit<A, keyof B> & B>;

type TableDef = { Row: object; Insert: object; Update: object; Relationships: readonly unknown[] };

type Public = Database['public'];

type PaymentRequests = Public['Tables']['payment_requests'];

/** Columns not yet in the generated types (20261023194330_momo_api.sql, applied). */
type PendingTables = {
  payment_requests: Merge<
    PaymentRequests,
    { Row: Merge<PaymentRequests['Row'], { method: string; momo_ref: string | null; momo_txn_id: string | null; checked_at: string | null }> }
  >;
};

/** Functions not yet in the generated types (20261023194330_momo_api.sql, applied). */
type PendingFunctions = {
  momo_account: { Args: never; Returns: Json };
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
  sell_voucher: NullableArgs<Fn['sell_voucher'], 'p_request_id'>;
  save_business_settings: NullableArgs<Fn['save_business_settings'], 'p_logo_url' | 'p_usd_rate'>;
  expiring_soon: NullableArgs<Fn['expiring_soon'], 'p_site_id'>;
  save_expense: NullableArgs<Fn['save_expense'], 'p_id' | 'p_note' | 'p_site_id'>;
  profit_report: NullableArgs<Fn['profit_report'], 'p_site_id'>;
  platform_save_plan: NullableArgs<
    Fn['platform_save_plan'],
    | 'p_description'
    | 'p_price_per_router_ssp'
    | 'p_max_routers'
    | 'p_max_sites'
    | 'p_max_staff'
    | 'p_max_vouchers_month'
    | 'p_is_public'
  >;
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
