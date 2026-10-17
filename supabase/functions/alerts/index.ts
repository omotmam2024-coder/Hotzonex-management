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
import { formatWhatsAppNumber, WA_NUMBER_RE, waInstallScript } from '../_shared/whatsapp.ts';

const TELEGRAM = 'https://api.telegram.org';
const LINK_MINUTES = 30;
const MAX_ATTEMPTS = 5;

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
  state: 'starting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out';
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

async function sendPending(db: SupabaseClient): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, error } = await db
    .from('alerts')
    .select('id, tenant_id, kind, title, body, created_at, send_attempts, telegram_sent_at, whatsapp_sent_at, tenants(name)')
    .is('sent_at', null)
    .lt('send_attempts', MAX_ATTEMPTS)
    .gte('created_at', since)
    .order('created_at')
    .limit(100);
  if (error) throw new Error(`Alerts lookup failed: ${error.message}`);
  const alerts = (rows ?? []) as unknown as (AlertRow & {
    id: string;
    tenant_id: string;
    send_attempts: number;
    telegram_sent_at: string | null;
    whatsapp_sent_at: string | null;
    tenants: { name: string } | null;
  })[];
  if (!alerts.length) return { sent: 0, skipped: 0, failed: 0 };

  const tenants = [...new Set(alerts.map((a) => a.tenant_id))];
  const { data: settingRows } = await db.from('alert_settings').select('*').in('tenant_id', tenants);
  const settings = new Map(((settingRows ?? []) as (AlertSettings & { tenant_id: string; whatsapp_numbers: string[] | null })[]).map((s) => [s.tenant_id, s]));
  const waCfg = await waConfig(db);
  let waDown = false; // the sender is offline: stop trying it for the rest of this run

  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const a of alerts) {
    const s = settings.get(a.tenant_id);
    const wanted = !!s && wantsAlert(s, a.kind);
    const numbers = (s?.whatsapp_numbers ?? []).filter((n) => WA_NUMBER_RE.test(n));
    const wantTg = wanted && !!botToken() && !!s?.telegram_chat_id && !a.telegram_sent_at;
    const wantWa = wanted && !!waCfg && numbers.length > 0 && !a.whatsapp_sent_at;
    const now = new Date().toISOString();

    if (!wantTg && !wantWa) {
      // Kept in the app's alert list; nothing (more) to send.
      const reason = a.telegram_sent_at || a.whatsapp_sent_at ? null : !wanted ? 'switched off' : 'no Telegram chat or WhatsApp number';
      await db.from('alerts').update({ sent_at: now, send_error: reason }).eq('id', a.id);
      out.skipped++;
      continue;
    }

    const text = alertMessage(a, a.tenants?.name ?? '');
    const errors: string[] = [];
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
            await wa(waCfg!, '/send', { to: n, text });
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
        if (delivered > 0) patch.whatsapp_sent_at = now;
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
    const st = await wa<WaStatus>(c, '/status');
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
  const { data: s } = await db.from('alert_settings').select('whatsapp_numbers').eq('tenant_id', caller.tenantId).maybeSingle();
  const numbers = ((s?.whatsapp_numbers as string[] | null) ?? []).filter((n) => WA_NUMBER_RE.test(n));
  if (!numbers.length) throw new HttpError(400, 'Add a WhatsApp number first.');
  const { data: t } = await db.from('tenants').select('name').eq('id', caller.tenantId).maybeSingle();
  const text = `✅ ${t?.name ?? 'Hotzonex'}: test alert from Hotzonex Cloud. Alerts will come to this WhatsApp.`;
  const sent: string[] = [];
  const failed: string[] = [];
  for (const n of numbers) {
    try {
      await wa(c, '/send', { to: n, text });
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

async function whatsappLogout(db: SupabaseClient, req: Request) {
  const caller = await requirePlatformAdmin(req, db);
  const c = await waConfig(db);
  if (!c) throw new HttpError(400, 'The WhatsApp sender is not installed.');
  await wa(c, '/logout', {});
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
