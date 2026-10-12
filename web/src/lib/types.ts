export type Role = 'admin' | 'manager' | 'seller';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  site_id: string | null;
  is_active: boolean;
}

export interface Site {
  id: string;
  name: string;
}

export interface SiteRow extends Site {
  timezone: string;
  auto_sale_on_login: boolean;
  is_active: boolean;
}

export type RouterStatus = 'pending' | 'online' | 'offline';

export type RouterConnection = 'cloud' | 'direct' | 'tunnel';

/** Read-only snapshot of the router's own hotspot setup, from its last connection test. */
export interface HotspotInfo {
  servers: { name: string; interface: string; profile: string; address_pool: string; disabled: boolean }[];
  server_profiles: { name: string; dns_name: string; login_by: string }[];
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

export interface Plan {
  id: string;
  name: string;
  price_ssp: number;
  uptime_seconds: number;
  validity_seconds: number | null;
  rate_limit: string | null;
  data_limit_mb: number | null;
  shared_users: number;
  color: string;
  router_profile_name: string;
  is_active: boolean;
  /** The routers that carry the plan, with its profile name on each (managed = Hotzonex made that profile). */
  plan_routers: PlanRouter[];
}

export interface PlanRouter {
  router_id: string;
  profile_name: string;
  managed: boolean;
}

export const PLAN_COLUMNS =
  'id, name, price_ssp, uptime_seconds, validity_seconds, rate_limit, data_limit_mb, shared_users, color, router_profile_name, is_active, plan_routers(router_id, profile_name, managed)';

/** Whether a plan can be sold or generated on a router (it is ticked for it). */
export const planOnRouter = (plan: Pick<Plan, 'plan_routers'>, routerId: string) => (plan.plan_routers ?? []).some((l) => l.router_id === routerId);

export type VoucherStatus = 'unused' | 'sold' | 'active' | 'expired' | 'disabled';

export interface Voucher {
  id: string;
  created_at: string;
  batch_id: string;
  router_id: string;
  site_id: string;
  plan_id: string;
  code: string;
  status: VoucherStatus;
  on_router: boolean;
  printed_at: string | null;
  sold_at: string | null;
  first_used_at: string | null;
  expires_at: string | null;
}

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
  push_finished_at: string | null;
}
