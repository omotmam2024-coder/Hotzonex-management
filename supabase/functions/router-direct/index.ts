// router-direct: runs work for routers Hotzonex calls itself, with the router's admin login:
//   connection = 'direct' : at a public IP address / DNS name (RouterOS REST API over the internet)
//   connection = 'tunnel' : through the admin's tunnel server (WireGuard + HTTPS relay on a VPS),
//                           for routers without a public IP. Nothing is scheduled on the router.
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
  installPortalDirect,
  pushVoucher,
  readUsage,
  removeExpired,
  checkPushed,
  ownCodeLength,
  removeExpiredRouterUsers,
  removeLeftoverProfiles,
  removeProfileIfUnused,
  matchRouterProfile,
  readRouterUsers,
  removeVoucherUsers,
  restorePortalDirect,
  upsertManagedProfile,
  RestClient,
  RouterError,
  routerProfileNames,
  type PushResult,
  type RouterUsers,
} from '../_shared/direct.ts';
import {
  applyPortalInstalled,
  applyPortalRestored,
  applyPushResults,
  recordPushCheck,
  applyRouterRemovals,
  applyTestResult,
  applyUsage,
  clearDisconnected,
  finishJob,
  finishProfileRemoval,
  finishVoucherDelete,
  JOB_COLUMNS,
  jobVouchers,
  linkedProfileNames,
  managedLinks,
  mikroticketProfileName,
  planLink,
  markRemoved,
  MAX_SENDS,
  nextPushChunk,
  ownProfiles,
  planProfileNames,
  portalFilesUrl,
  portalTarget,
  profileOf,
  resumeUnfinishedPushes,
  retireRemovedProfiles,
  str,
  type Job,
  type RouterRef,
} from '../_shared/jobs.ts';
import { PORTAL_FILES } from '../_shared/portal.ts';
import { emptyHotspotInfo, toRouterOsTime, type HotspotInfo } from '../_shared/routeros.ts';
import { relayRestUrl } from '../_shared/tunnel.ts';

interface DirectRouter extends RouterRef {
  connection: 'direct' | 'tunnel';
  tunnel_ip: string | null;
  host: string | null;
  port: number | null;
  use_https: boolean | null;
  username: string | null;
  password_enc: string | null;
  last_error: string | null;
  last_seen_at: string | null;
  hotspot_info: HotspotInfo | null;
}

const ROUTER_COLUMNS =
  'id, tenant_id, name, status, connection, tunnel_ip, hotspot_server, dns_name, last_usage_at, host, port, use_https, username, password_enc, last_error, last_seen_at, hotspot_info';
const BUDGET_MS = 100_000; // stay well inside the Edge Function time limit
const LEASE_MS = BUDGET_MS + 30_000; // one worker per router at a time; expires if a worker is stopped
const STALE_RUNNING_MS = 5 * 60_000;
const PUSH_CHUNK = 50;
// A router that was answering is shown offline only after missing two checks in a row (one minute
// apart): a short internet drop at the site does not flash it offline.
const OFFLINE_AFTER_MS = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const transient = (err: unknown) => err instanceof RouterError && (err.kind === 'timeout' || err.kind === 'unreachable');
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Relay {
  url: string;
  secret: string;
}

async function loadRelay(db: SupabaseClient): Promise<Relay | null> {
  const { data } = await db.from('app_config').select('key, value').in('key', ['tunnel_relay_url', 'tunnel_relay_secret']);
  const get = (k: string) => (data ?? []).find((r) => r.key === k)?.value as string | undefined;
  const url = get('tunnel_relay_url');
  const secret = get('tunnel_relay_secret');
  return url && secret ? { url, secret } : null;
}

async function clientFor(db: SupabaseClient, router: DirectRouter, relay: Relay | null): Promise<RestClient> {
  if (!router.host || !router.username || !router.password_enc) throw new RouterError('auth', 'The router address, username or password is missing. Edit the router.');
  const { data: key, error } = await db.rpc('router_secret_key');
  if (error || typeof key !== 'string') throw new Error('The router password key could not be read.');
  const port = router.port ?? (router.use_https ? 443 : 80);
  let via: { baseUrl: string; secret: string } | undefined;
  if (router.connection === 'tunnel') {
    if (!router.tunnel_ip) throw new RouterError('unreachable', 'This router has no tunnel address. Open the router and show its tunnel script again.');
    if (!relay) throw new RouterError('unreachable', 'The tunnel server is not set up yet. Open Routers → Tunnel server.');
    via = { baseUrl: relayRestUrl(relay.url, router.tunnel_ip, port), secret: relay.secret };
  }
  return new RestClient({
    host: router.connection === 'tunnel' ? (router.tunnel_ip ?? router.host) : router.host,
    port,
    useHttps: router.connection === 'tunnel' ? false : Boolean(router.use_https),
    username: router.username,
    password: await decryptSecret(router.password_enc, key),
    relay: via,
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
        await applyTestResult(db, router, job, await directTest(client));
      } catch (err) {
        const msg = message(err);
        // Not reachable yet (for example the tunnel script is not pasted yet): show why, try again next minute.
        if (transient(err) && job.attempts < MAX_SENDS) {
          await db.from('routers').update({ last_error: msg }).eq('id', router.id);
          throw err;
        }
        await db
          .from('routers')
          .update({ last_error: msg, ...(router.status === 'online' ? { status: 'offline' } : {}) })
          .eq('id', router.id);
        await finishJob(db, job.id, false, { error: msg });
      }
      return true;
    }

    case 'sync_profiles': {
      // A plan deleted in Hotzonex: its profile goes from the router too (unless users are on it).
      const removeProfile = str(job.payload.remove_profile);
      if (removeProfile) {
        const r = await removeProfileIfUnused(client, removeProfile);
        await finishProfileRemoval(db, router, job, r.users);
        return true;
      }
      // The plans ticked for this router whose profile Hotzonex makes: the profile is brought in step
      // with the plan (added, renamed, speed and devices per code). The router's own profiles
      // (MikroTicket's) are never changed.
      const planId = str(job.payload.plan_id);
      const done: Record<string, string> = {};
      for (const link of await managedLinks(db, router, planId)) {
        const name = mikroticketProfileName(link.plan);
        done[link.plan.name] = await upsertManagedProfile(client, {
          name,
          previousName: link.profile_name,
          rateLimit: link.plan.rate_limit,
          sharedUsers: link.plan.shared_users,
        });
        if (name !== link.profile_name) {
          await db.from('plan_routers').update({ profile_name: name }).eq('router_id', router.id).eq('plan_id', link.plan_id);
        }
      }
      const keep = new Set([...(await planProfileNames(db, router)), ...(await linkedProfileNames(db, router))]);
      const removed = await removeLeftoverProfiles(client, keep);
      await finishJob(db, job.id, true, { managed: done, removed });
      return true;
    }

    case 'push_vouchers': {
      let users: RouterUsers | null = null;
      let profiles: string[] | null = null;
      for (;;) {
        if (Date.now() > deadline) {
          // Out of time: continue on the next wake-up (progress is already saved).
          await db.from('router_jobs').update({ status: 'queued', started_at: null }).eq('id', job.id);
          return false;
        }
        const chunk = await nextPushChunk(db, router, job, PUSH_CHUNK);
        if (!chunk) return true;
        users ??= await readRouterUsers(client);
        profiles ??= await routerProfileNames(client);
        // A router with its own profiles (MikroTicket's): its matching profile is used, nothing is added.
        // A router without any: Hotzonex adds the plan's profile.
        const ownProfiles = profiles.filter((n) => n !== 'default' && !n.startsWith('hzc-'));
        let profile = chunk.plan.router_profile_name;
        const link = await planLink(db, router, chunk.plan.id);
        if (link?.managed) {
          // Hotzonex's own profile for this plan: made now if the router does not have it yet.
          await upsertManagedProfile(client, { name: link.profile_name, previousName: link.profile_name, rateLimit: chunk.plan.rate_limit, sharedUsers: chunk.plan.shared_users });
          profiles = null;
          profile = link.profile_name;
        } else if (link && profiles.includes(link.profile_name)) {
          profile = link.profile_name;
        } else if (ownProfiles.length) {
          const match = matchRouterProfile(profile, profiles);
          if (!match) {
            await finishJob(db, job.id, false, {
              ...(job.result ?? {}),
              error: `${router.name} has no user profile for this plan (${profile.replace(/^profile_(.+?)-se:.*$/, '$1')}). Make the profile on the router (e.g. in MikroTicket) or choose another plan; nothing was added to the router.`,
            });
            return true;
          }
          profile = match;
        } else {
          await ensureProfileExists(client, profileOf(chunk.plan));
        }
        if (!job.result?.password_style) {
          job.result = { ...(job.result ?? {}), profile, password_style: users.passwordStyle, password_sample: users.sample };
          await db.from('router_jobs').update({ result: job.result }).eq('id', job.id);
        }
        const opts = {
          profile,
          password: users.passwordStyle,
          server: router.hotspot_server ?? 'all',
          limitUptime: toRouterOsTime(chunk.plan.uptime_seconds),
          limitBytes: chunk.plan.data_limit_mb ? String(chunk.plan.data_limit_mb * 1024 * 1024) : null,
        };
        const items: { voucher: string; result: PushResult }[] = [];
        try {
          for (const v of chunk.vouchers) items.push({ voucher: v.id, result: await pushVoucher(client, v, opts, users.comments) });
        } finally {
          await applyPushResults(db, router, job, items);
        }
        // Checked on the router itself: every card is there, on the right profile, as long as the router's own cards.
        await recordPushCheck(db, job, {
          ...(await checkPushed(
            client,
            chunk.vouchers.filter((v) => items.some((i) => i.voucher === v.id && (i.result === 'added' || i.result === 'already'))).map((v) => v.code),
            profile,
          )),
          codeLength: chunk.vouchers[0]?.code.length ?? 0,
          ownLength: ownCodeLength(users.comments.keys(), users.comments),
        });
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
      // Vouchers deleted in Hotzonex: deleted from the router, then from Hotzonex.
      if (job.payload.delete === true) {
        await finishVoucherDelete(db, job, await removeVoucherUsers(client, jobVouchers(job)));
        return true;
      }
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

    case 'install_portal': {
      const target = await portalTarget(db, router);
      if ('error' in target) {
        await finishJob(db, job.id, false, { error: target.error });
        return true;
      }
      const { current, dir } = await installPortalDirect(client, target.profile, portalFilesUrl(router.id), PORTAL_FILES);
      await applyPortalInstalled(db, router, job, target.profile, current, dir);
      return true;
    }

    case 'restore_portal': {
      const target = await portalTarget(db, router);
      if ('error' in target || !target.previousDir) {
        await finishJob(db, job.id, false, { error: 'error' in target ? target.error : 'Hotzonex does not know which login page the router used before.' });
        return true;
      }
      await restorePortalDirect(client, target.profile, target.previousDir);
      await applyPortalRestored(db, router, job, target.previousDir);
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
      // A voided voucher must be switched off whenever the router is back, however long it is away.
      const keepTrying = job.type === 'disable_voucher';
      if (transient(err) && (keepTrying || job.attempts < MAX_SENDS)) {
        // Router unreachable for now: try again on the next wake-up.
        await db
          .from('router_jobs')
          .update({ status: 'queued', started_at: null, attempts: keepTrying ? job.attempts - 1 : job.attempts, result: { ...(job.result ?? {}), last_error: msg } })
          .eq('id', job.id);
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

async function checkRouter(db: SupabaseClient, router: DirectRouter, client: RestClient, deadline: number): Promise<boolean> {
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

    // The router's user profiles, kept current: a new MikroTicket profile becomes a plan (database trigger).
    // A profile deleted on the router takes its plan with it (or switches it off when it has sales).
    const known = router.hotspot_info?.user_profiles ?? [];
    if (usage.userProfiles.length && JSON.stringify(known) !== JSON.stringify(usage.userProfiles)) {
      const info = { ...(router.hotspot_info ?? emptyHotspotInfo()), user_profiles: usage.userProfiles };
      const { error: infoError } = await db.from('routers').update({ hotspot_info: info }).eq('id', router.id);
      if (infoError) console.error(`Profiles not saved for ${router.name}: ${infoError.message}`);
      else {
        router.hotspot_info = info;
        const retired = await retireRemovedProfiles(db, router, known.map((p) => p.name), usage.userProfiles.map((p) => p.name));
        if (Object.keys(retired).length) console.log(`${router.name}: profiles removed on the router: ${JSON.stringify(retired)}`);
      }
    }

    const result = await applyUsage(db, router, usage);
    // User counts and first logins of every hotspot user (MikroTicket vouchers too), for the reports.
    const { error: loginsError } = await db.rpc('record_router_logins', {
      p_router_id: router.id,
      p_sessions: usage.sessions.map((a) => ({ code: a.code, uptime: a.uptime })),
      p_users: usage.allUsers,
    });
    if (loginsError) console.error(`Router logins not recorded for ${router.name}: ${loginsError.message}`);
    // Hotspot users deleted on the router are deleted in Hotzonex too.
    try {
      await applyRouterRemovals(db, router, new Set(usage.allUsers.map((u) => u.name)));
    } catch (err) {
      console.error(`Removed users not synced for ${router.name}: ${message(err)}`);
    }
    // MikroTicket cards whose time is over are deleted from the router (their sales stay in Hotzonex).
    try {
      const gone = await removeExpiredRouterUsers(client, deadline);
      if (gone.length) {
        console.log(`${router.name}: removed ${gone.length} expired cards`);
        await db.from('audit_log').insert({
          tenant_id: router.tenant_id,
          user_id: null,
          action: 'router.expired_cards_removed',
          details: { router_id: router.id, name: router.name, count: gone.length, codes: gone },
        });
      }
    } catch (err) {
      console.warn(`${router.name}: expired cards not removed: ${message(err)}`);
    }
    if (result) {
      // Each kick and removal on its own: one that fails is tried again next minute and does not
      // make the router look offline.
      for (const k of result.kick ?? []) {
        if (Date.now() > deadline) break;
        try {
          await closeSessions(client, k.code, null);
        } catch (err) {
          console.warn(`${router.name}: could not disconnect ${k.code}: ${message(err)}`);
        }
      }
      const removed: string[] = [];
      for (const r of (result.remove ?? []).slice(0, 100)) {
        if (Date.now() > deadline) break;
        try {
          if (await removeExpired(client, r)) removed.push(r.id);
        } catch (err) {
          console.warn(`${router.name}: could not remove ${r.code}: ${message(err)}`);
        }
      }
      await markRemoved(db, router, removed);
    }
    await resumeUnfinishedPushes(db, router);
    return true;
  } catch (err) {
    const msg = message(err);
    const lastSeen = router.last_seen_at ? Date.parse(router.last_seen_at) : 0;
    if (router.status === 'online' && transient(err) && Date.now() - lastSeen < OFFLINE_AFTER_MS) {
      console.warn(`${router.name}: missed one check (${msg}); still shown online`);
      return false;
    }
    if (router.status !== 'offline' || router.last_error !== msg) {
      await db.from('routers').update({ status: 'offline', last_error: msg }).eq('id', router.id);
      await db.from('active_sessions').delete().eq('router_id', router.id);
    }
    router.status = 'offline';
    return false;
  }
}

async function serveRouter(db: SupabaseClient, router: DirectRouter, relay: Relay | null, tick: boolean, deadline: number): Promise<string> {
  // Another worker is busy with this router (a long push, or the previous minute's check):
  // it also picks up newly queued jobs, so this one stops here.
  const now = new Date();
  const { data: leased } = await db
    .from('routers')
    .update({ worker_lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq('id', router.id)
    .or(`worker_lease_until.is.null,worker_lease_until.lt."${now.toISOString()}"`)
    .select('id');
  if (!leased?.length) return `${router.name}: busy`;
  try {
    return await serveLeased(db, router, relay, tick, deadline);
  } finally {
    await db.from('routers').update({ worker_lease_until: null }).eq('id', router.id);
  }
}

async function serveLeased(db: SupabaseClient, router: DirectRouter, relay: Relay | null, tick: boolean, deadline: number): Promise<string> {
  let client: RestClient;
  try {
    client = await clientFor(db, router, relay);
  } catch (err) {
    await db.from('routers').update({ last_error: message(err) }).eq('id', router.id);
    return `${router.name}: ${message(err)}`;
  }
  if (tick && router.status !== 'pending') {
    const reachable = await checkRouter(db, router, client, deadline);
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
    let q = db.from('routers').select(ROUTER_COLUMNS).in('connection', ['direct', 'tunnel']);
    if (routerId) q = q.eq('id', routerId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const routers = (data ?? []) as DirectRouter[];
    const relay = routers.some((r) => r.connection === 'tunnel') ? await loadRelay(db) : null;
    const results = await Promise.all(routers.map((r) => serveRouter(db, r, relay, routerId === null, deadline)));
    return json({ routers: results });
  } catch (err) {
    console.error(message(err));
    return json({ error: 'Server error.' }, 500);
  }
});
