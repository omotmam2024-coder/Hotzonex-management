// alerts: sends the businesses' alerts to Telegram and connects a business to its Telegram chat.
//
// The Telegram bot is Hotzonex Cloud's own; its token is the Edge Function secret
// TELEGRAM_BOT_TOKEN (set in Supabase → Edge Functions → Secrets). Without it nothing is sent and
// the app says so.
//
// POST { action: "send" }      x-hzc-worker secret (from alerts_scan via pg_net): sends new alerts.
// POST { action: "link" }      admin: a link that opens the bot and connects this business's chat.
// POST { action: "test" }      admin: sends a test message to the connected chat.
// POST { action: "unlink" }    admin: stops sending to Telegram.
// POST <Telegram update>       from Telegram (x-telegram-bot-api-secret-token): "/start <code>" connects, "/stop" disconnects.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { corsHeaders, HttpError, json } from '../_shared/cors.ts';
import { alertMessage, LINK_CODE_RE, wantsAlert, type AlertRow, type AlertSettings } from '../_shared/alerts.ts';

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
// Sending
// ---------------------------------------------------------------------------

async function sendPending(db: SupabaseClient): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, error } = await db
    .from('alerts')
    .select('id, tenant_id, kind, title, body, created_at, send_attempts, tenants(name)')
    .is('sent_at', null)
    .lt('send_attempts', MAX_ATTEMPTS)
    .gte('created_at', since)
    .order('created_at')
    .limit(100);
  if (error) throw new Error(`Alerts lookup failed: ${error.message}`);
  const alerts = (rows ?? []) as unknown as (AlertRow & { id: string; tenant_id: string; send_attempts: number; tenants: { name: string } | null })[];
  if (!alerts.length) return { sent: 0, skipped: 0, failed: 0 };

  const tenants = [...new Set(alerts.map((a) => a.tenant_id))];
  const { data: settingRows } = await db.from('alert_settings').select('*').in('tenant_id', tenants);
  const settings = new Map(((settingRows ?? []) as (AlertSettings & { tenant_id: string })[]).map((s) => [s.tenant_id, s]));

  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const a of alerts) {
    const s = settings.get(a.tenant_id);
    if (!botToken() || !s?.telegram_chat_id || !wantsAlert(s, a.kind)) {
      // Kept in the app's alert list; nothing to send.
      await db.from('alerts').update({ sent_at: new Date().toISOString(), send_error: !botToken() ? 'telegram not set up' : !s?.telegram_chat_id ? 'no chat' : 'switched off' }).eq('id', a.id);
      out.skipped++;
      continue;
    }
    try {
      await telegram('sendMessage', { chat_id: s.telegram_chat_id, text: alertMessage(a, a.tenants?.name ?? ''), disable_web_page_preview: true });
      await db.from('alerts').update({ sent_at: new Date().toISOString(), send_error: null }).eq('id', a.id);
      out.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A chat that blocked the bot or was deleted: stop sending there.
      if (/chat not found|bot was blocked|kicked|deactivated/i.test(msg)) {
        await db.from('alert_settings').update({ telegram_chat_id: null, telegram_chat_title: null }).eq('tenant_id', a.tenant_id);
      }
      await db.from('alerts').update({ send_attempts: a.send_attempts + 1, send_error: msg.slice(0, 300) }).eq('id', a.id);
      out.failed++;
    }
  }
  return out;
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err instanceof Error ? err.message : String(err));
    return json({ error: 'The server could not finish this request. Please try again.' }, 500);
  }
});
