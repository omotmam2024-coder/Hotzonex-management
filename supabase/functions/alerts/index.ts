// alerts: sends the businesses' alerts to Telegram and WhatsApp, and connects a business to them.
//
// Telegram: the bot is Hotzonex Cloud's own; its token is the Edge Function secret
// TELEGRAM_BOT_TOKEN (set in Supabase → Edge Functions → Secrets).
// WhatsApp: Hotzonex Cloud's sender number is linked to a small program on the tunnel server
// (see _shared/whatsapp.ts); app_config holds its address (whatsapp_url) and secret (whatsapp_secret).
// Without either, that way of sending is skipped and the app says so.
//
// POST { action: "send" }              x-hzc-worker secret (from alerts_scan via pg_net): sends new alerts.
// POST { action: "link" }              admin: a link that opens the bot and connects this business's chat.
// POST { action: "test" }              admin: sends a test message to the connected chat.
// POST { action: "unlink" }            admin: stops sending to Telegram.
// POST { action: "whatsapp_status" }   admin: is the WhatsApp sender ready (platform admins also get its QR code).
// POST { action: "whatsapp_test" }     admin: sends a test message to the business's WhatsApp numbers.
// POST { action: "whatsapp_setup" }    platform admin: the install command for the tunnel server.
// POST { action: "whatsapp_logout" }   platform admin: unlinks the sender phone.
// GET  ?f=wa-install                   the WhatsApp sender installer (holds no secret).
// POST <Telegram update>               from Telegram (x-telegram-bot-api-secret-token): "/start <code>" connects, "/stop" disconnects.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, requireAdmin, requirePlatformAdmin, serviceClient } from '../_shared/auth.ts';
import { corsFor, HttpError, json } from '../_shared/cors.ts';
import { alertMessage, LINK_CODE_RE, wantsAlert, type AlertRow, type AlertSettings } from '../_shared/alerts.ts';
import { formatWhatsAppNumber, normalizeWhatsAppNumber, WA_NUMBER_RE, WA_PLATFORM_SID, waInstallScript } from '../_shared/whatsapp.ts';
import {
  BILLING_CODES,
  BILLING_LABELS,
  BILLING_VARS,
  billingCode,
  billingDate,
  billingDays,
  billingInvoiceId,
  cleanTemplates,
  DEFAULT_TEMPLATES,
  isLang,
  LANGS,
  PRICE_UNIT,
  renderBilling,
  ssp,
  unknownVars,
  type Lang,
  type Templates,
} from '../_shared/billing-messages.ts';

const TELEGRAM = 'https://api.telegram.org';
const LINK_MINUTES = 30;
const MAX_ATTEMPTS = 5;
/** WhatsApp alerts per business per hour: protects the sender number from being blocked as spam
 *  (e.g. if someone floods a Buy page). Above it alerts still show in the app and on Telegram. */
const WA_PER_HOUR = 20;
/** Test messages per business per 10 minutes. */
const WA_TESTS_PER_10_MIN = 3;

function botToken(): string | null {
  return Deno.env.get('TELEGRAM_BOT_TOKEN') || null;
}

async function telegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = botToken();
  if (!token) throw new HttpError(503, 'Telegram is not set up yet: add the TELEGRAM_BOT_TOKEN secret in Supabase.');
  const res = await fetch(`${TELEGRAM}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!out.ok) throw new Error(`Telegram ${method}: ${out.description ?? res.status}`);
  return out.result as T;
}

async function config(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from('app_config').select('value').eq('key', key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

/** Same comparison time whatever matches, so the secret cannot be guessed byte by byte. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// WhatsApp sender (on the tunnel server)
// ---------------------------------------------------------------------------

interface WaConfig {
  url: string;
  secret: string;
}

interface WaStatus {
  state: 'none' | 'starting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out';
  me: string | null;
  since: string;
  qr: string | null;
}

class WaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function waConfig(db: SupabaseClient): Promise<WaConfig | null> {
  const [url, secret] = await Promise.all([config(db, 'whatsapp_url'), config(db, 'whatsapp_secret')]);
  return url && secret ? { url, secret } : null;
}

async function wa<T>(c: WaConfig, path: string, body?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-hzc-wa': c.secret, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WaError(503, 'The WhatsApp sender on the tunnel server cannot be reached.');
  }
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new WaError(res.status, out.error ?? `The WhatsApp sender answered ${res.status}.`);
  return out;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Billing messages in the business's language
// ---------------------------------------------------------------------------

async function customTemplates(db: SupabaseClient): Promise<Partial<Templates>> {
  const raw = await config(db, 'billing_templates');
  if (!raw) return {};
  try {
    return cleanTemplates(JSON.parse(raw));
  } catch {
    return {};
  }
}

type BillingAlert = { tenant_id: string; key: string; tenants: { name: string } | null };

/** What the billing messages need: invoices, trial ends, prices, routers, payment instructions. */
async function billingContext(db: SupabaseClient, alerts: BillingAlert[]) {
  const contactPhone = new Map<string, string>();
  if (!alerts.length) return { contactPhone, render: () => null as string | null };
  const tenants = [...new Set(alerts.map((a) => a.tenant_id))];
  const invoiceIds = [...new Set(alerts.map((a) => billingInvoiceId(a.key)).filter((id): id is string => !!id))];
  const [custom, howto, std, tb, inv, routers] = await Promise.all([
    customTemplates(db),
    config(db, 'billing_instructions'),
    config(db, 'billing_price_per_router_ssp'),
    db.from('tenant_billing').select('tenant_id, contact_phone, trial_ends_at, price_per_router_ssp, subscription_plans(price_per_router_ssp)').in('tenant_id', tenants),
    invoiceIds.length
      ? db.from('invoices').select('id, number, amount_ssp, period_start, period_end, due_at').in('id', invoiceIds)
      : Promise.resolve({ data: [] as unknown[] }),
    db.from('routers').select('tenant_id').in('tenant_id', tenants).neq('status', 'pending'),
  ]);
  type Tb = { tenant_id: string; contact_phone: string | null; trial_ends_at: string | null; price_per_router_ssp: number | null; subscription_plans: { price_per_router_ssp: number | null } | null };
  type Inv = { id: string; number: string; amount_ssp: number; period_start: string; period_end: string; due_at: string };
  const billingRows = new Map(((tb.data ?? []) as unknown as Tb[]).map((r) => [r.tenant_id, r]));
  const invoices = new Map(((inv.data ?? []) as Inv[]).map((r) => [r.id, r]));
  const routerCount = new Map<string, number>();
  for (const r of (routers.data ?? []) as { tenant_id: string }[]) routerCount.set(r.tenant_id, (routerCount.get(r.tenant_id) ?? 0) + 1);
  for (const r of billingRows.values()) {
    const n = r.contact_phone ? normalizeWhatsAppNumber(r.contact_phone) : null;
    if (n) contactPhone.set(r.tenant_id, n);
  }

  const render = (a: BillingAlert, lang: Lang): string | null => {
    const code = billingCode(a.key);
    if (!code) return null;
    const b = billingRows.get(a.tenant_id);
    const price = b?.price_per_router_ssp ?? b?.subscription_plans?.price_per_router_ssp ?? (Number(std) || 0);
    const i = invoices.get(billingInvoiceId(a.key) ?? '');
    const days = billingDays(a.key);
    const vars: Record<string, string | number | null> = {
      business: a.tenants?.name ?? '',
      days,
      price: price > 0 ? `${ssp(price)} ${PRICE_UNIT[lang]}` : '',
      pay: howto ?? '',
      invoice: i?.number ?? null,
      amount: i ? ssp(i.amount_ssp) : null,
      period: i ? `${billingDate(i.period_start)} – ${billingDate(i.period_end)}` : null,
      due: i ? billingDate(i.due_at) : null,
      date: code === 'trial_ending' ? billingDate(b?.trial_ends_at) : i ? billingDate(i.period_end) : null,
    };
    if (code === 'renew_soon') vars.amount = ssp(Math.max(routerCount.get(a.tenant_id) ?? 0, 1) * price);
    // A message that needs an invoice we cannot find falls back to the plain English alert.
    if (['invoice', 'due_soon', 'suspended', 'paid', 'renew_soon'].includes(code) && !i) return null;
    return renderBilling(code, lang, vars, custom);
  };
  return { contactPhone, render };
}

async function sendPending(db: SupabaseClient): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, error } = await db
    .from('alerts')
    .select('id, tenant_id, kind, key, title, body, created_at, send_attempts, telegram_sent_at, whatsapp_sent_at, tenants(name)')
    .is('sent_at', null)
    .lt('send_attempts', MAX_ATTEMPTS)
    .gte('created_at', since)
    .order('created_at')
    .limit(100);
  if (error) throw new Error(`Alerts lookup failed: ${error.message}`);
  const alerts = (rows ?? []) as unknown as (AlertRow & {
    id: string;
    tenant_id: string;
    key: string;
    send_attempts: number;
    telegram_sent_at: string | null;
    whatsapp_sent_at: string | null;
    tenants: { name: string } | null;
  })[];
  if (!alerts.length) return { sent: 0, skipped: 0, failed: 0 };

  const tenants = [...new Set(alerts.map((a) => a.tenant_id))];
  const { data: settingRows } = await db.from('alert_settings').select('*').in('tenant_id', tenants);
  const settings = new Map(
    ((settingRows ?? []) as (AlertSettings & { tenant_id: string; whatsapp_numbers: string[] | null; lang: string | null })[]).map((s) => [s.tenant_id, s]),
  );
  const billing = await billingContext(db, alerts.filter((a) => a.kind === 'billing'));
  const waCfg = await waConfig(db);
  let waDown = false; // the sender is offline: stop trying it for the rest of this run
  // WhatsApp alerts each business got in the last hour (counted once, then kept up to date here).
  const waSentHour = new Map<string, number>();
  if (waCfg) {
    const { data: recent } = await db
      .from('alerts')
      .select('tenant_id')
      .in('tenant_id', tenants)
      .gte('whatsapp_sent_at', new Date(Date.now() - 3600_000).toISOString());
    for (const r of (recent ?? []) as { tenant_id: string }[]) waSentHour.set(r.tenant_id, (waSentHour.get(r.tenant_id) ?? 0) + 1);
  }

  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const a of alerts) {
    const s = settings.get(a.tenant_id);
    const isBilling = a.kind === 'billing';
    // Billing messages always go, even to a business that never opened its alert settings.
    const wanted = isBilling || (!!s && wantsAlert(s, a.kind));
    let numbers = (s?.whatsapp_numbers ?? []).filter((n) => WA_NUMBER_RE.test(n));
    if (isBilling && !numbers.length) {
      // No alert numbers saved: billing messages go to the phone given at sign-up.
      const contact = billing.contactPhone.get(a.tenant_id);
      if (contact) numbers = [contact];
    }
    const wantTg = wanted && !!botToken() && !!s?.telegram_chat_id && !a.telegram_sent_at;
    let wantWa = wanted && !!waCfg && numbers.length > 0 && !a.whatsapp_sent_at;
    const now = new Date().toISOString();
    let waNote: string | null = null;
    if (wantWa && (waSentHour.get(a.tenant_id) ?? 0) >= WA_PER_HOUR) {
      wantWa = false;
      waNote = `WhatsApp: more than ${WA_PER_HOUR} alerts this hour, not sent there`;
    }

    if (!wantTg && !wantWa) {
      // Kept in the app's alert list; nothing (more) to send.
      const reason = waNote ?? (a.telegram_sent_at || a.whatsapp_sent_at ? null : !wanted ? 'switched off' : 'no Telegram chat or WhatsApp number');
      await db.from('alerts').update({ sent_at: now, send_error: reason }).eq('id', a.id);
      out.skipped++;
      continue;
    }

    const text = (isBilling && billing.render(a, isLang(s?.lang) ? s.lang : 'en')) || alertMessage(a, a.tenants?.name ?? '');
    const errors: string[] = waNote ? [waNote] : [];
    const patch: Record<string, unknown> = {};
    if (wantTg) {
      try {
        await telegram('sendMessage', { chat_id: s!.telegram_chat_id, text, disable_web_page_preview: true });
        patch.telegram_sent_at = now;
      } catch (err) {
        const msg = errorText(err);
        // A chat that blocked the bot or was deleted: stop sending there.
        if (/chat not found|bot was blocked|kicked|deactivated/i.test(msg)) {
          await db.from('alert_settings').update({ telegram_chat_id: null, telegram_chat_title: null }).eq('tenant_id', a.tenant_id);
        }
        errors.push(`Telegram: ${msg}`);
      }
    }
    if (wantWa) {
      if (waDown) {
        errors.push('WhatsApp: the sender is not connected');
      } else {
        let delivered = 0;
        for (const n of numbers) {
          try {
            await wa(waCfg!, `/${WA_PLATFORM_SID}/send`, { to: n, text });
            delivered++;
          } catch (err) {
            errors.push(`WhatsApp ${formatWhatsAppNumber(n)}: ${errorText(err)}`);
            if (err instanceof WaError && err.status === 503) {
              waDown = true;
              break;
            }
          }
        }
        // Delivered to at least one number: done (a wrong number would never succeed on retry).
        if (delivered > 0) {
          patch.whatsapp_sent_at = now;
          waSentHour.set(a.tenant_id, (waSentHour.get(a.tenant_id) ?? 0) + 1);
        }
      }
    }

    const pending = (wantTg && !patch.telegram_sent_at) || (wantWa && !patch.whatsapp_sent_at);
    if (pending) {
      patch.send_attempts = a.send_attempts + 1;
      out.failed++;
    } else {
      patch.sent_at = now;
      out.sent++;
    }
    patch.send_error = errors.length ? errors.join('; ').slice(0, 300) : null;
    await db.from('alerts').update(patch).eq('id', a.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// WhatsApp: status, test, set-up (platform), log out (platform)
// ---------------------------------------------------------------------------

async function whatsappStatus(db: SupabaseClient, req: Request) {
  const caller = await requireAdmin(req, db);
  const c = await waConfig(db);
  if (!c) return { installed: false, connected: false };
  try {
    let st = await wa<WaStatus>(c, `/${WA_PLATFORM_SID}/status`);
    // Installed but never linked (or unlinked): start it so the platform admin sees a QR code.
    if (st.state === 'none' && caller.isPlatformAdmin) st = await wa<WaStatus>(c, `/${WA_PLATFORM_SID}/link`, {});
    const base = { installed: true, reachable: true, connected: st.state === 'connected', sender: st.me ? formatWhatsAppNumber(st.me) : null };
    return caller.isPlatformAdmin ? { ...base, state: st.state, since: st.since, qr: st.qr } : base;
  } catch (err) {
    return { installed: true, reachable: false, connected: false, sender: null, ...(caller.isPlatformAdmin ? { error: errorText(err) } : {}) };
  }
}

async function whatsappTest(db: SupabaseClient, req: Request) {
  const caller = await requireAdmin(req, db);
  const c = await waConfig(db);
  if (!c) throw new HttpError(400, 'WhatsApp sending is not set up yet. Ask Hotzonex Cloud.');
  const { data: s } = await db.from('alert_settings').select('whatsapp_numbers, lang').eq('tenant_id', caller.tenantId).maybeSingle();
  const numbers = ((s?.whatsapp_numbers as string[] | null) ?? []).filter((n) => WA_NUMBER_RE.test(n));
  if (!numbers.length) throw new HttpError(400, 'Add a WhatsApp number first.');
  const { count } = await db
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', caller.tenantId)
    .eq('action', 'alerts.whatsapp_test')
    .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= WA_TESTS_PER_10_MIN) throw new HttpError(429, 'Too many test messages. Wait 10 minutes and try again.');
  await audit(db, caller, 'alerts.whatsapp_test', { numbers: numbers.length });
  const { data: t } = await db.from('tenants').select('name').eq('id', caller.tenantId).maybeSingle();
  const name = t?.name ?? 'Hotzonex';
  const lang: Lang = isLang(s?.lang) ? s.lang : 'en';
  const text = {
    en: `✅ ${name}: test message from Hotzonex Cloud. Alerts and billing reminders will come to this WhatsApp.`,
    ar: `✅ ${name}: رسالة تجريبية من Hotzonex Cloud. ستصلك التنبيهات وتذكيرات الفواتير على هذا الواتساب.`,
    sw: `✅ ${name}: ujumbe wa majaribio kutoka Hotzonex Cloud. Arifa na vikumbusho vya malipo vitakuja kwenye WhatsApp hii.`,
  }[lang];
  const sent: string[] = [];
  const failed: string[] = [];
  for (const n of numbers) {
    try {
      await wa(c, `/${WA_PLATFORM_SID}/send`, { to: n, text });
      sent.push(formatWhatsAppNumber(n));
    } catch (err) {
      if (err instanceof WaError && err.status === 503) throw new HttpError(503, 'The WhatsApp sender is not connected right now. Try again later.');
      failed.push(`${formatWhatsAppNumber(n)}: ${errorText(err)}`);
    }
  }
  return { sent, failed };
}

async function whatsappSetup(db: SupabaseClient, req: Request) {
  const caller = await requirePlatformAdmin(req, db);
  const relay = await config(db, 'tunnel_relay_url');
  if (!relay) throw new HttpError(400, 'Set up the tunnel server first (Routers → Tunnel server). The WhatsApp sender runs on it.');
  let secret = await config(db, 'whatsapp_secret');
  if (!secret) {
    secret = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { error } = await db.from('app_config').upsert(
    [
      { key: 'whatsapp_secret', value: secret },
      { key: 'whatsapp_url', value: `${relay.replace(/\/$/, '')}/wa` },
    ],
    { onConflict: 'key' },
  );
  if (error) throw new Error(`Could not save the WhatsApp settings: ${error.message}`);
  await audit(db, caller, 'alerts.whatsapp_setup', {});
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  return { command: `curl -fsSL "${base}/functions/v1/alerts?f=wa-install" | sudo HZC_WA_SECRET=${secret} bash` };
}

/** Platform admin: the billing messages (defaults and the saved custom texts) for the editor. */
async function billingTemplates(db: SupabaseClient, req: Request) {
  await requirePlatformAdmin(req, db);
  return {
    codes: BILLING_CODES.map((code) => ({ code, label: BILLING_LABELS[code], vars: BILLING_VARS[code] })),
    langs: LANGS,
    defaults: DEFAULT_TEMPLATES,
    custom: await customTemplates(db),
  };
}

async function billingTemplatesSave(db: SupabaseClient, req: Request, body: Record<string, unknown>) {
  const caller = await requirePlatformAdmin(req, db);
  const custom = cleanTemplates(body.custom);
  for (const code of BILLING_CODES) {
    for (const lang of LANGS) {
      const t = custom[code]?.[lang];
      if (!t) continue;
      const bad = unknownVars(code, t);
      if (bad.length) throw new HttpError(400, `"${BILLING_LABELS[code]}" (${lang}): {${bad.join('}, {')}} is not a word this message knows.`);
      // Same as the default: no need to keep a copy.
      if (t === DEFAULT_TEMPLATES[code][lang]) delete custom[code]![lang];
    }
  }
  const { error } = await db.from('app_config').upsert({ key: 'billing_templates', value: JSON.stringify(custom) }, { onConflict: 'key' });
  if (error) throw new Error(`Could not save the billing messages: ${error.message}`);
  await audit(db, caller, 'billing.templates_saved', { changed: Object.keys(custom) });
  return { custom };
}

async function whatsappLogout(db: SupabaseClient, req: Request) {
  const caller = await requirePlatformAdmin(req, db);
  const c = await waConfig(db);
  if (!c) throw new HttpError(400, 'The WhatsApp sender is not installed.');
  await wa(c, `/${WA_PLATFORM_SID}/logout`, {});
  await audit(db, caller, 'alerts.whatsapp_logout', {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Connecting a business's chat
// ---------------------------------------------------------------------------

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

async function link(db: SupabaseClient, req: Request) {
  const caller = await requireAdmin(req, db);
  const me = await telegram<{ username: string }>('getMe', {});
  // The bot sends its messages here; set every time (cheap, and repairs a changed address).
  const secret = await config(db, 'telegram_webhook_secret');
  if (!secret) throw new Error('telegram_webhook_secret is missing');
  await telegram('setWebhook', { url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/alerts`, secret_token: secret, allowed_updates: ['message'] });
  const code = randomCode();
  const { error } = await db.from('alert_settings').upsert(
    { tenant_id: caller.tenantId, link_code: code, link_code_expires_at: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() },
    { onConflict: 'tenant_id' },
  );
  if (error) throw new Error(`Could not save the link: ${error.message}`);
  return { bot: me.username, url: `https://t.me/${me.username}?start=${code}`, expires_minutes: LINK_MINUTES };
}

async function test(db: SupabaseClient, req: Request) {
  const caller = await requireAdmin(req, db);
  const { data: s } = await db.from('alert_settings').select('telegram_chat_id').eq('tenant_id', caller.tenantId).maybeSingle();
  if (!s?.telegram_chat_id) throw new HttpError(400, 'Connect a Telegram chat first.');
  const { data: t } = await db.from('tenants').select('name').eq('id', caller.tenantId).maybeSingle();
  await telegram('sendMessage', { chat_id: s.telegram_chat_id, text: `✅ ${t?.name ?? 'Hotzonex'}: test alert from Hotzonex Cloud. Alerts will come here.` });
  return { sent: true };
}

async function unlink(db: SupabaseClient, req: Request) {
  const caller = await requireAdmin(req, db);
  await db.from('alert_settings').update({ telegram_chat_id: null, telegram_chat_title: null, link_code: null }).eq('tenant_id', caller.tenantId);
  await audit(db, caller, 'alerts.telegram_unlinked', {});
  return { unlinked: true };
}

/** A message to the bot: "/start <code>" from the link in the app connects that chat; "/stop" disconnects it. */
async function telegramUpdate(db: SupabaseClient, update: Record<string, unknown>): Promise<void> {
  const message = update.message as { text?: string; chat?: { id: number; title?: string; first_name?: string; username?: string } } | undefined;
  const chat = message?.chat;
  const text = (message?.text ?? '').trim();
  if (!chat) return;
  const chatId = String(chat.id);
  const title = chat.title ?? chat.first_name ?? chat.username ?? 'Telegram';

  if (/^\/stop\b/.test(text)) {
    await db.from('alert_settings').update({ telegram_chat_id: null, telegram_chat_title: null }).eq('telegram_chat_id', chatId);
    await telegram('sendMessage', { chat_id: chatId, text: 'Hotzonex alerts stopped for this chat.' });
    return;
  }
  const code = /^\/start(?:@\w+)?\s+(\S+)/.exec(text)?.[1] ?? '';
  if (!LINK_CODE_RE.test(code)) {
    await telegram('sendMessage', { chat_id: chatId, text: 'To get alerts here, open Hotzonex Cloud → Alerts → Connect Telegram.' });
    return;
  }
  const { data: s } = await db
    .from('alert_settings')
    .select('tenant_id, link_code_expires_at, tenants(name)')
    .eq('link_code', code)
    .maybeSingle();
  if (!s || new Date(s.link_code_expires_at as string).getTime() < Date.now()) {
    await telegram('sendMessage', { chat_id: chatId, text: 'This link has expired. Open Hotzonex Cloud → Alerts → Connect Telegram again.' });
    return;
  }
  await db
    .from('alert_settings')
    .update({ telegram_chat_id: chatId, telegram_chat_title: title, link_code: null, link_code_expires_at: null, updated_at: new Date().toISOString() })
    .eq('tenant_id', s.tenant_id);
  await db.from('audit_log').insert({ tenant_id: s.tenant_id, user_id: null, action: 'alerts.telegram_linked', details: { chat: title } });
  const name = (s.tenants as unknown as { name: string } | null)?.name ?? 'your business';
  await telegram('sendMessage', { chat_id: chatId, text: `✅ Connected. Hotzonex alerts for ${name} will come to this chat. Send /stop to end them.` });
}

Deno.serve(async (req) => {
  const res = await handle(req);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method === 'GET' && new URL(req.url).searchParams.get('f') === 'wa-install') {
    return new Response(waInstallScript(), { headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const db = serviceClient();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const tgSecret = req.headers.get('x-telegram-bot-api-secret-token');
    if (tgSecret !== null) {
      const expected = await config(db, 'telegram_webhook_secret');
      if (!expected || !sameSecret(tgSecret, expected)) return json({ error: 'Forbidden' }, 403);
      // Telegram retries anything but 200, so a failure is logged and answered with 200.
      await telegramUpdate(db, body).catch((err) => console.error(`Telegram update: ${err instanceof Error ? err.message : err}`));
      return json({ ok: true });
    }

    switch (body.action) {
      case 'send': {
        const expected = await config(db, 'direct_worker_secret');
        if (!expected || !sameSecret(req.headers.get('x-hzc-worker') ?? '', expected)) return json({ error: 'Forbidden' }, 403);
        return json(await sendPending(db));
      }
      case 'link':
        return json(await link(db, req));
      case 'test':
        return json(await test(db, req));
      case 'unlink':
        return json(await unlink(db, req));
      case 'whatsapp_status':
        return json(await whatsappStatus(db, req));
      case 'whatsapp_test':
        return json(await whatsappTest(db, req));
      case 'whatsapp_setup':
        return json(await whatsappSetup(db, req));
      case 'whatsapp_logout':
        return json(await whatsappLogout(db, req));
      case 'billing_templates':
        return json(await billingTemplates(db, req));
      case 'billing_templates_save':
        return json(await billingTemplatesSave(db, req, body));
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof WaError) return json({ error: err.message }, err.status === 503 ? 503 : 502);
    console.error(err instanceof Error ? err.message : String(err));
    return json({ error: 'The server could not finish this request. Please try again.' }, 500);
  }
}
