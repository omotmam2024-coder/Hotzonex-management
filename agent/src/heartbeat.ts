import { readFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from './logger.js';

function agentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** IPv4 addresses of this computer's network cards (not loopback), e.g. ["192.168.120.23"]. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/** Tells the web app this agent is alive, where it runs and which jobs it handles. */
export function createHeartbeat(supabase: SupabaseClient, jobTypes: string[]): () => Promise<void> {
  const name = hostname();
  const version = agentVersion();
  const startedAt = new Date().toISOString();
  let warned = false;
  return async () => {
    const { error } = await supabase.from('agent_status').upsert({
      id: name,
      hostname: name,
      version,
      started_at: startedAt,
      last_seen_at: new Date().toISOString(),
      lan_addresses: lanAddresses(),
      job_types: jobTypes,
    });
    if (error && !warned) {
      warned = true;
      log.warn('Could not report agent status to the web app', { error: error.message });
    } else if (!error) {
      warned = false;
    }
  };
}
