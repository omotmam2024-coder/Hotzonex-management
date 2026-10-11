// tunnel: the endpoint the admin's tunnel server (VPS) talks to. No user login.
//   GET  ?f=install             → bash installer (contains no secret; the secret is passed as HZC_SECRET)
//   GET  ?f=peers               → WireGuard [Peer] sections for every tunnel router   (x-hzc-relay header)
//   POST ?f=register  {public_key, relay_url, endpoint}  → saves the VPS details     (x-hzc-relay header)
// The relay secret is created by an admin in Hotzonex (add-router, action "tunnel_server").
import { serviceClient } from '../_shared/auth.ts';
import { peersConfig, vpsInstallScript, WG_KEY_RE } from '../_shared/tunnel.ts';

function reply(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Constant-time comparison of two strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const f = url.searchParams.get('f') ?? '';

  if (req.method === 'GET' && f === 'install') {
    const base = Deno.env.get('SUPABASE_URL');
    if (!base) return reply('Server error.', 500);
    return reply(vpsInstallScript(base));
  }

  try {
    const db = serviceClient();
    const { data: cfg } = await db.from('app_config').select('value').eq('key', 'tunnel_relay_secret').maybeSingle();
    const secret = req.headers.get('x-hzc-relay') ?? '';
    if (!cfg?.value || !secret || !same(secret, cfg.value as string)) return reply('Not allowed.', 401);

    if (req.method === 'GET' && f === 'peers') {
      const { data, error } = await db.from('routers').select('name, tunnel_ip, wg_public_key').eq('connection', 'tunnel').order('tunnel_ip');
      if (error) throw new Error(error.message);
      return reply(peersConfig(data ?? []));
    }

    if (req.method === 'POST' && f === 'register') {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const publicKey = typeof body.public_key === 'string' ? body.public_key.trim() : '';
      const relayUrl = typeof body.relay_url === 'string' ? body.relay_url.trim().replace(/\/$/, '') : '';
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
      if (!WG_KEY_RE.test(publicKey)) return reply('Invalid public key.', 400);
      if (!/^https:\/\/[a-z0-9.-]{1,253}$/i.test(relayUrl)) return reply('Invalid relay URL.', 400);
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(endpoint) && !/^[a-z0-9.-]{1,253}$/i.test(endpoint)) return reply('Invalid endpoint.', 400);
      const { error } = await db.from('app_config').upsert([
        { key: 'tunnel_vps_public_key', value: publicKey },
        { key: 'tunnel_relay_url', value: relayUrl },
        { key: 'tunnel_endpoint', value: endpoint },
      ]);
      if (error) throw new Error(error.message);
      return reply('Registered.');
    }

    return reply('Not found.', 404);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return reply('Server error.', 500);
  }
});
