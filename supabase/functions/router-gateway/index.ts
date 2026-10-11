// router-gateway: the endpoint every MikroTik router calls (every 30 s, and straight away
// while it has results to send). No user login: the router proves itself with the token from
// its setup script (header x-hzc-token), which is compared by SHA-256 with routers.token_hash.
//
// Each call: store what the router reported (job results, active users, counters), then answer
// with RouterOS script text for the next piece of work. See _shared/routeros.ts for the format.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { serviceClient } from '../_shared/auth.ts';
import {
  disableBlock,
  disconnectBlock,
  kickBlock,
  parseReport,
  pushBlock,
  removeBlock,
  scriptBuilder,
  syncProfilesBlock,
  testBlock,
  toRouterOsTime,
  usageBlock,
  type ProfileSpec,
  type Report,
  type ScriptBuilder,
} from '../_shared/routeros.ts';

interface Router {
  id: string;
  name: string;
  status: 'pending' | 'online' | 'offline';
  hotspot_server: string;
  dns_name: string;
  last_usage_at: string | null;
}

interface Job {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_by: string | null;
  result: Record<string, unknown> | null;
}

interface PlanRow {
  id: string;
  uptime_seconds: number;
  rate_limit: string | null;
  data_limit_mb: number | null;
  shared_users: number;
  router_profile_name: string;
}

const USAGE_EVERY_MS = 55_000;
const OFFLINE_AFTER_MS = 120_000;
const PUSH_CHUNK = 80;
const MAX_SENDS = 3;
const MAX_BODY = 200_000;
const JOB_COLUMNS = 'id, type, status, payload, attempts, created_by, result';
const PLAN_COLUMNS = 'id, uptime_seconds, rate_limit, data_limit_mb, shared_users, router_profile_name';

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const profileOf = (p: PlanRow): ProfileSpec => ({ name: p.router_profile_name, rateLimit: p.rate_limit, sharedUsers: p.shared_users });

async function finishJob(db: SupabaseClient, jobId: string, ok: boolean, result: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('router_jobs')
    .update({ status: ok ? 'done' : 'failed', result, finished_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);
  if (error) console.error(`Could not finish job ${jobId}: ${error.message}`);
}

async function loadJob(db: SupabaseClient, routerId: string, jobId: string): Promise<Job | null> {
  const { data } = await db.from('router_jobs').select(JOB_COLUMNS).eq('id', jobId).eq('router_id', routerId).maybeSingle<Job>();
  return data && (data.status === 'running' || data.status === 'queued') ? data : null;
}

// ---------------------------------------------------------------------------
// Results reported by the router
// ---------------------------------------------------------------------------

async function handleTests(db: SupabaseClient, router: Router, report: Report): Promise<void> {
  for (const t of report.tests) {
    const job = await loadJob(db, router.id, t.job);
    if (!job) continue;
    if (!t.found) {
      const message =
        `Hotspot server "${router.hotspot_server}" was not found on this router.` +
        (t.servers.length
          ? ` Hotspot servers on this router: ${t.servers.join(', ')}. Edit the router and enter one of these names.`
          : ' This router has no hotspot set up yet (Winbox → IP → Hotspot → Hotspot Setup).');
      await db.from('routers').update({ last_error: message, model: t.board || null, ros_version: t.version || null }).eq('id', router.id);
      await finishJob(db, job.id, false, { error: message });
      continue;
    }

    const warnings: string[] = [];
    if (t.dns.toLowerCase() !== router.dns_name.toLowerCase()) {
      warnings.push(
        t.dns
          ? `The router's hotspot DNS name is "${t.dns}", but you entered "${router.dns_name}". Cards will print "${router.dns_name}".`
          : `The router's hotspot profile has no DNS name set. Cards will print "${router.dns_name}".`,
      );
    }
    const wasPending = router.status === 'pending';
    await db
      .from('routers')
      .update({ status: 'online', last_seen_at: new Date().toISOString(), model: t.board || null, ros_version: t.version || null, last_error: null })
      .eq('id', router.id);
    router.status = 'online';
    if (wasPending) {
      await db.from('audit_log').insert({ user_id: job.created_by, action: 'router.added', details: { router_id: router.id, name: router.name } });
      // A new router gets every plan's hotspot profile straight away.
      await db.from('router_jobs').insert({ router_id: router.id, type: 'sync_profiles', payload: {}, created_by: job.created_by });
    }
    await finishJob(db, job.id, true, { model: t.board, ros_version: t.version, uptime: t.uptime, warnings });
  }
}

async function handlePushes(db: SupabaseClient, router: Router, report: Report): Promise<void> {
  const byJob = new Map<string, Report['pushes']>();
  for (const p of report.pushes) byJob.set(p.job, [...(byJob.get(p.job) ?? []), p]);

  for (const [jobId, items] of byJob) {
    const job = await loadJob(db, router.id, jobId);
    if (!job) continue;
    const ids = (r: string) => items.filter((i) => i.result === r).map((i) => i.voucher);
    const added = ids('added');
    const already = ids('already');
    const conflicts = ids('conflict');
    const errors = ids('error').length;

    const onRouter = [...added, ...already];
    if (onRouter.length) await db.from('vouchers').update({ on_router: true }).in('id', onRouter).eq('router_id', router.id);
    let conflictCodes: string[] = [];
    if (conflicts.length) {
      // The code belongs to another hotspot user on this router; the voucher is taken out of stock.
      const { data } = await db.from('vouchers').update({ status: 'disabled' }).in('id', conflicts).eq('on_router', false).select('code');
      conflictCodes = (data ?? []).map((v) => v.code as string);
    }

    const prev = job.result ?? {};
    const num = (k: string) => (typeof prev[k] === 'number' ? (prev[k] as number) : 0);
    const result = {
      added: num('added') + added.length,
      already_on_router: num('already_on_router') + already.length,
      conflicts: [...(Array.isArray(prev.conflicts) ? (prev.conflicts as string[]) : []), ...conflictCodes],
      errors: num('errors') + errors,
    };
    const progress = onRouter.length + conflicts.length > 0;
    await db
      .from('router_jobs')
      .update({ result, ...(progress ? { attempts: 0 } : {}) })
      .eq('id', job.id);
  }
}

async function handleJobResults(db: SupabaseClient, router: Router, report: Report): Promise<void> {
  for (const r of report.jobs) {
    const job = await loadJob(db, router.id, r.job);
    if (!job) continue;
    if (!r.ok) {
      // A failed push block is retried (attempts limit); other jobs fail with the router's reason.
      if (job.type === 'push_vouchers') {
        await db.from('router_jobs').update({ result: { ...(job.result ?? {}), last_error: r.detail } }).eq('id', job.id);
      } else {
        await finishJob(db, job.id, false, { error: r.detail || 'The router could not finish this job.' });
      }
      continue;
    }
    const nums = r.detail.split(',').map((n) => Number(n) || 0);
    if (job.type === 'disable_voucher') {
      await finishJob(db, job.id, true, {
        disabled: (nums[0] ?? 0) > 0,
        sessions_closed: nums[1] ?? 0,
        ...((nums[0] ?? 0) > 0 ? {} : { note: 'The voucher was not on the router.' }),
      });
    } else if (job.type === 'disconnect_user') {
      const code = str(job.payload.code);
      const mac = str(job.payload.mac_address);
      if (code) {
        let q = db.from('active_sessions').delete().eq('router_id', router.id).eq('code', code);
        if (mac) q = q.eq('mac_address', mac);
        await q;
      }
      await finishJob(db, job.id, true, { sessions_closed: nums[0] ?? 0 });
    } else if (job.type === 'sync_profiles') {
      await finishJob(db, job.id, true, { profiles: nums[0] ?? 0 });
    } else {
      await finishJob(db, job.id, true, {});
    }
  }
}

interface SyncResult {
  synced_at: string;
  remove: { id: string; code: string }[];
  kick: { id: string; code: string }[];
}

async function handleUsage(db: SupabaseClient, router: Router, report: Report, out: ScriptBuilder): Promise<void> {
  if (report.removed.length) {
    await db.from('vouchers').update({ on_router: false }).in('id', report.removed).eq('router_id', router.id);
  }
  if (!report.usage || router.status === 'pending') return;

  const { data, error } = await db.rpc('sync_router_usage', {
    p_router_id: router.id,
    p_sessions: report.usage.sessions,
    p_users: report.usage.users,
  });
  if (error) {
    console.error(`Usage sync failed for ${router.name}: ${error.message}`);
    return;
  }
  const result = data as SyncResult;
  // Sessions not in this report have ended: the database stamped every current one with synced_at.
  await db.from('active_sessions').delete().eq('router_id', router.id).lt('updated_at', result.synced_at);
  await db.from('routers').update({ last_usage_at: new Date().toISOString() }).eq('id', router.id);
  router.last_usage_at = new Date().toISOString();

  if (result.kick?.length) out.add(kickBlock(result.kick.map((k) => k.code)));
  if (result.remove?.length) out.add(removeBlock(result.remove.slice(0, 100)));
  if (result.kick?.length || result.remove?.length) out.more();
}

// ---------------------------------------------------------------------------
// Next piece of work for the router
// ---------------------------------------------------------------------------

/** Builds the commands for one job, or returns null when the job is already complete. */
async function jobBlock(db: SupabaseClient, router: Router, job: Job): Promise<string | null> {
  switch (job.type) {
    case 'test_connection':
      return testBlock(job.id, router.hotspot_server);

    case 'sync_profiles': {
      const planId = str(job.payload.plan_id);
      let q = db.from('plans').select(PLAN_COLUMNS);
      q = planId ? q.eq('id', planId) : q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw new Error(`Could not load plans: ${error.message}`);
      const plans = (data ?? []) as PlanRow[];
      if (!plans.length) {
        await finishJob(db, job.id, true, { profiles: 0 });
        return null;
      }
      return syncProfilesBlock(job.id, plans.map(profileOf));
    }

    case 'push_vouchers': {
      const batchId = str(job.payload.batch_id);
      const { data: batch } = batchId
        ? await db.from('voucher_batches').select('id, router_id, plan_id').eq('id', batchId).maybeSingle()
        : { data: null };
      if (!batch || batch.router_id !== router.id) {
        await finishJob(db, job.id, false, { error: 'This batch no longer exists.' });
        return null;
      }
      const { data: plan } = await db.from('plans').select(PLAN_COLUMNS).eq('id', batch.plan_id).maybeSingle<PlanRow>();
      if (!plan) {
        await finishJob(db, job.id, false, { error: 'This plan no longer exists.' });
        return null;
      }
      const { data: vouchers, error } = await db
        .from('vouchers')
        .select('id, code')
        .eq('batch_id', batch.id)
        .eq('on_router', false)
        .eq('status', 'unused')
        .order('id')
        .limit(PUSH_CHUNK);
      if (error) throw new Error(`Could not load vouchers: ${error.message}`);
      if (!vouchers?.length) {
        const r = job.result ?? {};
        const conflicts = Array.isArray(r.conflicts) ? (r.conflicts as string[]) : [];
        await finishJob(db, job.id, true, {
          ...r,
          ...(conflicts.length
            ? { warning: `${conflicts.length} code(s) already belonged to other hotspot users on ${router.name} and were disabled.` }
            : {}),
        });
        return null;
      }
      return pushBlock({
        jobId: job.id,
        profile: profileOf(plan),
        server: router.hotspot_server,
        limitUptime: toRouterOsTime(plan.uptime_seconds),
        limitBytes: plan.data_limit_mb ? String(plan.data_limit_mb * 1024 * 1024) : null,
        vouchers: vouchers.map((v) => ({ id: v.id as string, code: v.code as string })),
      });
    }

    case 'disable_voucher': {
      const voucherId = str(job.payload.voucher_id);
      const code = str(job.payload.code);
      if (!voucherId || !code) {
        await finishJob(db, job.id, false, { error: 'The job has no voucher.' });
        return null;
      }
      return disableBlock(job.id, voucherId, code);
    }

    case 'disconnect_user': {
      const code = str(job.payload.code);
      if (!code) {
        await finishJob(db, job.id, false, { error: 'The job has no user.' });
        return null;
      }
      return disconnectBlock(job.id, code, str(job.payload.mac_address));
    }

    default:
      await finishJob(db, job.id, false, { error: `Unknown job type ${job.type}.` });
      return null;
  }
}

async function nextJob(db: SupabaseClient, router: Router, out: ScriptBuilder): Promise<void> {
  for (let guard = 0; guard < 6; guard++) {
    // A job sent earlier whose results did not come back is sent again (all commands are safe to repeat).
    let q = db.from('router_jobs').select(JOB_COLUMNS).eq('router_id', router.id).eq('status', 'running');
    if (router.status === 'pending') q = q.eq('type', 'test_connection');
    let { data: job } = await q.order('created_at').limit(1).maybeSingle<Job>();
    if (!job) {
      let queued = db.from('router_jobs').select(JOB_COLUMNS).eq('router_id', router.id).eq('status', 'queued');
      if (router.status === 'pending') queued = queued.eq('type', 'test_connection');
      ({ data: job } = await queued.order('created_at').limit(1).maybeSingle<Job>());
    }
    if (!job) {
      if (router.status !== 'pending') await resumeUnfinishedPushes(db, router);
      return;
    }

    if (job.attempts >= MAX_SENDS) {
      const last = typeof job.result?.last_error === 'string' ? ` ${job.result.last_error}` : '';
      await finishJob(db, job.id, false, { ...(job.result ?? {}), error: `The router did not finish this job after ${MAX_SENDS} tries.${last}` });
      continue;
    }

    let block: string | null;
    try {
      block = await jobBlock(db, router, job);
    } catch (err) {
      console.error(`Job ${job.id} could not be prepared: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (block === null) continue;

    await db
      .from('router_jobs')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id);
    out.add(block);
    out.more();
    return;
  }
}

const RETRY_PUSH_AFTER_MS = 5 * 60_000;

/** Re-queues vouchers that never reached the router (e.g. a push that gave up), at most every 5 minutes per batch. */
async function resumeUnfinishedPushes(db: SupabaseClient, router: Router): Promise<void> {
  const { data: pending } = await db
    .from('vouchers')
    .select('batch_id')
    .eq('router_id', router.id)
    .eq('on_router', false)
    .eq('status', 'unused')
    .limit(1);
  const batchId = pending?.[0]?.batch_id as string | undefined;
  if (!batchId) return;
  const { data: lastJob } = await db
    .from('router_jobs')
    .select('status, finished_at')
    .eq('type', 'push_vouchers')
    .eq('payload->>batch_id', batchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastJob && (lastJob.status === 'queued' || lastJob.status === 'running')) return;
  if (lastJob?.finished_at && Date.now() - new Date(lastJob.finished_at).getTime() < RETRY_PUSH_AFTER_MS) return;
  await db.from('router_jobs').insert({ router_id: router.id, type: 'push_vouchers', payload: { batch_id: batchId, resumed: true } });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Use POST.', 405);
  const token = req.headers.get('x-hzc-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return text('Unknown router.', 401);

  try {
    const db = serviceClient();
    const { data: router } = await db
      .from('routers')
      .select('id, name, status, hotspot_server, dns_name, last_usage_at')
      .eq('token_hash', await sha256Hex(token))
      .maybeSingle<Router>();
    if (!router) return text('Unknown router. Copy the setup script again from the Routers page.', 401);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return text('Report too large.', 413);
    const report = parseReport(raw);
    for (const e of report.errors) console.warn(`Router ${router.name}: ${e}`);

    const now = new Date();
    await db
      .from('routers')
      .update({
        last_seen_at: now.toISOString(),
        ...(router.status === 'offline' ? { status: 'online' } : {}),
        ...(report.info ? { model: report.info.board || null, ros_version: report.info.version || null } : {}),
      })
      .eq('id', router.id);
    if (router.status === 'offline') router.status = 'online';

    const out = scriptBuilder();
    await handleTests(db, router, report);
    await handlePushes(db, router, report);
    await handleJobResults(db, router, report);
    await handleUsage(db, router, report, out);

    const usageDue = !router.last_usage_at || now.getTime() - new Date(router.last_usage_at).getTime() > USAGE_EVERY_MS;
    // Collected now, delivered with the router's next scheduled call (no extra call needed).
    if (router.status !== 'pending' && !report.usage && usageDue) out.add(usageBlock());
    await nextJob(db, router, out);

    // Routers that stopped calling are shown offline and their users cleared.
    const cutoff = new Date(now.getTime() - OFFLINE_AFTER_MS).toISOString();
    const { data: silent } = await db.from('routers').update({ status: 'offline' }).eq('status', 'online').lt('last_seen_at', cutoff).select('id');
    if (silent?.length) await db.from('active_sessions').delete().in('router_id', silent.map((r) => r.id));

    return text(out.build());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return text('Server error.', 500);
  }
});
