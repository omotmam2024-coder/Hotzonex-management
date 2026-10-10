import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from './config.js';
import { decryptSecret } from './crypto.js';
import { RouterOSClient } from './routeros.js';
import type { RouterRow } from './types.js';

export const ROUTER_COLUMNS =
  'id, site_id, name, ip_address, port, use_https, username, password_enc, hotspot_server, dns_name, status, last_seen_at, model, ros_version, last_error';

/** Postgres inet values may come back as "192.168.88.1/32"; RouterOS needs the bare address. */
export function bareIp(ip: string): string {
  return ip.split('/')[0] ?? ip;
}

export async function loadRouter(supabase: SupabaseClient, id: string): Promise<RouterRow | null> {
  const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', id).maybeSingle<RouterRow>();
  if (error) throw new Error(`Could not load router: ${error.message}`);
  return data;
}

export function clientFor(router: RouterRow, config: AgentConfig): RouterOSClient {
  return new RouterOSClient(
    {
      name: router.name,
      ip: bareIp(router.ip_address),
      port: router.port,
      useHttps: router.use_https,
      username: router.username,
      password: decryptSecret(router.password_enc, config.routerSecretKey),
    },
    config.routerTimeoutMs,
  );
}

export interface SystemResource {
  'board-name'?: string;
  version?: string;
  uptime?: string;
}

export async function readSystemResource(client: RouterOSClient): Promise<SystemResource> {
  return client.get<SystemResource>('/system/resource');
}
