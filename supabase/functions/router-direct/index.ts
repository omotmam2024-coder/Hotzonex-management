// router-direct: runs work for routers added by IP address / DNS name with an admin login
// (connection = 'direct'). Hotzonex calls each router's RouterOS REST API over the internet.
//
// Woken by the database (pg_net), never by browsers:
//   - right after a job is queued for a direct router   { router_id }
//   - every minute by pg_cron                          {}  → status check, users report, waiting jobs
// The caller must send x-hzc-worker equal to app_config.direct_worker_secret.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { serviceClient } from '../_shared/auth.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import {
  closeSessions,
  directTest,
  disableVoucher,
  ensureProfileExists,
  pushVoucher,
  readUsage,
  removeExpired,
  RestClient,
  RouterError,
  userComments,
  type PushResult,
} from '../_shared/direct.ts';
import {
  applyPushResults,
  applyTestResult,
  applyUsage,
  clearDisconnected,
  finishJob,
  JOB_COLUMNS,
  markRemoved,
  MAX_SENDS,
  nextPushChunk,
  plansForSync,
  profileOf,
  resumeUnfinishedPushes,
  str,
  type Job,
  type RouterRef,
} from '../_shared/jobs.ts';
import { toRouterOsTime } from '../_shared/routeros.ts';

interface DirectRouter extends RouterRef {
  host: string | null;
  port: number | null;
  use_https: boolean | null;
  username: string | null;
  password_enc: string | null;
  last_error: string | null;
}

const ROUTER_COLUMNS = 'id, name, status, hotspot_server, dns_name, last_usage_at, host, port, use_https, username, password_enc, last_error';
const BUDGET_MS = 100_000; // stay well inside the Edge Function time limit
const STALE_RUNNING_MS = 5 * 60_000;
const PUSH_CHUNK = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const transient = (err: unknown) => err instanceof RouterError && (err.kind === 'timeout' || err.kind === 'unreachable');
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function clientFor(db: SupabaseClient, router: DirectRouter): Promise<RestClient> {
  if (!router.host || !router.username || !router.password_enc) throw new RouterError('auth', 'The router address, username or password is missing. Edit the router.');
  const { data: key, error } = await db.rpc('router_secret_key');
  if (error || typeof key !== 'string') throw new Error('The router password key could not be read.');
  return new RestClient({
    host: router.host,
    port: router.port ?? (router.use_https ? 443 : 80),
    useHttps: Boolean(router.use_https),
    username: router.username,
    password: await decryptSecret(router.password_enc, key),
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Runs one job. Returns false when the job was put back in the queue to continue later. */
async function runJob(db: SupabaseClient, router: DirectRouter, client: RestClient, job: Job, deadline: number): Promise<boolean> {
  switch (job.type) {
    case 'test_connection': {
      try {
        const t = await directTest(client, router.hotspot_server);
        await applyTestResult(db, router, job, { ...t, servers: t.hotspot.servers.map((h) => h.name) });
      } catch (err) {
        const msg = message(err);
        await db
          .from('routers')
          .update({ last_error: msg, ...(router.status === 'online' ? { status: 'offline' } : {}) })
          .eq('id', router.id);
        await finishJob(db, job.id, false, { error: msg });
      }
      return true;
    }

    case 'sync_profiles': {
      const plans = await plansForSync(db, job);
      let added = 0;
      for (const p of plans) if (await ensureProfileExists(client, profileOf(p))) added++;
      await finishJob(db, job.id, true, { profiles: plans.length, added });
      return true;
    }

    case 'push_vouchers': {
      let comments: Map<string, string> | null = null;
      for (;;) {
        if (Date.now() > deadline) {
          // Out of time: continue on the next wake-up (progress is already saved).
          await db.from('router_jobs').update({ status: 'queued', started_at: null }).eq('id', job.id);
          return false;
        }
        const chunk = await nextPushChunk(db, router, job, PUSH_CHUNK);
        if (!chunk) return true;
        comments ??= await userComments(client);
        await ensureProfileExists(client, profileOf(chunk.plan));
        const opts = {
          profile: chunk.plan.router_profile_name,
          server: router.hotspot_server,
          limitUptime: toRouterOsTime(chunk.plan.uptime_seconds),
          limitBytes: chunk.plan.data_limit_mb ? String(chunk.plan.data_limit_mb * 1024 * 1024) : null,
        };
        const items: { voucher: string; result: PushResult }[] = [];
        try {
          for (const v of chunk.vouchers) items.push({ voucher: v.id, result: await pushVoucher(client, v, opts, comments) });
        } finally {
          await applyPushResults(db, router, job, items);
        }
        if (items.every((i) => i.result === 'error')) {
          await finishJob(db, job.id, false, {
            ...(job.result ?? {}),
            error: `The router refused the vouchers. Check that hotspot server "${router.hotspot_server}" and profile "${opts.profile}" exist.`,
          });
          return true;
        }
      }
    }

    case 'disable_voucher': {
      const voucherId = str(job.payload.voucher_id);
      const code = str(job.payload.code);
      if (!voucherId || !code) {
        await finishJob(db, job.id, false, { error: 'The job has no voucher.' });
        return true;
      }
      const r = await disableVoucher(client, voucherId, code);
      await finishJob(db, job.id, true, { disabled: r.disabled, sessions_closed: r.sessions, ...(r.disabled ? {} : { note: 'The voucher was not on the router.' }) });
      return true;
    }

    case 'disconnect_user': {
      const code = str(job.payload.code);
      if (!code) {
        await finishJob(db, job.id, false, { error: 'The job has no user.' });
        return true;
      }
      const closed = await closeSessions(client, code, str(job.payload.mac_address));
      await clearDisconnected(db, router, job);
      await finishJob(db, job.id, true, { sessions_closed: closed });
      return true;
    }

    default:
      await finishJob(db, job.id, false, { error: `Unknown job type ${job.type}.` });
      return true;
  }
}

/** Claims and runs this router's waiting jobs, oldest first, until none are left or time runs out. */
async function runJobs(db: SupabaseClient, router: DirectRouter, client: RestClient, deadline: number): Promise<void> {
  // Jobs left "running" by a worker that was stopped are picked up again.
  await db
    .from('router_jobs')
    .update({ status: 'queued', started_at: null })
    .eq('router_id', router.id)
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - STALE_RUNNING_MS).toISOString());

  while (Date.now() < deadline) {
    let q = db.from('router_jobs').select(JOB_COLUMNS).eq('router_id', router.id).eq('status', 'queued');
    if (router.status === 'pending') q = q.eq('type', 'test_connection');
    const { data: job } = await q.order('created_at').limit(1).maybeSingle<Job>();
    if (!job) return;

    if (job.attempts >= MAX_SENDS) {
      const last = typeof job.result?.last_error === 'string' ? ` ${job.result.last_error}` : '';
      await finishJob(db, job.id, false, { ...(job.result ?? {}), error: `The router could not be reached after ${MAX_SENDS} tries.${last}` });
      continue;
    }
    // Claim: only one worker can move a job from queued to running.
    const { data: claimed } = await db
      .from('router_jobs')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id');
    if (!claimed?.length) continue;
    job.attempts += 1;

    try {
      const done = await runJob(db, router, client, job, deadline);
      if (!done) return;
    } catch (err) {
      const msg = message(err);
      if (transient(err) && job.attempts < MAX_SENDS) {
        // Router unreachable for now: try again on the next wake-up.
        await db.from('router_jobs').update({ status: 'queued', started_at: null, result: { ...(job.result ?? {}), last_error: msg } }).eq('id', job.id);
        return;
      }
      await finishJob(db, job.id, false, { ...(job.result ?? {}), error: msg });
      if (transient(err)) return;
    }
  }
}

// ---------------------------------------------------------------------------
// Minute tick: status and users report
// ---------------------------------------------------------------------------

async function checkRouter(db: SupabaseClient, router: DirectRouter, client: RestClient): Promise<boolean> {
  try {
    const usage = await readUsage(client);
    await db
      .from('routers')
      .update({
        status: 'online',
        last_seen_at: new Date().toISOString(),
        last_error: null,
        model: str(usage.info['board-name']),
        ros_version: str(usage.info.version),
      })
      .eq('id', router.id);
    router.status = 'online';

    const result = await applyUsage(db, router, usage);
    if (result) {
      for (const k of result.kick ?? []) await closeSessions(client, k.code, null);
      const removed: string[] = [];
      for (const r of (result.remove ?? []).slice(0, 100)) if (await removeExpired(client, r)) removed.push(r.id);
      await markRemoved(db, router, removed);
    }
    await resumeUnfinishedPushes(db, router);
    return true;
  } catch (err) {
    const msg = message(err);
    if (router.status !== 'offline' || router.last_error !== msg) {
      await db.from('routers').update({ status: 'offline', last_error: msg }).eq('id', router.id);
      await db.from('active_sessions').delete().eq('router_id', router.id);
    }
    router.status = 'offline';
    return false;
  }
}

async function serveRouter(db: SupabaseClient, router: DirectRouter, tick: boolean, deadline: number): Promise<string> {
  let client: RestClient;
  try {
    client = await clientFor(db, router);
  } catch (err) {
    await db.from('routers').update({ last_error: message(err) }).eq('id', router.id);
    return `${router.name}: ${message(err)}`;
  }
  if (tick && router.status !== 'pending') {
    const reachable = await checkRouter(db, router, client);
    if (!reachable) return `${router.name}: offline`;
  }
  await runJobs(db, router, client, deadline);
  return `${router.name}: ok`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const db = serviceClient();
  const secret = req.headers.get('x-hzc-worker') ?? '';
  const { data: cfg } = await db.from('app_config').select('value').eq('key', 'direct_worker_secret').maybeSingle();
  if (!cfg?.value || secret !== cfg.value) return json({ error: 'Not allowed.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { router_id?: unknown };
  const routerId = typeof body.router_id === 'string' ? body.router_id : null;
  const deadline = Date.now() + BUDGET_MS;

  try {
    let q = db.from('routers').select(ROUTER_COLUMNS).eq('connection', 'direct');
    if (routerId) q = q.eq('id', routerId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const results = await Promise.all(((data ?? []) as DirectRouter[]).map((r) => serveRouter(db, r, routerId === null, deadline)));
    return json({ routers: results });
  } catch (err) {
    console.error(message(err));
    return json({ error: 'Server error.' }, 500);
  }
});
