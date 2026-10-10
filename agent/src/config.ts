import 'dotenv/config';

export interface AgentConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  routerSecretKey: Buffer;
  jobPollIntervalMs: number;
  syncIntervalMs: number;
  routerTimeoutMs: number;
}

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is missing in agent/.env (see .env.example).`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a whole number above 0.`);
  return value;
}

export function loadConfig(): AgentConfig {
  const supabaseUrl = required('SUPABASE_URL');
  if (!/^https?:\/\//.test(supabaseUrl)) throw new ConfigError('SUPABASE_URL must start with https://');

  const keyHex = required('ROUTER_SECRET_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new ConfigError('ROUTER_SECRET_KEY must be exactly 64 hex characters. Generate one with: openssl rand -hex 32');
  }

  return {
    supabaseUrl,
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    routerSecretKey: Buffer.from(keyHex, 'hex'),
    jobPollIntervalMs: positiveInt('JOB_POLL_INTERVAL_MS', 3000),
    syncIntervalMs: positiveInt('SYNC_INTERVAL_MS', 60000),
    routerTimeoutMs: positiveInt('ROUTER_TIMEOUT_MS', 10000),
  };
}
