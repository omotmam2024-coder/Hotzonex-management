import type { Tables } from './database.types';

export type Role = 'admin' | 'manager' | 'seller';

/** A login's profile (the role column is free text in the database; these are the values it holds). */
export type Profile = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'site_id' | 'is_active'> & { role: Role };

/** Site columns the app reads (buy_*: the public Buy page, customers pay by mobile money; a cashier confirms). */
export type SiteRow = Pick<
  Tables<'sites'>,
  'id' | 'name' | 'timezone' | 'auto_sale_on_login' | 'is_active' | 'buy_enabled' | 'buy_slug' | 'buy_instructions'
>;

export type RouterStatus = 'pending' | 'online' | 'offline';

export type RouterConnection = 'cloud' | 'direct' | 'tunnel';

/** Read-only snapshot of the router's own hotspot setup, from its last connection test. */
export interface HotspotInfo {
  servers: { name: string; interface: string; profile: string; address_pool: string; disabled: boolean }[];
  server_profiles: { name: string; dns_name: string; login_by: string; html_directory?: string }[];
  user_profiles: { name: string; rate_limit: string; shared_users: string }[];
  users: number;
  active: number;
  checked_at: string;
}

/** Router columns the browser may read (the stored password and connector token are never readable). */
export interface RouterInfo {
  id: string;
  created_at: string;
  site_id: string;
  name: string;
  connection: RouterConnection;
  host: string | null;
  /** Tunnel connection: the router's address on the tunnel server (10.99.0.x). */
  tunnel_ip: string | null;
  port: number | null;
  use_https: boolean | null;
  username: string | null;
  hotspot_info: HotspotInfo | null;
  /** Hotspot users on the router at the last minute check (all users, MikroTicket ones too). */
  hotspot_users: { total: number; unused: number; used: number; by_profile: { profile: string; total: number; unused: number }[]; checked_at: string } | null;
  hotspot_server: string | null;
  dns_name: string | null;
  status: RouterStatus;
  last_seen_at: string | null;
  model: string | null;
  ros_version: string | null;
  last_error: string | null;
  last_usage_at: string | null;
}

export const ROUTER_COLUMNS =
  'id, created_at, site_id, name, connection, host, tunnel_ip, port, use_https, username, hotspot_info, hotspot_users, hotspot_server, dns_name, status, last_seen_at, model, ros_version, last_error, last_usage_at';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  status: JobStatus;
  result: Record<string, unknown> | null;
}

export interface TestConnectionResult {
  model?: string | null;
  ros_version?: string | null;
  uptime?: string | null;
  hotspot_server?: string | null;
  dns_name?: string | null;
  warnings?: string[];
  error?: string;
  removed?: boolean;
}

export interface StaffMember {
  id: string;
  full_name: string;
  role: Role;
  site_id: string | null;
  is_active: boolean;
  created_at: string;
  email: string;
}

export type Plan = Pick<
  Tables<'plans'>,
  | 'id'
  | 'name'
  | 'price_ssp'
  | 'uptime_seconds'
  | 'validity_seconds'
  | 'rate_limit'
  | 'data_limit_mb'
  | 'shared_users'
  | 'color'
  | 'router_profile_name'
  | 'is_active'
> & {
  /** The routers that carry the plan, with its profile name on each (managed = Hotzonex made that profile). */
  plan_routers: PlanRouter[];
};

export type PlanRouter = Pick<Tables<'plan_routers'>, 'router_id' | 'profile_name' | 'managed'>;

export const PLAN_COLUMNS =
  'id, name, price_ssp, uptime_seconds, validity_seconds, rate_limit, data_limit_mb, shared_users, color, router_profile_name, is_active, plan_routers(router_id, profile_name, managed)';

/** Whether a plan can be sold or generated on a router (it is ticked for it). */
export const planOnRouter = (plan: Pick<Plan, 'plan_routers'>, routerId: string) => (plan.plan_routers ?? []).some((l) => l.router_id === routerId);

export type VoucherStatus = 'unused' | 'sold' | 'active' | 'expired' | 'disabled';

export type Voucher = Pick<
  Tables<'vouchers'>,
  | 'id'
  | 'created_at'
  | 'batch_id'
  | 'router_id'
  | 'site_id'
  | 'plan_id'
  | 'code'
  | 'on_router'
  | 'printed_at'
  | 'sold_at'
  | 'first_used_at'
  | 'expires_at'
> & { status: VoucherStatus };

export interface BatchStatus {
  id: string;
  created_at: string;
  site_id: string;
  router_id: string;
  plan_id: string;
  quantity: number;
  code_length: number;
  site_name: string;
  router_name: string;
  plan_name: string;
  plan_color: string;
  price_ssp: number;
  uptime_seconds: number;
  voucher_count: number;
  pushed_count: number;
  push_status: JobStatus | null;
  push_error: string | null;
  /** What the check on the router found after the push (missing cards, wrong profile, code length). */
  push_warnings?: string[];
  push_finished_at: string | null;
}
