// router-gateway: the endpoint every "cloud" router calls (every 30 s, and straight away while it
// has results to send). No user login: the router proves itself with the token from its setup
// script (header x-hzc-token), which is compared by SHA-256 with routers.token_hash.
//
// Each call: store what the router reported (job results, active users, counters), then answer
// with RouterOS script text for the next piece of work. See _shared/routeros.ts for the format.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { serviceClient } from '../_shared/auth.ts';
import {
  applyPortalInstalled,
  applyPortalRestored,
  applyPushResults,
  applyTestResult,
  applyUsage,
  clearDisconnected,
  finishJob,
  JOB_COLUMNS,
  markRemoved,
  MAX_SENDS,
  nextPushChunk,
  openJob,
  plansForSync,
  portalFilesUrl,
  portalTarget,
  profileOf,
  resumeUnfinishedPushes,
  str,
  type Job,
  type RouterRef,
} from '../_shared/jobs.ts';
import {
  disableBlock,
  disconnectBlock,
  emptyHotspotInfo,
  installPortalBlock,
  kickBlock,
  parseReport,
  pushBlock,
  removeBlock,
  restorePortalBlock,
  scriptBuilder,
  syncProfilesBlock,
  testBlock,
  toRouterOsTime,
  usageBlock,
  type Report,
  type ScriptBuilder,
} from '../_shared/routeros.ts';
import { PORTAL_FILES } from '../_shared/portal.ts';

const USAGE_EVERY_MS = 55_000;
const OFFLINE_AFTER_MS = 120_000;
const PUSH_CHUNK = 80;
const MAX_BODY = 200_000;

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Results reported by the router
// ---------------------------------------------------------------------------

async function handleResults(db: SupabaseClient, router: RouterRef, report: Report, out: ScriptBuilder): Promise<void> {
  for (const t of report.tests) {
    const job = await openJob(db, router.id, t.job);
    if (job) {
      const hotspot = report.hotspot ?? { ...emptyHotspotInfo(), servers: t.servers.map((name) => ({ name, interface: '', profile: '', address_pool: '', disabled: false })) };
      await applyTestResult(db, router, job, { board: t.board, version: t.version, uptime: t.uptime, hotspot });
    }
  }

  const pushesByJob = new Map<string, Report['pushes']>();
  for (const p of report.pushes) pushesByJob.set(p.job, [...(pushesByJob.get(p.job) ?? []), p]);
  for (const [jobId, items] of pushesByJob) {
    const job = await openJob(db, router.id, jobId);
    if (job) await applyPushResults(db, router, job, items);
  }

  for (const r of report.jobs) {
    const job = await openJob(db, router.id, r.job);
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
    const nums = r.detail.split(',').map((x) => Number(x) || 0);
    if (job.type === 'disable_voucher') {
      await finishJob(db, job.id, true, {
        disabled: (nums[0] ?? 0) > 0,
        sessions_closed: nums[1] ?? 0,
        ...((nums[0] ?? 0) > 0 ? {} : { note: 'The voucher was not on the router.' }),
      });
    } else if (job.type === 'disconnect_user') {
      await clearDisconnected(db, router, job);
      await finishJob(db, job.id, true, { sessions_closed: nums[0] ?? 0 });
    } else if (job.type === 'sync_profiles') {
      await finishJob(db, job.id, true, { profiles: nums[0] ?? 0 });
    } else if (job.type === 'install_portal') {
      const [current = '', dir = ''] = r.detail.split('|');
      const target = await portalTarget(db, router);
      await applyPortalInstalled(db, router, job, 'profile' in target ? target.profile : '', current, dir);
    } else if (job.type === 'restore_portal') {
      await applyPortalRestored(db, router, job, str(job.payload.dir) ?? '');
    } else {
      await finishJob(db, job.id, true, {});
    }
  }

  await markRemoved(db, router, report.removed);
  if (report.usage && router.status !== 'pending') {
    const result = await applyUsage(db, router, report.usage);
    if (result?.kick?.length) out.add(kickBlock(result.kick.map((k) => k.code)));
    if (result?.remove?.length) out.add(removeBlock(result.remove.slice(0, 100)));
    if (result?.kick?.length || result?.remove?.length) out.more();
  }
}

// ---------------------------------------------------------------------------
// Next piece of work for the router
// ---------------------------------------------------------------------------

/** Builds the commands for one job, or returns null when the job is already complete. */
async function jobBlock(db: SupabaseClient, router: RouterRef, job: Job): Promise<string | null> {
  switch (job.type) {
    case 'test_connection':
      return testBlock(job.id, router.hotspot_server ?? '');

    case 'sync_profiles': {
      const plans = await plansForSync(db, job);
      if (!plans.length) {
        await finishJob(db, job.id, true, { profiles: 0 });
        return null;
      }
      return syncProfilesBlock(job.id, plans.map(profileOf));
    }

    case 'push_vouchers': {
      const chunk = await nextPushChunk(db, router, job, PUSH_CHUNK);
      if (!chunk) return null;
      return pushBlock({
        jobId: job.id,
        profile: profileOf(chunk.plan),
        server: router.hotspot_server ?? 'all',
        limitUptime: toRouterOsTime(chunk.plan.uptime_seconds),
        limitBytes: chunk.plan.data_limit_mb ? String(chunk.plan.data_limit_mb * 1024 * 1024) : null,
        vouchers: chunk.vouchers,
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

    case 'install_portal': {
      const target = await portalTarget(db, router);
      if ('error' in target) {
        await finishJob(db, job.id, false, { error: target.error });
        return null;
      }
      return installPortalBlock(job.id, target.profile, portalFilesUrl(router.id), PORTAL_FILES);
    }

    case 'restore_portal': {
      const target = await portalTarget(db, router);
      if ('error' in target || !target.previousDir) {
        await finishJob(db, job.id, false, { error: 'error' in target ? target.error : 'Hotzonex does not know which login page the router used before.' });
        return null;
      }
      await db.from('router_jobs').update({ payload: { ...job.payload, dir: target.previousDir } }).eq('id', job.id);
      job.payload = { ...job.payload, dir: target.previousDir };
      return restorePortalBlock(job.id, target.profile, target.previousDir);
    }

    default:
      await finishJob(db, job.id, false, { error: `Unknown job type ${job.type}.` });
      return null;
  }
}

async function nextJob(db: SupabaseClient, router: RouterRef, out: ScriptBuilder): Promise<void> {
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

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Use POST.', 405);
  const token = req.headers.get('x-hzc-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return text('Unknown router.', 401);

  try {
    const db = serviceClient();
    const { data: router } = await db
      .from('routers')
      .select('id, name, status, host, hotspot_server, dns_name, last_usage_at')
      .eq('token_hash', await sha256Hex(token))
      .eq('connection', 'cloud')
      .maybeSingle<RouterRef>();
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
    await handleResults(db, router, report, out);

    const usageDue = !router.last_usage_at || now.getTime() - new Date(router.last_usage_at).getTime() > USAGE_EVERY_MS;
    // Collected now, delivered with the router's next scheduled call (no extra call needed).
    if (router.status !== 'pending' && !report.usage && usageDue) out.add(usageBlock());
    await nextJob(db, router, out);

    // Cloud routers that stopped calling are shown offline and their users cleared.
    const cutoff = new Date(now.getTime() - OFFLINE_AFTER_MS).toISOString();
    const { data: silent } = await db
      .from('routers')
      .update({ status: 'offline' })
      .eq('connection', 'cloud')
      .eq('status', 'online')
      .lt('last_seen_at', cutoff)
      .select('id');
    if (silent?.length) await db.from('active_sessions').delete().in('router_id', silent.map((r) => r.id));

    return text(out.build());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return text('Server error.', 500);
  }
});
