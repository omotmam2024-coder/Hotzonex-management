// Job bookkeeping shared by both connection types (router-gateway for routers that call in,
// router-direct for routers reached by IP address). Only database work lives here; talking to
// the router is done by the caller.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { pickHotspot, type ActiveRow, type HotspotInfo, type ProfileSpec, type UserUsage } from './routeros.ts';

export interface RouterRef {
  id: string;
  /** The business the router belongs to: plans and records come from it only. */
  tenant_id: string;
  name: string;
  status: 'pending' | 'online' | 'offline';
  host: string | null;
  hotspot_server: string | null;
  dns_name: string | null;
  last_usage_at: string | null;
}

export interface Job {
  id: string;
  router_id: string | null;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_by: string | null;
  result: Record<string, unknown> | null;
}

export interface PlanRow {
  id: string;
  uptime_seconds: number;
  rate_limit: string | null;
  data_limit_mb: number | null;
  shared_users: number;
  router_profile_name: string;
}

export const JOB_COLUMNS = 'id, router_id, type, status, payload, attempts, created_by, result';
export const PLAN_COLUMNS = 'id, uptime_seconds, rate_limit, data_limit_mb, shared_users, router_profile_name';
export const MAX_SENDS = 3;

export const str = (v: unknown) => (typeof v === 'string' ? v : null);
export const profileOf = (p: PlanRow): ProfileSpec => ({ name: p.router_profile_name, rateLimit: p.rate_limit, sharedUsers: p.shared_users });

export async function finishJob(db: SupabaseClient, jobId: string, ok: boolean, result: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('router_jobs')
    .update({ status: ok ? 'done' : 'failed', result, finished_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);
  if (error) console.error(`Could not finish job ${jobId}: ${error.message}`);
}

/** A job of this router that is still open (queued or running), or null. */
export async function openJob(db: SupabaseClient, routerId: string, jobId: string): Promise<Job | null> {
  const { data } = await db.from('router_jobs').select(JOB_COLUMNS).eq('id', jobId).eq('router_id', routerId).maybeSingle<Job>();
  return data && (data.status === 'running' || data.status === 'queued') ? data : null;
}

export interface TestOutcome {
  board: string;
  version: string;
  uptime: string;
  hotspot: HotspotInfo;
}

/**
 * Saves a connection test: a read-only snapshot of the router's own hotspot setup, and which of
 * its running hotspot servers Hotzonex uses (with its DNS name). A router's first passing test also
 * queues the plans' user profiles (added only where the router has none with that name).
 */
export async function applyTestResult(db: SupabaseClient, router: RouterRef, job: Job, t: TestOutcome): Promise<void> {
  const base = { model: t.board || null, ros_version: t.version || null, hotspot_info: t.hotspot };
  const choice = pickHotspot(t.hotspot, router.hotspot_server);
  if (!choice.ok) {
    await db.from('routers').update({ ...base, last_error: choice.error }).eq('id', router.id);
    await finishJob(db, job.id, false, { error: choice.error });
    return;
  }

  const warnings: string[] = [];
  const dnsName = router.dns_name ?? (choice.dns || router.host || choice.server);
  if (!choice.dns && !router.dns_name) {
    warnings.push(`The router's hotspot has no DNS name set, so cards will show "${dnsName}" as the login address. You can change it on this router's page.`);
  } else if (router.dns_name && choice.dns.toLowerCase() !== router.dns_name.toLowerCase()) {
    warnings.push(`The router's hotspot DNS name is "${choice.dns}", but this router is set to print "${router.dns_name}" on cards.`);
  }
  const { data: plans } = await db.from('plans').select('name, router_profile_name').eq('tenant_id', router.tenant_id).eq('is_active', true);
  const onRouter = new Set(t.hotspot.user_profiles.map((p) => p.name));
  const missing = (plans ?? []).filter((p) => !onRouter.has(p.router_profile_name as string));
  if (missing.length) {
    warnings.push(
      `Hotzonex will add a user profile for these plans: ${missing.map((p) => p.name).join(', ')}. The router's existing profiles are not changed.`,
    );
  }

  const wasPending = router.status === 'pending';
  await db
    .from('routers')
    .update({ ...base, status: 'online', last_seen_at: new Date().toISOString(), last_error: null, hotspot_server: choice.server, dns_name: dnsName })
    .eq('id', router.id);
  router.status = 'online';
  router.hotspot_server = choice.server;
  router.dns_name = dnsName;
  if (wasPending) {
    await db.from('audit_log').insert({ tenant_id: router.tenant_id, user_id: job.created_by, action: 'router.added', details: { router_id: router.id, name: router.name } });
    await db.from('router_jobs').insert({ router_id: router.id, type: 'sync_profiles', payload: {}, created_by: job.created_by });
  }
  await finishJob(db, job.id, true, { model: t.board, ros_version: t.version, uptime: t.uptime, hotspot_server: choice.server, dns_name: dnsName, warnings });
}

/** Records one round of push results and keeps running totals on the job. */
export async function applyPushResults(
  db: SupabaseClient,
  router: RouterRef,
  job: Job,
  items: { voucher: string; result: 'added' | 'already' | 'conflict' | 'error' }[],
): Promise<Record<string, unknown>> {
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
    ...prev,
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
  job.result = result;
  if (progress) job.attempts = 0;
  return result;
}

export interface PushChunk {
  plan: PlanRow;
  vouchers: { id: string; code: string }[];
}

/** Next vouchers of a push job that are not on the router yet; finishes the job (and returns null) when none are left. */
export async function nextPushChunk(db: SupabaseClient, router: RouterRef, job: Job, limit: number): Promise<PushChunk | null> {
  const batchId = str(job.payload.batch_id);
  const { data: batch } = batchId ? await db.from('voucher_batches').select('id, router_id, plan_id').eq('id', batchId).maybeSingle() : { data: null };
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
    .limit(limit);
  if (error) throw new Error(`Could not load vouchers: ${error.message}`);
  if (!vouchers?.length) {
    const r = job.result ?? {};
    const conflicts = Array.isArray(r.conflicts) ? (r.conflicts as string[]) : [];
    await finishJob(db, job.id, true, {
      ...r,
      ...(conflicts.length ? { warning: `${conflicts.length} code(s) already belonged to other hotspot users on ${router.name} and were disabled.` } : {}),
    });
    return null;
  }
  return { plan, vouchers: vouchers.map((v) => ({ id: v.id as string, code: v.code as string })) };
}

/** Plans whose profiles a sync_profiles job covers (one plan, or every active plan). */
export async function plansForSync(db: SupabaseClient, router: RouterRef, job: Job): Promise<PlanRow[]> {
  const planId = str(job.payload.plan_id);
  let q = db.from('plans').select(PLAN_COLUMNS).eq('tenant_id', router.tenant_id);
  q = planId ? q.eq('id', planId) : q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return (data ?? []) as PlanRow[];
}

export interface UsageResult {
  synced_at: string;
  remove: { id: string; code: string }[];
  kick: { id: string; code: string }[];
}

/** Stores who is online and voucher counters; returns which sessions to close and which expired users to remove. */
export async function applyUsage(db: SupabaseClient, router: RouterRef, usage: { sessions: ActiveRow[]; users: UserUsage[] }): Promise<UsageResult | null> {
  const { data, error } = await db.rpc('sync_router_usage', { p_router_id: router.id, p_sessions: usage.sessions, p_users: usage.users });
  if (error) {
    console.error(`Usage sync failed for ${router.name}: ${error.message}`);
    return null;
  }
  const result = data as UsageResult;
  // Sessions not in this report have ended: the database stamped every current one with synced_at.
  await db.from('active_sessions').delete().eq('router_id', router.id).lt('updated_at', result.synced_at);
  const now = new Date().toISOString();
  await db.from('routers').update({ last_usage_at: now }).eq('id', router.id);
  router.last_usage_at = now;
  return result;
}

export async function markRemoved(db: SupabaseClient, router: RouterRef, voucherIds: string[]): Promise<void> {
  if (voucherIds.length) await db.from('vouchers').update({ on_router: false }).in('id', voucherIds).eq('router_id', router.id);
}

export async function clearDisconnected(db: SupabaseClient, router: RouterRef, job: Job): Promise<void> {
  const code = str(job.payload.code);
  if (!code) return;
  let q = db.from('active_sessions').delete().eq('router_id', router.id).eq('code', code);
  const mac = str(job.payload.mac_address);
  if (mac) q = q.eq('mac_address', mac);
  await q;
}

const RETRY_PUSH_AFTER_MS = 5 * 60_000;

/** Re-queues vouchers that never reached the router (e.g. a push that gave up), at most every 5 minutes per batch. */
export async function resumeUnfinishedPushes(db: SupabaseClient, router: RouterRef): Promise<void> {
  const { data: pending } = await db.from('vouchers').select('batch_id').eq('router_id', router.id).eq('on_router', false).eq('status', 'unused').limit(1);
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

/** The hotspot server profile (on the router) of the hotspot server Hotzonex uses, from the last check. */
export async function portalTarget(
  db: SupabaseClient,
  router: RouterRef,
): Promise<{ profile: string; previousDir: string | null } | { error: string }> {
  const { data } = await db.from('routers').select('hotspot_info').eq('id', router.id).maybeSingle();
  const info = data?.hotspot_info as HotspotInfo | null;
  const server = info?.servers.find((h) => h.name === router.hotspot_server);
  if (!server?.profile) return { error: 'The router has not been checked yet. Press "Test again" on the Routers page, then install the portal.' };
  const { data: cfg } = await db.from('portal_configs').select('previous_dir').eq('router_id', router.id).maybeSingle();
  return { profile: server.profile, previousDir: (cfg?.previous_dir as string | null) ?? null };
}

/** URL the router downloads the portal pages from (the file name is appended as &f=…). */
export function portalFilesUrl(routerId: string): string {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/portal?r=${routerId}&v=${Date.now()}`;
}

export async function applyPortalInstalled(db: SupabaseClient, router: RouterRef, job: Job, profile: string, current: string, dir: string): Promise<void> {
  const { data: cfg } = await db.from('portal_configs').select('previous_dir').eq('router_id', router.id).maybeSingle();
  // Remember the folder used before Hotzonex; a re-install keeps the original one.
  const previous = current && current !== dir ? current : ((cfg?.previous_dir as string | null) ?? null);
  await db
    .from('portal_configs')
    .upsert({ router_id: router.id, installed_at: new Date().toISOString(), installed_dir: dir, previous_dir: previous, server_profile: profile });
  await finishJob(db, job.id, true, { installed_dir: dir, previous_dir: previous, server_profile: profile });
}

export async function applyPortalRestored(db: SupabaseClient, router: RouterRef, job: Job, dir: string): Promise<void> {
  await db.from('portal_configs').update({ installed_at: null, installed_dir: null }).eq('router_id', router.id);
  await finishJob(db, job.id, true, { restored_dir: dir });
}
