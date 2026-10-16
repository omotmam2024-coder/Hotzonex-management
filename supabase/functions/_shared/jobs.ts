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
  name: string;
  price_ssp: number;
  validity_seconds: number | null;
  uptime_seconds: number;
  rate_limit: string | null;
  data_limit_mb: number | null;
  shared_users: number;
  router_profile_name: string;
}

export const JOB_COLUMNS = 'id, router_id, type, status, payload, attempts, created_by, result';
export const PLAN_COLUMNS = 'id, name, price_ssp, validity_seconds, uptime_seconds, rate_limit, data_limit_mb, shared_users, router_profile_name';

/** RouterOS-style duration for MikroTicket names: 3600 → "0d 01:00:00". */
function mtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const rest = seconds % 86400;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${two(Math.floor(rest / 3600))}:${two(Math.floor((rest % 3600) / 60))}:${two(rest % 60)}`;
}

/**
 * The user profile name for a plan, in MikroTicket's format, so a profile Hotzonex makes shows in
 * MikroTicket with its price and time (same as buildMikroticketProfileName in the web app).
 */
export function mikroticketProfileName(p: Pick<PlanRow, 'name' | 'price_ssp' | 'uptime_seconds' | 'validity_seconds'>): string {
  const label = p.name.replace(/[^A-Za-z0-9._]/g, '') || 'Plan';
  const validity = p.validity_seconds ? `-vl:${mtDuration(p.validity_seconds)}` : '';
  return `profile_${label}-se:-co:${p.price_ssp}-pr:-lu:7-lp:7-ut:${mtDuration(p.uptime_seconds)}-bt:-kt:true-nu:true-np:true-tp:2${validity}`;
}

/** A plan on a router: its profile name there, and whether Hotzonex made (and keeps in step) that profile. */
export interface PlanLink {
  plan_id: string;
  profile_name: string;
  managed: boolean;
}

/** The plan's link to this router, or null when the plan is not ticked for it. */
export async function planLink(db: SupabaseClient, router: RouterRef, planId: string): Promise<PlanLink | null> {
  const { data } = await db.from('plan_routers').select('plan_id, profile_name, managed').eq('router_id', router.id).eq('plan_id', planId).maybeSingle<PlanLink>();
  return data ?? null;
}

/** Plans whose profile Hotzonex keeps on this router (one plan, or all of them). */
export async function managedLinks(db: SupabaseClient, router: RouterRef, planId: string | null): Promise<(PlanLink & { plan: PlanRow })[]> {
  let q = db.from('plan_routers').select(`plan_id, profile_name, managed, plan:plans(${PLAN_COLUMNS})`).eq('router_id', router.id).eq('managed', true);
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load the plans of ${router.name}: ${error.message}`);
  return ((data ?? []) as unknown as (PlanLink & { plan: PlanRow | null })[]).filter((l): l is PlanLink & { plan: PlanRow } => Boolean(l.plan));
}

/** Every profile name the router's plans use there (kept when Hotzonex tidies its own profiles). */
export async function linkedProfileNames(db: SupabaseClient, router: RouterRef): Promise<Set<string>> {
  const { data } = await db.from('plan_routers').select('profile_name').eq('router_id', router.id);
  return new Set((data ?? []).map((l) => l.profile_name as string));
}
export const MAX_SENDS = 3;

export const str = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * User profiles the router owner made (MikroTicket's, the admin's own): not RouterOS's "default" and
 * not one Hotzonex added (hzc-…). A router with any of these keeps its own profiles: Hotzonex adds
 * none of its own to it (same rule as public.router_own_profiles in the database).
 */
export function ownProfiles(info: Pick<HotspotInfo, 'user_profiles'> | null | undefined): string[] {
  return (info?.user_profiles ?? []).map((p) => p.name).filter((n) => n && n !== 'default' && !n.startsWith('hzc-'));
}

/** Profile names of every plan of the router's business (switched-off plans too). */
export async function planProfileNames(db: SupabaseClient, router: RouterRef): Promise<Set<string>> {
  const { data, error } = await db.from('plans').select('router_profile_name').eq('tenant_id', router.tenant_id);
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return new Set((data ?? []).map((p) => p.router_profile_name as string));
}
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
  // A router with its own profiles keeps them: its profiles become plans; nothing is added to it.
  const usesOwnProfiles = ownProfiles(t.hotspot).length > 0;
  if (missing.length && !usesOwnProfiles) {
    warnings.push(`This router has no user profiles of its own yet. Tick it on the Plans page for the plans it should sell; Hotzonex then adds their profiles.`);
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
    // Profiles of plans ticked for this router while it was being added are made now.
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

/**
 * Saves what the router showed after a push (checkPushed) on the job, as plain warnings for the
 * batch: cards missing on the router, on another profile, or with a code length the router's own
 * login page may not take.
 */
export async function recordPushCheck(
  db: SupabaseClient,
  job: Job,
  check: { checked: number; missing: string[]; wrongProfile: string[]; codeLength: number; ownLength: number | null },
): Promise<string[]> {
  const prev = job.result ?? {};
  const warnings = new Set(Array.isArray(prev.warnings) ? (prev.warnings as string[]) : []);
  const missing = [...(Array.isArray(prev.missing_on_router) ? (prev.missing_on_router as string[]) : []), ...check.missing];
  const wrong = [...(Array.isArray(prev.wrong_profile) ? (prev.wrong_profile as string[]) : []), ...check.wrongProfile];
  if (missing.length) warnings.add(`${missing.length} card(s) are not on the router after the push: ${missing.slice(0, 10).join(', ')}`);
  if (wrong.length) warnings.add(`${wrong.length} card(s) are on another profile on the router: ${wrong.slice(0, 10).join(', ')}`);
  if (check.ownLength && check.codeLength && check.ownLength !== check.codeLength) {
    warnings.add(`These codes have ${check.codeLength} digits but the router's own cards have ${check.ownLength}; its login page may not take them.`);
  }
  const result = {
    ...prev,
    checked_on_router: (typeof prev.checked_on_router === 'number' ? prev.checked_on_router : 0) + check.checked,
    missing_on_router: missing,
    wrong_profile: wrong,
    // Older "N card(s) are …" lines are replaced by the new totals.
    warnings: dedupeCounts([...warnings]),
  };
  await db.from('router_jobs').update({ result }).eq('id', job.id);
  job.result = result;
  return result.warnings;
}

/** Keeps only the newest "N card(s) are …" line of each kind. */
function dedupeCounts(list: string[]): string[] {
  const out: string[] = [];
  for (const w of list) {
    const kind = /^\d+ card\(s\) are (not on|on another)/.exec(w)?.[1];
    if (kind) {
      const i = out.findIndex((o) => o.includes(`card(s) are ${kind}`));
      if (i >= 0) out.splice(i, 1);
    }
    out.push(w);
  }
  return out;
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
    // Sold too: a card sold before it reached the router (a confirmed mobile-money purchase).
    .in('status', ['unused', 'sold'])
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
const RETRY_PUSH_MAX_MS = 6 * 3600_000;

/**
 * Re-queues vouchers that never reached the router (e.g. a push that gave up). After a failed
 * push the next try waits 5 minutes, then twice as long after each further failure (at most
 * 6 hours): a push that cannot work (no matching profile on the router) does not fail, and
 * alert, every 5 minutes for ever.
 */
export async function resumeUnfinishedPushes(db: SupabaseClient, router: RouterRef): Promise<void> {
  const { data: pending } = await db
    .from('vouchers')
    .select('batch_id')
    .eq('router_id', router.id)
    .eq('on_router', false)
    .eq('status', 'unused')
    .order('created_at')
    .limit(500);
  const batches = [...new Set((pending ?? []).map((v) => v.batch_id as string | null).filter((b): b is string => Boolean(b)))].slice(0, 5);
  for (const batchId of batches) {
    const { data: jobs } = await db
      .from('router_jobs')
      .select('status, finished_at')
      .eq('type', 'push_vouchers')
      .eq('payload->>batch_id', batchId)
      .order('created_at', { ascending: false })
      .limit(8);
    const last = jobs?.[0];
    if (last && (last.status === 'queued' || last.status === 'running')) continue;
    let failures = 0;
    while (jobs && failures < jobs.length && jobs[failures]!.status === 'failed') failures++;
    const wait = Math.min(RETRY_PUSH_AFTER_MS * 2 ** Math.max(0, failures - 1), RETRY_PUSH_MAX_MS);
    if (last?.finished_at && Date.now() - new Date(last.finished_at).getTime() < wait) continue;
    await db.from('router_jobs').insert({ router_id: router.id, type: 'push_vouchers', payload: { batch_id: batchId, resumed: true } });
    return; // one batch at a time
  }
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

// ---------------------------------------------------------------------------
// Deletes: what is removed on the router is removed in Hotzonex, and the other way round
// ---------------------------------------------------------------------------

type Page<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row of a query, 1000 at a time (the API returns at most 1000 rows per request). */
async function allRows<T>(page: Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Ids among these vouchers that have a sale or were used (they stay in Hotzonex for the sales records). */
export async function vouchersWithSales(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const sold = new Set<string>();
  for (const part of chunks(ids, 200)) {
    const { data, error } = await db.from('sales').select('voucher_id').in('voucher_id', part);
    if (error) throw new Error(`Could not check sales: ${error.message}`);
    for (const s of data ?? []) sold.add(s.voucher_id as string);
    // A voucher a customer has used is a sale in the reports even when nobody recorded one.
    const { data: used, error: usedError } = await db.from('vouchers').select('id').in('id', part).not('first_used_at', 'is', null);
    if (usedError) throw new Error(`Could not check used vouchers: ${usedError.message}`);
    for (const v of used ?? []) sold.add(v.id as string);
  }
  return sold;
}

/** Deletes unsold vouchers from Hotzonex, and their batches once a batch has no vouchers left. */
export async function deleteVoucherRows(db: SupabaseClient, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const sold = await vouchersWithSales(db, ids);
  const free = ids.filter((id) => !sold.has(id));
  const batches = new Set<string>();
  let deleted = 0;
  for (const part of chunks(free, 200)) {
    const { data, error } = await db.from('vouchers').delete().in('id', part).select('batch_id');
    if (error) throw new Error(`Could not delete vouchers: ${error.message}`);
    deleted += data?.length ?? 0;
    for (const v of data ?? []) batches.add(v.batch_id as string);
  }
  for (const batchId of batches) {
    const { count } = await db.from('vouchers').select('id', { count: 'exact', head: true }).eq('batch_id', batchId);
    if (count === 0) await db.from('voucher_batches').delete().eq('id', batchId);
  }
  return deleted;
}

export interface RemovalResult {
  vouchers_deleted: number;
  vouchers_disabled: number;
  records_deleted: number;
}

/**
 * Hotspot users deleted on the router (in Winbox, MikroTicket, …) are deleted in Hotzonex too:
 *  - a Hotzonex voucher that was on the router is deleted; one that was sold is kept for the sales
 *    records, but switched off (it can no longer be used);
 *  - an unused MikroTicket voucher drops out of Hotzonex's records (used ones stay: they are sales).
 * `names` is the router's complete user list; an empty list is treated as a failed read.
 */
export async function applyRouterRemovals(db: SupabaseClient, router: RouterRef, names: Set<string>): Promise<RemovalResult | null> {
  if (!names.size) return null;

  const onRouter = await allRows<{ id: string; code: string; status: string }>((from, to) =>
    db.from('vouchers').select('id, code, status').eq('router_id', router.id).eq('on_router', true).order('id').range(from, to),
  );
  const gone = onRouter.filter((v) => !names.has(v.code));
  const sold = await vouchersWithSales(db, gone.map((v) => v.id));
  const vouchersDeleted = await deleteVoucherRows(db, gone.filter((v) => !sold.has(v.id)).map((v) => v.id));
  const keep = gone.filter((v) => sold.has(v.id));
  for (const part of chunks(keep, 200)) {
    const ids = part.map((v) => v.id);
    await db.from('vouchers').update({ on_router: false }).in('id', ids);
    await db.from('vouchers').update({ status: 'disabled' }).in('id', ids).in('status', ['unused', 'sold', 'active']);
  }

  const unusedRecords = await allRows<{ id: string; username: string }>((from, to) =>
    db.from('router_logins').select('id, username').eq('router_id', router.id).eq('used', false).order('id').range(from, to),
  );
  const staleRecords = unusedRecords.filter((l) => !names.has(l.username)).map((l) => l.id);
  let recordsDeleted = 0;
  for (const part of chunks(staleRecords, 200)) {
    const { data, error } = await db.from('router_logins').delete().in('id', part).eq('used', false).select('id');
    if (error) throw new Error(`Could not delete router records: ${error.message}`);
    recordsDeleted += data?.length ?? 0;
  }

  const result = { vouchers_deleted: vouchersDeleted, vouchers_disabled: keep.length, records_deleted: recordsDeleted };
  if (vouchersDeleted || keep.length || recordsDeleted) {
    await db.from('audit_log').insert({
      tenant_id: router.tenant_id,
      user_id: null,
      action: 'router.users_removed',
      details: { router_id: router.id, name: router.name, ...result, codes: gone.slice(0, 50).map((v) => v.code) },
    });
  }
  return result;
}

const isOwnProfileName = (n: string) => Boolean(n) && n !== 'default' && !n.startsWith('hzc-');

/**
 * A plan whose profile is gone: deleted when nothing in Hotzonex refers to it, otherwise switched
 * off (vouchers and sales keep their plan). Kept as it is while it is still ticked for another
 * router. Call after this router's link to the plan is gone.
 */
export async function retirePlan(db: SupabaseClient, _tenantId: string, plan: { id: string; router_profile_name: string }): Promise<'deleted' | 'switched_off' | 'kept'> {
  // Still ticked for another router: the plan stays.
  const { count: links } = await db.from('plan_routers').select('plan_id', { count: 'exact', head: true }).eq('plan_id', plan.id);
  if ((links ?? 0) > 0) return 'kept';

  const refs = await Promise.all([
    db.from('vouchers').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id),
    db.from('voucher_batches').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id),
    db.from('sales').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id),
    db.from('router_logins').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id).eq('used', true),
  ]);
  if (refs.some((r) => r.error || (r.count ?? 0) > 0)) {
    await db.from('plans').update({ is_active: false }).eq('id', plan.id);
    return 'switched_off';
  }
  const { error } = await db.from('plans').delete().eq('id', plan.id);
  if (error) {
    await db.from('plans').update({ is_active: false }).eq('id', plan.id);
    return 'switched_off';
  }
  return 'deleted';
}

/** Plans of the router owner's profiles that disappeared from the router are retired (see retirePlan). */
export async function retireRemovedProfiles(db: SupabaseClient, router: RouterRef, before: string[], after: string[]): Promise<Record<string, string>> {
  if (!after.length) return {};
  const now = new Set(after);
  const vanished = before.filter((n) => isOwnProfileName(n) && !now.has(n));
  const out: Record<string, string> = {};
  if (!vanished.length) return out;
  // The plans these profiles belonged to on this router (by link, or by the plan's own profile name).
  const { data: links } = await db.from('plan_routers').select('plan_id, profile_name').eq('router_id', router.id).in('profile_name', vanished);
  const planIds = new Set((links ?? []).map((l) => l.plan_id as string));
  if (links?.length) await db.from('plan_routers').delete().eq('router_id', router.id).in('profile_name', vanished);
  const { data: byName } = await db.from('plans').select('id').eq('tenant_id', router.tenant_id).in('router_profile_name', vanished);
  for (const p of byName ?? []) planIds.add(p.id as string);
  if (!planIds.size) return out;
  const { data: plans } = await db.from('plans').select('id, name, router_profile_name').in('id', [...planIds]);
  for (const p of (plans ?? []) as { id: string; name: string; router_profile_name: string }[]) out[p.name] = await retirePlan(db, router.tenant_id, p);
  return out;
}

/** Finishes a "delete these vouchers" job once the router no longer has them. */
export async function finishVoucherDelete(db: SupabaseClient, job: Job, removedOnRouter: number): Promise<void> {
  const ids = jobVouchers(job).map((v) => v.id);
  const deleted = await deleteVoucherRows(db, ids);
  await finishJob(db, job.id, true, { removed_on_router: removedOnRouter, deleted });
}

/** The vouchers of a "delete these vouchers" job (disable_voucher with delete: true). */
export function jobVouchers(job: Job): { id: string; code: string }[] {
  const list = Array.isArray(job.payload.vouchers) ? (job.payload.vouchers as unknown[]) : [];
  return list
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {}))
    .map((v) => ({ id: str(v.id) ?? '', code: str(v.code) ?? '' }))
    .filter((v) => v.id && v.code);
}

/**
 * Finishes a "delete this plan's profile" job (sync_profiles with remove_profile). With hotspot
 * users still on the profile the router keeps it, and so does Hotzonex (switched off).
 */
export async function finishProfileRemoval(db: SupabaseClient, router: RouterRef, job: Job, usersOnIt: number): Promise<void> {
  const name = str(job.payload.remove_profile) ?? '';
  const keepPlan = job.payload.keep_plan === true;
  if (usersOnIt > 0) {
    await finishJob(db, job.id, false, {
      error: keepPlan
        ? `${usersOnIt} hotspot user(s) on ${router.name} still use profile "${name}", so it was kept on the router. The plan is no longer sold there.`
        : `${usersOnIt} hotspot user(s) on ${router.name} still use profile "${name}", so it was kept and the plan stays switched off. Delete those users on the router first, then delete the plan again.`,
    });
    return;
  }
  const { data } = await db.from('routers').select('hotspot_info').eq('id', router.id).maybeSingle();
  const info = data?.hotspot_info as HotspotInfo | null;
  if (info) {
    await db
      .from('routers')
      .update({ hotspot_info: { ...info, user_profiles: info.user_profiles.filter((p) => p.name !== name) } })
      .eq('id', router.id);
  }
  if (keepPlan) {
    await finishJob(db, job.id, true, { removed_profile: name });
    return;
  }
  const planId = str(job.payload.plan_id);
  // The plan is no longer on this router; it goes when no other router carries it.
  if (planId) await db.from('plan_routers').delete().eq('router_id', router.id).eq('plan_id', planId);
  const { data: plan } = planId ? await db.from('plans').select('id, router_profile_name').eq('id', planId).maybeSingle() : { data: null };
  const outcome = plan ? await retirePlan(db, router.tenant_id, plan as { id: string; router_profile_name: string }) : 'deleted';
  await finishJob(db, job.id, true, { removed_profile: name, plan: outcome });
}
