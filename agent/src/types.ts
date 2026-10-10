export type JobType = 'test_connection' | 'push_vouchers' | 'sync_profiles' | 'disable_voucher' | 'disconnect_user';

export interface RouterJob {
  id: string;
  router_id: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  created_by: string | null;
}

/** Full router row as the service role sees it (includes the encrypted password). */
export interface RouterRow {
  id: string;
  site_id: string;
  name: string;
  ip_address: string;
  port: number;
  use_https: boolean;
  username: string;
  password_enc: string;
  hotspot_server: string;
  dns_name: string;
  status: 'pending' | 'online' | 'offline';
  last_seen_at: string | null;
  model: string | null;
  ros_version: string | null;
  last_error: string | null;
}

/** What a job handler reports back; stored in router_jobs.result. */
export interface JobOutcome {
  ok: boolean;
  result: Record<string, unknown>;
}

/** Helpers the runner gives to long-running jobs. */
export interface JobContext {
  /** Marks the job as still alive so stuck-job recovery leaves it alone. */
  heartbeat: () => Promise<void>;
}
