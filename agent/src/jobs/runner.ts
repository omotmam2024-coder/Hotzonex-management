import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { RouterError } from '../routeros.js';
import type { JobContext, JobOutcome, JobType, RouterJob } from '../types.js';
import { runDisableVoucher } from './disableVoucher.js';
import { runDisconnectUser } from './disconnectUser.js';
import { runPushVouchers } from './pushVouchers.js';
import { runSyncProfiles } from './syncProfiles.js';
import { runTestConnection } from './testConnection.js';

type Handler = (supabase: SupabaseClient, config: AgentConfig, job: RouterJob, ctx: JobContext) => Promise<JobOutcome>;

/** Job types this agent version handles. Other queued types wait for a newer agent. */
const HANDLERS: Partial<Record<JobType, Handler>> = {
  test_connection: runTestConnection,
  sync_profiles: runSyncProfiles,
  push_vouchers: runPushVouchers,
  disable_voucher: runDisableVoucher,
  disconnect_user: runDisconnectUser,
};

const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 5 * 60_000;

/**
 * Polls router_jobs and runs them. Jobs for the same router run one at a time,
 * different routers run in parallel so one offline router never blocks the others.
 */
export class JobRunner {
  private readonly busyRouters = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private polling = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly config: AgentConfig,
  ) {}

  get supportedTypes(): JobType[] {
    return Object.keys(HANDLERS) as JobType[];
  }

  /** Requeue jobs left "running" by an agent that stopped mid-job. */
  async recoverStaleJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const { data, error } = await this.supabase
      .from('router_jobs')
      .select('id, attempts')
      .eq('status', 'running')
      .lt('started_at', cutoff);
    if (error) {
      log.error('Could not check for stuck jobs', { error: error.message });
      return;
    }
    for (const job of data ?? []) {
      const giveUp = job.attempts >= MAX_ATTEMPTS;
      await this.supabase
        .from('router_jobs')
        .update(
          giveUp
            ? { status: 'failed', finished_at: new Date().toISOString(), result: { error: 'The agent stopped while running this job too many times.' } }
            : { status: 'queued', started_at: null },
        )
        .eq('id', job.id)
        .eq('status', 'running');
      log.warn(giveUp ? 'Gave up on stuck job' : 'Requeued stuck job', { job: job.id });
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const { data, error } = await this.supabase
        .from('router_jobs')
        .select('id, router_id, type, payload, attempts, created_by')
        .eq('status', 'queued')
        .in('type', this.supportedTypes)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) {
        log.error('Could not read the job queue', { error: error.message });
        return;
      }
      for (const job of (data ?? []) as RouterJob[]) {
        const key = job.router_id ?? `job:${job.id}`;
        if (this.busyRouters.has(key)) continue;
        this.busyRouters.add(key);
        const task = this.claimAndRun(job).finally(() => {
          this.busyRouters.delete(key);
          this.running.delete(task);
        });
        this.running.add(task);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Waits for jobs already started (used on shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  private async claimAndRun(job: RouterJob): Promise<void> {
    // Claim atomically: only one agent (or loop) can move a job from queued to running.
    const { data: claimed, error: claimError } = await this.supabase
      .from('router_jobs')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id');
    if (claimError) {
      log.error('Could not claim job', { job: job.id, error: claimError.message });
      return;
    }
    if (!claimed || claimed.length === 0) return;

    const handler = HANDLERS[job.type];
    const ctx: JobContext = {
      heartbeat: async () => {
        await this.supabase.from('router_jobs').update({ started_at: new Date().toISOString() }).eq('id', job.id);
      },
    };
    let outcome: JobOutcome;
    try {
      outcome = handler
        ? await handler(this.supabase, this.config, { ...job, attempts: job.attempts + 1 }, ctx)
        : { ok: false, result: { error: `This agent cannot run ${job.type} jobs.` } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof RouterError) log.warn('Job failed', { job: job.id, type: job.type, error: message });
      else log.error('Job crashed', { job: job.id, type: job.type, error: message });
      outcome = { ok: false, result: { error: message } };
    }

    const { error } = await this.supabase
      .from('router_jobs')
      .update({ status: outcome.ok ? 'done' : 'failed', result: outcome.result, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) log.error('Could not save job result', { job: job.id, error: error.message });
  }
}
