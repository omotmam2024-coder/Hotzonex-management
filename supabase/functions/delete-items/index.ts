// delete-items: admin-only deletes that reach the router too. Everything stays inside the caller's business.
//
// POST { action: "delete_vouchers", ids: [...] } → { deleted, removing, kept }
//   Unsold vouchers are deleted. One that is on a router is switched off at once and deleted
//   after the router has removed it (as soon as the router is reachable). Sold vouchers are kept
//   for the sales records.
// POST { action: "delete_plan", id } → { deleted: true, kept_on_routers } or { removing, kept_on_routers, job_ids }
//   A plan with Hotzonex vouchers or sales can only be switched off. Otherwise a profile Hotzonex
//   made is deleted from its routers (only while no hotspot user is on it), then the plan. The
//   routers' own profiles (MikroTicket's) stay on the routers and are not made into a plan again.
// POST { action: "delete_business", id, name } → { removed, users_removed, counts }
//   Platform admins only: removes a switched-off business for good (the owner left Hotzonex Cloud):
//   all its data, its staff logins and its logo. The business name must be typed to confirm.
// POST { action: "delete_invoice", id } → { deleted: number }
//   Platform admins only: removes one of a business's Hotzonex Cloud invoices completely. A business
//   paused only for unpaid invoices opens again once none is overdue.
// POST { action: "delete_subscription_plan", id } → { deleted: name, moved }
//   Platform admins only: removes a Hotzonex Cloud plan; its businesses move to the Starter plan,
//   which new businesses start on and so stays.
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
  let removing = 0;
  for (const v of onRouter) byRouter.set(v.router_id, [...(byRouter.get(v.router_id) ?? []), v]);
  for (const [routerId, list] of byRouter) {
    for (let i = 0; i < list.length; i += PER_JOB) {
      const slice = list.slice(i, i + PER_JOB);
      // Not one sold meanwhile (a cashier or a mobile-money confirmation just now): it stays.
      const { data: off, error: offError } = await db
        .from('vouchers')
        .update({ status: 'disabled' })
        .in('id', slice.map((v) => v.id))
        .neq('status', 'sold')
        .select('id');
      if (offError) throw new Error(`Could not switch the vouchers off: ${offError.message}`);
      const offIds = new Set((off ?? []).map((v) => v.id as string));
      const part = slice.filter((v) => offIds.has(v.id));
      removing += part.length;
      if (!part.length) continue;
      const { error: jobError } = await db.from('router_jobs').insert({
        router_id: routerId,
        type: 'disable_voucher',
        payload: { delete: true, vouchers: part.map((v) => ({ id: v.id, code: v.code })) },
        created_by: caller.id,
      });
      if (jobError) throw new Error(`Could not queue the router work: ${jobError.message}`);
    }
  }

  const kept = rows.length - deleted - removing;
  await audit(db, caller, 'vouchers.deleted', { deleted, removing, kept, codes: rows.slice(0, 50).map((v) => v.code) });
  return { deleted, removing, kept };
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

  // Hotzonex vouchers and sales keep their plan (they cannot lose it). MikroTicket logins keep
  // their own price, so a MikroTicket plan can go.
  const refs = await Promise.all([
    db.from('vouchers').select('id', { count: 'exact', head: true }).eq('plan_id', id),
    db.from('voucher_batches').select('id', { count: 'exact', head: true }).eq('plan_id', id),
    db.from('sales').select('id', { count: 'exact', head: true }).eq('plan_id', id),
  ]);
  if (refs.some((r) => r.error)) throw new Error('Could not check what uses this plan.');
  const [vouchers, batches, sales] = refs.map((r) => r.count ?? 0);
  if (vouchers || batches) {
    throw new HttpError(409, `${plan.name} still has vouchers in Hotzonex. Delete its unsold vouchers on the Vouchers page first, or switch the plan off instead.`);
  }
  if (sales) {
    throw new HttpError(409, `${plan.name} has Hotzonex sales in your reports, so it is kept for them. Switch it off instead.`);
  }

  // A profile Hotzonex made goes from the router too (unless users are on it). The router's own
  // profiles (MikroTicket's) stay on the router; Hotzonex only stops making a plan of them.
  const profile = plan.router_profile_name as string;
  const { data: links } = await db.from('plan_routers').select('router_id, profile_name, managed').eq('plan_id', id);
  const { data: routers } = await db.from('routers').select('id, status, hotspot_info').eq('tenant_id', caller.tenantId);
  const targets: { router_id: string; profile_name: string }[] = [];
  const keepOnRouter: { router_id: string; profile_name: string }[] = [];
  for (const r of routers ?? []) {
    const names = ((r.hotspot_info as HotspotInfo | null)?.user_profiles ?? []).map((p) => p.name);
    const link = (links ?? []).find((l) => l.router_id === r.id);
    const name = (link?.profile_name as string | undefined) ?? (names.includes(profile) ? profile : null);
    if (!name) continue;
    if (link?.managed) {
      if (r.status !== 'pending' && names.includes(name)) targets.push({ router_id: r.id as string, profile_name: name });
    } else {
      keepOnRouter.push({ router_id: r.id as string, profile_name: name });
    }
  }
  if (keepOnRouter.length) {
    const { error: ignoreError } = await db.from('router_profile_ignores').upsert(keepOnRouter, { onConflict: 'router_id,profile_name', ignoreDuplicates: true });
    if (ignoreError) throw new Error(`Could not save the plan's removal: ${ignoreError.message}`);
    await db.from('plan_routers').delete().eq('plan_id', id).in('router_id', keepOnRouter.map((k) => k.router_id));
  }

  if (!targets.length) {
    const { error: delError } = await db.from('plans').delete().eq('id', id);
    if (delError) throw new Error(`Could not delete the plan: ${delError.message}`);
    await audit(db, caller, 'plan.deleted', { plan_id: id, name: plan.name, profile, kept_on_routers: keepOnRouter.length });
    return { deleted: true, kept_on_routers: keepOnRouter.length };
  }

  // Switched off now; deleted once the routers have removed the profiles Hotzonex made.
  await db.from('plans').update({ is_active: false }).eq('id', id);
  const { data: jobs, error: jobError } = await db
    .from('router_jobs')
    .insert(targets.map((t) => ({ router_id: t.router_id, type: 'sync_profiles', payload: { remove_profile: t.profile_name, plan_id: id }, created_by: caller.id })))
    .select('id');
  if (jobError) throw new Error(`Could not queue the router work: ${jobError.message}`);
  await audit(db, caller, 'plan.delete_requested', { plan_id: id, name: plan.name, profile, routers: targets.length, kept_on_routers: keepOnRouter.length });
  return { removing: targets.length, kept_on_routers: keepOnRouter.length, job_ids: (jobs ?? []).map((j) => j.id as string) };
}

const BUSINESS_REFUSALS: Record<string, number> = { P0002: 404, '55000': 409, '22023': 400 };

async function deleteBusiness(db: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can remove a business.');
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : '';
  const name = typeof body.name === 'string' ? body.name.slice(0, 200) : '';
  if (!id) throw new HttpError(400, 'Business not found.');
  if (!name.trim()) throw new HttpError(400, 'Type the business name exactly to remove it.');

  // The database checks again: switched off, the name matches, no platform admin inside.
  const { data, error } = await db.rpc('remove_tenant', { p_tenant_id: id, p_by: caller.id, p_name: name });
  if (error) {
    const status = BUSINESS_REFUSALS[error.code ?? ''];
    if (status) throw new HttpError(status, error.message);
    throw new Error(`Could not remove the business: ${error.message}`);
  }
  const removed = data as { name: string; users: string[]; counts: Record<string, number> };

  // The staff logins (their profiles are already gone with the business).
  let usersRemoved = 0;
  for (const userId of removed.users ?? []) {
    const { error: userError } = await db.auth.admin.deleteUser(userId);
    if (userError) console.error(`Could not delete login ${userId}: ${userError.message}`);
    else usersRemoved++;
  }

  // The logo (logos/<business id>/...).
  const { data: files } = await db.storage.from('logos').list(id, { limit: 100 });
  if (files?.length) {
    const { error: logoError } = await db.storage.from('logos').remove(files.map((f) => `${id}/${f.name}`));
    if (logoError) console.error(`Could not delete the logo of ${id}: ${logoError.message}`);
  }

  if (caller.tenantId !== id) {
    await audit(db, caller, 'tenant.removed', { tenant_id: id, name: removed.name, users_removed: usersRemoved, ...removed.counts });
  }
  return { removed: removed.name, users_removed: usersRemoved, counts: removed.counts };
}

async function deleteInvoice(db: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can delete an invoice.');
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : '';
  const { data: inv } = id ? await db.from('invoices').select('id, tenant_id, number, status, amount_ssp').eq('id', id).maybeSingle() : { data: null };
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  const { error } = await db.from('invoices').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the invoice: ${error.message}`);
  await db.from('alerts').update({ resolved_at: new Date().toISOString() }).eq('key', `invoice_paid:${id}`).is('resolved_at', null);

  // Paused for unpaid invoices only: open again when no overdue invoice is left (as when one is paid).
  const now = new Date().toISOString();
  const { count } = await db.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', inv.tenant_id).eq('status', 'open').lt('due_at', now);
  if (!count) {
    const { data: billing } = await db.from('tenant_billing').select('status').eq('tenant_id', inv.tenant_id).maybeSingle();
    if (billing?.status === 'suspended') {
      await db.from('tenants').update({ is_active: true }).eq('id', inv.tenant_id);
      await db.from('tenant_billing').update({ status: 'active', suspended_at: null, updated_at: now }).eq('tenant_id', inv.tenant_id);
    }
  }
  await audit(db, caller, 'invoice.deleted', { tenant_id: inv.tenant_id, number: inv.number, status: inv.status, amount_ssp: inv.amount_ssp });
  return { deleted: inv.number as string };
}

/** The plan every new business starts on (the database default); it cannot be deleted. */
const DEFAULT_SUBSCRIPTION_PLAN = 'starter';

async function deleteSubscriptionPlan(db: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can delete a plan.');
  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 40) : '';
  if (id === DEFAULT_SUBSCRIPTION_PLAN) throw new HttpError(409, 'Starter is the plan every new business starts on, so it stays. You can change its price and limits.');
  const { data: plan } = id ? await db.from('subscription_plans').select('id, name').eq('id', id).maybeSingle() : { data: null };
  if (!plan) throw new HttpError(404, 'Plan not found.');
  const { data: moved, error: moveError } = await db
    .from('tenant_billing')
    .update({ plan_id: DEFAULT_SUBSCRIPTION_PLAN, updated_at: new Date().toISOString() })
    .eq('plan_id', id)
    .select('tenant_id');
  if (moveError) throw new Error(`Could not move its businesses: ${moveError.message}`);
  const { error } = await db.from('subscription_plans').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the plan: ${error.message}`);
  await audit(db, caller, 'subscription_plan.deleted', { id, name: plan.name, moved_to_starter: moved?.length ?? 0 });
  return { deleted: plan.name as string, moved: moved?.length ?? 0 };
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
    case 'delete_business':
      return await deleteBusiness(db, caller, body);
    case 'delete_invoice':
      return await deleteInvoice(db, caller, body);
    case 'delete_subscription_plan':
      return await deleteSubscriptionPlan(db, caller, body);
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});
