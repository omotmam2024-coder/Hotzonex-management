// delete-items: admin-only deletes that reach the router too. Everything stays inside the caller's business.
//
// POST { action: "delete_vouchers", ids: [...] } → { deleted, removing, kept }
//   Unsold vouchers are deleted. One that is on a router is switched off at once and deleted
//   after the router has removed it (as soon as the router is reachable). Sold vouchers are kept
//   for the sales records.
// POST { action: "delete_plan", id } → { deleted: true } or { removing: <routers>, job_ids }
//   A plan with vouchers or sales can only be switched off. Otherwise its profile is deleted from
//   the routers that have it (only while no hotspot user is on it), then the plan.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, type Caller, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { deleteVoucherRows, vouchersWithSales } from '../_shared/jobs.ts';
import type { HotspotInfo } from '../_shared/routeros.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VOUCHERS = 1000;
const PER_JOB = 200;

interface VoucherRow {
  id: string;
  code: string;
  router_id: string;
  on_router: boolean;
}

async function deleteVouchers(db: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  if (!ids.length) throw new HttpError(400, 'Choose the vouchers to delete.');
  if (ids.length > MAX_VOUCHERS) throw new HttpError(400, `Delete at most ${MAX_VOUCHERS} vouchers at a time.`);

  const rows: VoucherRow[] = [];
  for (let i = 0; i < ids.length; i += PER_JOB) {
    const { data, error } = await db
      .from('vouchers')
      .select('id, code, router_id, on_router')
      .eq('tenant_id', caller.tenantId)
      .in('id', ids.slice(i, i + PER_JOB));
    if (error) throw new Error(`Voucher lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as VoucherRow[]));
  }
  const sold = await vouchersWithSales(db, rows.map((v) => v.id));
  const free = rows.filter((v) => !sold.has(v.id));

  const deleted = await deleteVoucherRows(db, free.filter((v) => !v.on_router).map((v) => v.id));

  // On a router: switched off now (no longer sold or printed), deleted once the router has removed it.
  const onRouter = free.filter((v) => v.on_router);
  const byRouter = new Map<string, VoucherRow[]>();
  for (const v of onRouter) byRouter.set(v.router_id, [...(byRouter.get(v.router_id) ?? []), v]);
  for (const [routerId, list] of byRouter) {
    for (let i = 0; i < list.length; i += PER_JOB) {
      const part = list.slice(i, i + PER_JOB);
      const { error: offError } = await db.from('vouchers').update({ status: 'disabled' }).in('id', part.map((v) => v.id));
      if (offError) throw new Error(`Could not switch the vouchers off: ${offError.message}`);
      const { error: jobError } = await db.from('router_jobs').insert({
        router_id: routerId,
        type: 'disable_voucher',
        payload: { delete: true, vouchers: part.map((v) => ({ id: v.id, code: v.code })) },
        created_by: caller.id,
      });
      if (jobError) throw new Error(`Could not queue the router work: ${jobError.message}`);
    }
  }

  await audit(db, caller, 'vouchers.deleted', { deleted, removing: onRouter.length, kept: sold.size, codes: rows.slice(0, 50).map((v) => v.code) });
  return { deleted, removing: onRouter.length, kept: sold.size };
}

async function deletePlan(db: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : '';
  if (!id) throw new HttpError(400, 'Choose the plan to delete.');
  const { data: plan, error } = await db
    .from('plans')
    .select('id, name, router_profile_name')
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
    .maybeSingle();
  if (error) throw new Error(`Plan lookup failed: ${error.message}`);
  if (!plan) throw new HttpError(404, 'This plan no longer exists.');

  const refs = await Promise.all([
    db.from('vouchers').select('id', { count: 'exact', head: true }).eq('plan_id', id),
    db.from('voucher_batches').select('id', { count: 'exact', head: true }).eq('plan_id', id),
    db.from('sales').select('id', { count: 'exact', head: true }).eq('plan_id', id),
    db.from('router_logins').select('id', { count: 'exact', head: true }).eq('plan_id', id).eq('used', true),
  ]);
  if (refs.some((r) => r.error)) throw new Error('Could not check what uses this plan.');
  const [vouchers, batches, sales, logins] = refs.map((r) => r.count ?? 0);
  if (vouchers || batches) {
    throw new HttpError(409, `${plan.name} still has vouchers in Hotzonex. Delete its unsold vouchers on the Vouchers page first, or switch the plan off instead.`);
  }
  if (sales || logins) {
    throw new HttpError(409, `${plan.name} has sales in your reports, so it is kept for them. Switch it off instead.`);
  }

  const profile = plan.router_profile_name as string;
  const { data: routers } = await db.from('routers').select('id, status, hotspot_info').eq('tenant_id', caller.tenantId);
  const withProfile = (routers ?? []).filter(
    (r) => r.status !== 'pending' && ((r.hotspot_info as HotspotInfo | null)?.user_profiles ?? []).some((p) => p.name === profile),
  );

  if (!withProfile.length) {
    const { error: delError } = await db.from('plans').delete().eq('id', id);
    if (delError) throw new Error(`Could not delete the plan: ${delError.message}`);
    await audit(db, caller, 'plan.deleted', { plan_id: id, name: plan.name, profile });
    return { deleted: true };
  }

  // Switched off now; deleted once the routers have removed the profile.
  await db.from('plans').update({ is_active: false }).eq('id', id);
  const { data: jobs, error: jobError } = await db
    .from('router_jobs')
    .insert(withProfile.map((r) => ({ router_id: r.id, type: 'sync_profiles', payload: { remove_profile: profile, plan_id: id }, created_by: caller.id })))
    .select('id');
  if (jobError) throw new Error(`Could not queue the router work: ${jobError.message}`);
  await audit(db, caller, 'plan.delete_requested', { plan_id: id, name: plan.name, profile, routers: withProfile.length });
  return { removing: withProfile.length, job_ids: (jobs ?? []).map((j) => j.id as string) };
}

serveJson(async (req) => {
  const db = serviceClient();
  const caller = await requireAdmin(req, db);
  const body = await readBody(req);
  switch (body.action) {
    case 'delete_vouchers':
      return await deleteVouchers(db, caller, body);
    case 'delete_plan':
      return await deletePlan(db, caller, body);
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});
