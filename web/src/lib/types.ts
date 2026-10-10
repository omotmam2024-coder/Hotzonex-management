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

/** Router columns the browser may read (password_enc is never readable). */
export interface RouterInfo {
  id: string;
  created_at: string;
  site_id: string;
  name: string;
  ip_address: string;
  port: number;
  use_https: boolean;
  username: string;
  hotspot_server: string;
  dns_name: string;
  status: RouterStatus;
  last_seen_at: string | null;
  model: string | null;
  ros_version: string | null;
  last_error: string | null;
}

export const ROUTER_COLUMNS =
  'id, created_at, site_id, name, ip_address, port, use_https, username, hotspot_server, dns_name, status, last_seen_at, model, ros_version, last_error';

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
