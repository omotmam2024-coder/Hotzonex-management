// buy: the public Buy page of a site (no login; customers use it from the hotspot or anywhere).
//
// POST { action: "site", slug }                                   → the site's plans and payment instructions
// POST { action: "request", slug, plan_id, phone, provider, txn_ref } → { id, token }: waits for a cashier
// POST { action: "status", id, token }                             → pending / rejected (reason) / confirmed (code)
// POST { action: "momo_pay", slug, plan_id, phone }                → { id, token }: MTN MoMo asks the phone to
//      approve the payment (the business's own MoMo API login); the card comes as soon as MoMo confirms it
// POST { action: "momo_sweep" }   x-hzc-worker secret (pg_cron, every 2 minutes): settles MoMo payments
//      whose customer left the page before MoMo answered
//
// Only the customer who made a request (holding its token) can see its card code. Requests are
// limited per device and per phone number, and a transaction ID can be used once per business.
// A MoMo payment is confirmed only by MoMo's own status answer, for the exact amount and currency.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { cleanPhone, cleanTxnRef, PROVIDERS, providerLabel } from '../_shared/buy.ts';
import { MomoClient, MomoError, momoMsisdn, momoReason, paidInFull } from '../_shared/momo.ts';
import { momoAccount } from '../_shared/momo-account.ts';
import { sameSecret } from '../_shared/netcheck.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_IP_HOUR = 10;
const PENDING_PER_PHONE = 3;
// However many devices are used, a site never has more than this many payments waiting.
const PENDING_PER_SITE = 30;
// A MoMo payment sends a prompt to the phone: a number gets at most this many an hour.
const MOMO_PER_PHONE_HOUR = 5;
// MoMo answers within minutes; one still waiting after this long is given up.
const MOMO_GIVE_UP_MS = 30 * 60_000;
// The customer's page asks every 5 s; MoMo is asked at most this often for one payment.
const MOMO_CHECK_EVERY_MS = 4_000;

interface SiteRow {
  id: string;
  tenant_id: string;
  name: string;
  buy_enabled: boolean;
  buy_instructions: string | null;
  tenants: { name: string; logo_url: string | null; is_active: boolean; currency: string } | null;
}

async function siteBySlug(db: SupabaseClient, slug: unknown): Promise<SiteRow> {
  const s = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  if (!/^[a-z0-9-]{3,40}$/.test(s)) throw new HttpError(404, 'This Buy page does not exist.');
  const { data } = await db
    .from('sites')
    .select('id, tenant_id, name, buy_enabled, buy_instructions, is_active, tenants(name, logo_url, is_active, currency)')
    .eq('buy_slug', s)
    .maybeSingle();
  const site = data as (SiteRow & { is_active: boolean }) | null;
  if (!site || !site.buy_enabled || !site.is_active || !site.tenants?.is_active) throw new HttpError(404, 'This Buy page is not open.');
  return site;
}

/** Plans the site sells: active, on a router of the site (or not tied to any router). */
async function sitePlans(db: SupabaseClient, site: SiteRow) {
  const [{ data: plans }, { data: routers }] = await Promise.all([
    db
      .from('plans')
      .select('id, name, price_ssp, uptime_seconds, validity_seconds, data_limit_mb, color, plan_routers(router_id)')
      .eq('tenant_id', site.tenant_id)
      .eq('is_active', true)
      .gt('price_ssp', 0)
      .order('price_ssp'),
    db.from('routers').select('id').eq('site_id', site.id).neq('status', 'pending'),
  ]);
  const here = new Set((routers ?? []).map((r) => r.id as string));
  return (plans ?? [])
    .filter((p) => {
      const links = (p.plan_routers as { router_id: string }[] | null) ?? [];
      return links.length === 0 || links.some((l) => here.has(l.router_id));
    })
    .map(({ plan_routers: _l, ...p }) => p);
}

async function momoEnabled(db: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await db.from('momo_accounts').select('enabled').eq('tenant_id', tenantId).maybeSingle();
  return data?.enabled === true;
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The visitor's address as Cloudflare saw it (a visitor cannot set this header themselves). */
function clientIp(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0];
  return (ip ?? '').trim().slice(0, 64) || 'unknown';
}

async function request(db: SupabaseClient, req: Request, body: Record<string, unknown>) {
  const site = await siteBySlug(db, body.slug);
  const planId = typeof body.plan_id === 'string' && UUID_RE.test(body.plan_id) ? body.plan_id : '';
  const plan = (await sitePlans(db, site)).find((p) => p.id === planId);
  if (!plan) throw new HttpError(400, 'Choose a plan.');
  const phone = cleanPhone(body.phone);
  if (!phone) throw new HttpError(400, 'Type the phone number you paid from.');
  const provider = typeof body.provider === 'string' && (PROVIDERS as readonly string[]).includes(body.provider) ? body.provider : '';
  if (!provider) throw new HttpError(400, 'Choose how you paid.');
  const txn = cleanTxnRef(body.txn_ref);
  if (!txn) throw new HttpError(400, 'Type the transaction ID from your payment message (letters and digits).');

  const ip = clientIp(req);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [byIp, byPhone, bySite, used] = await Promise.all([
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('client_ip', ip).gte('created_at', hourAgo),
    // This business only: a number used on another business's page is not blocked here.
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', site.tenant_id).eq('phone', phone).eq('status', 'pending'),
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('site_id', site.id).eq('status', 'pending'),
    db.from('payment_requests').select('id').eq('tenant_id', site.tenant_id).eq('txn_ref', txn).neq('status', 'rejected').limit(1),
  ]);
  if ((byIp.count ?? 0) >= PER_IP_HOUR) throw new HttpError(429, 'Too many requests from this device. Try again in an hour, or ask the cashier.');
  if ((bySite.count ?? 0) >= PENDING_PER_SITE) throw new HttpError(429, 'Many payments are waiting for the cashier. Please try again in a few minutes, or ask the cashier.');
  if ((byPhone.count ?? 0) >= PENDING_PER_PHONE) throw new HttpError(429, 'This number already has payments waiting. Ask the cashier to confirm them first.');
  if (used.data?.length) throw new HttpError(409, 'This transaction ID was already used. Check it, or ask the cashier.');

  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: row, error } = await db
    .from('payment_requests')
    .insert({
      tenant_id: site.tenant_id,
      site_id: site.id,
      plan_id: plan.id,
      amount_ssp: plan.price_ssp,
      phone,
      provider,
      txn_ref: txn,
      claim_token_hash: await sha256(token),
      client_ip: ip,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'This transaction ID was already used. Check it, or ask the cashier.');
    throw new Error(`Payment request not saved: ${error.message}`);
  }
  // The cashiers are told at once (Telegram, if connected; and the Payments page).
  await db.rpc('raise_alert', {
    p_tenant_id: site.tenant_id,
    p_kind: 'payment_request',
    p_key: `payment:${row.id}`,
    p_title: `Payment to confirm: ${plan.name} · ${plan.price_ssp.toLocaleString('en-US')} SSP`,
    p_body: `${providerLabel(provider)} · ${phone} · ref ${txn}\nSite: ${site.name}. Check the money arrived, then Confirm on the Payments page.`,
    p_site_id: site.id,
  });
  await db.rpc('wake_alerts_sender');
  return { id: row.id as string, token };
}

async function status(db: SupabaseClient, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!id || !/^[0-9a-f]{48}$/.test(token)) throw new HttpError(404, 'Payment not found.');
  const select = 'status, reject_reason, claim_token_hash, amount_ssp, method, plans(name), vouchers(code, on_router, routers(dns_name))';
  let { data: r } = await db.from('payment_requests').select(select).eq('id', id).maybeSingle();
  if (!r || r.claim_token_hash !== (await sha256(token))) throw new HttpError(404, 'Payment not found.');
  if (r.method === 'api' && r.status === 'pending') {
    await settleMomo(db, id);
    ({ data: r } = await db.from('payment_requests').select(select).eq('id', id).maybeSingle());
    if (!r) throw new HttpError(404, 'Payment not found.');
  }
  const plan = (r.plans as unknown as { name: string } | null)?.name ?? '';
  if (r.status !== 'confirmed') return { status: r.status, plan, amount: r.amount_ssp, reason: r.reject_reason, method: r.method };
  const v = r.vouchers as unknown as { code: string; on_router: boolean; routers: { dns_name: string | null } | null } | null;
  return {
    status: 'confirmed',
    plan,
    amount: r.amount_ssp,
    code: v?.code ?? null,
    // A card made for this purchase works once it is on the router (within a minute).
    ready: Boolean(v?.on_router),
    login_host: v?.routers?.dns_name ?? null,
  };
}

interface MomoRow {
  id: string;
  tenant_id: string;
  site_id: string;
  amount_ssp: number;
  momo_ref: string;
  status: string;
  created_at: string;
  checked_at: string | null;
  momo_txn_id: string | null;
  plans: { name: string } | null;
}

/**
 * Asks MoMo how a payment went and acts on its answer: paid in full → the card and the sale;
 * failed → rejected with MoMo's reason; still waiting too long → expired. Safe to run twice at once:
 * fulfil_payment_request locks the request and only takes a pending one.
 */
async function settleMomo(db: SupabaseClient, id: string): Promise<void> {
  const { data } = await db
    .from('payment_requests')
    .select('id, tenant_id, site_id, amount_ssp, momo_ref, status, created_at, checked_at, momo_txn_id, plans(name)')
    .eq('id', id)
    .eq('method', 'api')
    .maybeSingle();
  const row = data as unknown as MomoRow | null;
  if (!row || row.status !== 'pending') return;
  if (row.checked_at && Date.now() - new Date(row.checked_at).getTime() < MOMO_CHECK_EVERY_MS) return;
  await db.from('payment_requests').update({ checked_at: new Date().toISOString() }).eq('id', id);

  const account = await momoAccount(db, row.tenant_id, true);
  if (!account) return; // login removed meanwhile: a cashier decides on the Payments page
  let paid;
  try {
    paid = await new MomoClient(account).paymentStatus(row.momo_ref);
  } catch (err) {
    console.error(`MoMo status for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return; // asked again on the next check
  }

  if (paid.status === 'SUCCESSFUL') {
    if (!paidInFull(paid, row.amount_ssp, account.currency)) {
      // Never give a card for a different amount: a cashier looks at it.
      await db.from('payment_requests').update({ momo_txn_id: paid.financialTransactionId }).eq('id', id);
      await alertCashier(db, row, `MoMo reports ${paid.amount} ${paid.currency}, not ${row.amount_ssp} ${account.currency}. Check it, then Confirm or Reject on the Payments page.`);
      return;
    }
    const { error } = await db.rpc('fulfil_payment_request', { p_id: id, p_by: null, p_momo_txn_id: paid.financialTransactionId });
    if (error && !/already/i.test(error.message)) {
      // Paid, but no card could be made (for example no router carries the plan): the money is in,
      // so the request stays waiting and the cashier is told.
      await db.from('payment_requests').update({ momo_txn_id: paid.financialTransactionId }).eq('id', id);
      await alertCashier(db, row, `Paid by MoMo (${paid.financialTransactionId ?? 'no ID'}), but no card could be made: ${error.message}`);
    }
    return;
  }
  if (paid.status === 'FAILED') {
    await db
      .from('payment_requests')
      .update({ status: 'rejected', reject_reason: momoReason(paid.reason), decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending');
    return;
  }
  if (Date.now() - new Date(row.created_at).getTime() > MOMO_GIVE_UP_MS) {
    await db
      .from('payment_requests')
      .update({ status: 'expired', reject_reason: momoReason('EXPIRED'), decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending');
  }
}

async function alertCashier(db: SupabaseClient, row: MomoRow, body: string): Promise<void> {
  await db.rpc('raise_alert', {
    p_tenant_id: row.tenant_id,
    p_kind: 'payment_request',
    p_key: `payment:${row.id}`,
    p_title: `MoMo payment to check: ${row.plans?.name ?? ''} · ${row.amount_ssp.toLocaleString('en-US')} SSP`,
    p_body: body,
    p_site_id: row.site_id,
  });
  await db.rpc('wake_alerts_sender');
}

/** The customer pays with a prompt on their phone (MTN MoMo API); no transaction ID to type. */
async function momoPay(db: SupabaseClient, req: Request, body: Record<string, unknown>) {
  const site = await siteBySlug(db, body.slug);
  const account = await momoAccount(db, site.tenant_id);
  if (!account) throw new HttpError(400, 'Paying with MTN MoMo here is not switched on. Pay another way, or ask the cashier.');
  const planId = typeof body.plan_id === 'string' && UUID_RE.test(body.plan_id) ? body.plan_id : '';
  const plan = (await sitePlans(db, site)).find((p) => p.id === planId);
  if (!plan) throw new HttpError(400, 'Choose a plan.');
  const phone = cleanPhone(body.phone);
  const msisdn = phone ? momoMsisdn(phone) : null;
  if (!phone || !msisdn) throw new HttpError(400, 'Type your MTN MoMo number.');

  const ip = clientIp(req);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [byIp, byPhone, bySite, phoneHour] = await Promise.all([
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('client_ip', ip).gte('created_at', hourAgo),
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', site.tenant_id).eq('phone', phone).eq('status', 'pending'),
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('site_id', site.id).eq('status', 'pending'),
    db.from('payment_requests').select('id', { count: 'exact', head: true }).eq('phone', phone).eq('method', 'api').gte('created_at', hourAgo),
  ]);
  if ((byIp.count ?? 0) >= PER_IP_HOUR) throw new HttpError(429, 'Too many requests from this device. Try again in an hour, or ask the cashier.');
  if ((bySite.count ?? 0) >= PENDING_PER_SITE) throw new HttpError(429, 'Many payments are waiting for the cashier. Please try again in a few minutes, or ask the cashier.');
  if ((byPhone.count ?? 0) >= PENDING_PER_PHONE) throw new HttpError(429, 'This number already has payments waiting. Ask the cashier to confirm them first.');
  if ((phoneHour.count ?? 0) >= MOMO_PER_PHONE_HOUR) throw new HttpError(429, 'Too many MoMo payments for this number. Try again in an hour, or ask the cashier.');

  const reference = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: row, error } = await db
    .from('payment_requests')
    .insert({
      tenant_id: site.tenant_id,
      site_id: site.id,
      plan_id: plan.id,
      amount_ssp: plan.price_ssp,
      phone,
      provider: 'mtn_momo',
      method: 'api',
      txn_ref: reference,
      momo_ref: reference,
      claim_token_hash: await sha256(token),
      client_ip: ip,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Payment request not saved: ${error.message}`);

  try {
    await new MomoClient(account).requestToPay({
      referenceId: reference,
      amount: plan.price_ssp,
      msisdn,
      externalId: row.id as string,
      note: `${site.tenants?.name ?? 'WiFi'}: ${plan.name}`,
    });
  } catch (err) {
    const reason = err instanceof MomoError ? err.message : 'MTN MoMo could not be reached.';
    await db.from('payment_requests').update({ status: 'rejected', reject_reason: reason.slice(0, 200), decided_at: new Date().toISOString() }).eq('id', row.id);
    if (!(err instanceof MomoError)) console.error(err instanceof Error ? err.message : String(err));
    throw new HttpError(502, `${reason} Try again, or pay another way.`);
  }
  return { id: row.id as string, token };
}

/** MoMo payments still waiting (the customer may have closed the page): settled from the database's clock. */
async function momoSweep(db: SupabaseClient, req: Request) {
  const { data: cfg } = await db.from('app_config').select('value').eq('key', 'direct_worker_secret').maybeSingle();
  if (!cfg?.value || !sameSecret(req.headers.get('x-hzc-worker') ?? '', cfg.value as string)) throw new HttpError(403, 'Forbidden');
  const { data: rows } = await db
    .from('payment_requests')
    .select('id')
    .eq('method', 'api')
    .eq('status', 'pending')
    .order('created_at')
    .limit(50);
  for (const r of rows ?? []) await settleMomo(db, r.id as string);
  return { checked: rows?.length ?? 0 };
}

serveJson(async (req) => {
  const db = serviceClient();
  const body = await readBody(req);
  switch (body.action) {
    case 'site': {
      const site = await siteBySlug(db, body.slug);
      return {
        site: site.name,
        business: site.tenants?.name ?? '',
        logo_url: site.tenants?.logo_url ?? null,
        instructions: site.buy_instructions ?? '',
        plans: await sitePlans(db, site),
        providers: PROVIDERS.map((p) => ({ id: p, label: providerLabel(p) })),
        momo_api: await momoEnabled(db, site.tenant_id),
      };
    }
    case 'request':
      return await request(db, req, body);
    case 'status':
      return await status(db, body);
    case 'momo_pay':
      return await momoPay(db, req, body);
    case 'momo_sweep':
      return await momoSweep(db, req);
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});
