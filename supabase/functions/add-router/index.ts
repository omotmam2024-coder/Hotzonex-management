// add-router: saves a router from the simple form (address, port, username, password, comment)
// and queues its first check. Admins only.
//
// How Hotzonex reaches the router depends on the address:
//   private (192.168.x.x, 10.x.x.x, …)  → the address only works inside the router's own network:
//       "tunnel" when the admin's tunnel server (VPS) is set up: a one-time script adds a WireGuard
//           tunnel to it; nothing is scheduled on the router. The password is stored encrypted.
//       "cloud" otherwise: a one-time script adds the hzc-cloud scheduler that calls Hotzonex.
//           No password is stored; only the SHA-256 of a random token.
//   public IP or DNS name               → "direct": Hotzonex logs in to the router's REST API with the
//       username and password (encrypted with AES-256-GCM, key in Supabase Vault).
// The hotspot server and its DNS name are read from the router at the first check.
//
// POST { action: "create", host, port?, username, password, comment?, site_id? }
//   → { router_id, job_id, connection, script? }      (script for cloud routers)
// POST { action: "update", router_id, …same fields (password blank = keep), hotspot_server?, dns_name? }
//   → { router_id, job_id, connection, script? }
// POST { action: "setup", router_id, new_key? }  (cloud and tunnel routers) → { script }   (new token / new tunnel key;
//   a connected tunnel router needs new_key: true, because the new key disconnects it until the script is pasted)
// POST { action: "tunnel_server" }  → { ready, relay_url, endpoint, command? }   (creates the relay secret once;
//   the install command, which holds the secret, only for platform admins: the tunnel server is shared)
// Every router, site and job stays inside the caller's business.
// POST { action: "tunnel_switch", router_id, port, username, password }  → { router_id, job_id, connection, script }
//   moves a script-connected router to the tunnel (its script removes the hzc-cloud scheduler).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, type Caller, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { setupScript } from '../_shared/routeros.ts';
import { generateWgKeyPair, nextTunnelIp, tunnelSetupScript } from '../_shared/tunnel.ts';

interface RouterFields {
  name: string;
  site_id: string;
  connection: 'cloud' | 'direct' | 'tunnel';
  host: string;
  port: number;
  use_https: boolean;
  username: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function text(body: Record<string, unknown>, key: string, label: string, max = 100): string {
  const value = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  if (!value) throw new HttpError(400, `${label} is required.`);
  if (value.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return value;
}

/** Addresses that only work inside a local network (or are not router addresses at all). */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function parseHost(raw: string): string {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (ipv4 && host.split('.').some((o) => Number(o) > 255)) throw new HttpError(400, `"${raw}" is not a valid IP address.`);
  if (!ipv4 && !HOST_RE.test(host)) throw new HttpError(400, `"${raw}" is not a valid IP address or name.`);
  return host;
}

async function parseFields(admin: SupabaseClient, caller: Caller, body: Record<string, unknown>): Promise<RouterFields> {
  const host = parseHost(text(body, 'host', 'Address', 253));
  const port = body.port === undefined || body.port === null || body.port === '' ? 80 : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be a number from 1 to 65535.');
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > 60) throw new HttpError(400, 'Comment is too long (max 60 characters).');

  // The only active site is used when none is chosen.
  let siteId = typeof body.site_id === 'string' ? body.site_id : '';
  if (!siteId) {
    const { data: sites } = await admin.from('sites').select('id').eq('tenant_id', caller.tenantId).eq('is_active', true).limit(2);
    if (sites?.length !== 1) throw new HttpError(400, 'Choose a site.');
    siteId = sites[0]!.id as string;
  }
  if (!UUID_RE.test(siteId)) throw new HttpError(400, 'Choose a site.');

  return {
    name: comment || host,
    site_id: siteId,
    connection: isPrivateIpv4(host) ? 'cloud' : 'direct',
    host,
    port,
    use_https: port === 443,
    username: text(body, 'username', 'Username', 64),
  };
}

async function secretKey(admin: SupabaseClient): Promise<string> {
  const { data: key, error } = await admin.rpc('router_secret_key');
  if (error || typeof key !== 'string') throw new Error('The router password key could not be read.');
  return key;
}

async function encryptPassword(admin: SupabaseClient, password: string): Promise<string> {
  return encryptSecret(password, await secretKey(admin));
}

function dbError(error: { code?: string; message: string }, name: string): never {
  if (error.code === '23505') throw new HttpError(409, `A router named "${name}" already exists. Use a different comment.`);
  if (error.code === '23503') throw new HttpError(400, 'The chosen site does not exist.');
  if (error.code === '55000' || error.code === '42501') throw new HttpError(400, error.message);
  throw new Error(error.message);
}

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function gatewayUrl(): string {
  const base = Deno.env.get('SUPABASE_URL');
  if (!base) throw new Error('Missing SUPABASE_URL');
  return `${base.replace(/\/$/, '')}/functions/v1/router-gateway`;
}

interface TunnelServer {
  secret: string | null;
  relayUrl: string | null;
  vpsPublicKey: string | null;
  endpoint: string | null;
}

async function tunnelServer(admin: SupabaseClient): Promise<TunnelServer> {
  const { data, error } = await admin
    .from('app_config')
    .select('key, value')
    .in('key', ['tunnel_relay_secret', 'tunnel_relay_url', 'tunnel_vps_public_key', 'tunnel_endpoint']);
  if (error) throw new Error(error.message);
  const get = (k: string) => ((data ?? []).find((r) => r.key === k)?.value as string | undefined) ?? null;
  return { secret: get('tunnel_relay_secret'), relayUrl: get('tunnel_relay_url'), vpsPublicKey: get('tunnel_vps_public_key'), endpoint: get('tunnel_endpoint') };
}

const tunnelReady = (t: TunnelServer) => Boolean(t.secret && t.relayUrl && t.vpsPublicKey && t.endpoint);

/**
 * Gives the router a tunnel address (kept if it has one) and its WireGuard key; returns its script.
 * The key is kept (encrypted), so showing the script again gives the same script: a router that
 * already connected with it keeps working. A new key only when asked for (rotate).
 */
async function prepareTunnel(
  admin: SupabaseClient,
  t: TunnelServer,
  router: { id: string; name: string; tunnel_ip: string | null; wg_public_key?: string | null; wg_private_enc?: string | null },
  wwwPort: number,
  rotate = false,
): Promise<{ changes: Record<string, unknown>; script: string }> {
  let tunnelIp = router.tunnel_ip;
  if (!tunnelIp) {
    const { data: used } = await admin.from('routers').select('tunnel_ip').not('tunnel_ip', 'is', null);
    tunnelIp = nextTunnelIp((used ?? []).map((r) => r.tunnel_ip as string));
  }
  let keys: { privateKey: string; publicKey: string } | null = null;
  if (!rotate && router.wg_private_enc && router.wg_public_key) {
    try {
      keys = { privateKey: await decryptSecret(router.wg_private_enc, await secretKey(admin)), publicKey: router.wg_public_key };
    } catch {
      keys = null; // unreadable: a new key below
    }
  }
  const fresh = !keys;
  keys ??= await generateWgKeyPair();
  return {
    changes: {
      connection: 'tunnel',
      tunnel_ip: tunnelIp,
      token_hash: null,
      ...(fresh ? { wg_public_key: keys.publicKey, wg_private_enc: await encryptSecret(keys.privateKey, await secretKey(admin)) } : {}),
    },
    script: tunnelSetupScript({
      routerName: router.name,
      privateKey: keys.privateKey,
      tunnelIp,
      vpsPublicKey: t.vpsPublicKey ?? '',
      endpoint: t.endpoint ?? '',
      wwwPort,
    }),
  };
}

async function queueTest(admin: SupabaseClient, routerId: string, callerId: string, mode: string): Promise<string> {
  const { data: job, error } = await admin
    .from('router_jobs')
    .insert({ router_id: routerId, type: 'test_connection', payload: { mode }, created_by: callerId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return job.id as string;
}

serveJson(async (req) => {
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  const body = await readBody(req);
  const action = body.action;

  if (action === 'setup') {
    const routerId = typeof body.router_id === 'string' ? body.router_id : '';
    if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
    const { data: router } = await admin
      .from('routers')
      .select('id, name, connection, tunnel_ip, port, status, wg_public_key, wg_private_enc')
      .eq('id', routerId)
      .eq('tenant_id', caller.tenantId)
      .maybeSingle();
    if (!router) throw new HttpError(404, 'Router not found.');
    if (router.connection === 'tunnel') {
      const t = await tunnelServer(admin);
      if (!tunnelReady(t)) throw new HttpError(400, 'The tunnel server is not set up yet. Ask Hotzonex Cloud to set it up.');
      // The same script every time (the key is kept). A new key only when asked for explicitly.
      const rotate = body.new_key === 'rotate';
      const prepared = await prepareTunnel(admin, t, router, (router.port as number | null) ?? 80, rotate);
      const { error } = await admin.from('routers').update(prepared.changes).eq('id', routerId);
      if (error) throw new Error(error.message);
      await audit(admin, caller, 'router.tunnel_script', { router_id: routerId, name: router.name, new_key: 'wg_public_key' in prepared.changes });
      return { script: prepared.script, new_key: 'wg_public_key' in prepared.changes };
    }
    if (router.connection !== 'cloud') throw new HttpError(400, 'This router is connected by IP address and does not use a setup script.');
    const token = newToken();
    const { error } = await admin.from('routers').update({ token_hash: await sha256Hex(token) }).eq('id', routerId);
    if (error) throw new Error(error.message);
    await audit(admin, caller, 'router.setup_script', { router_id: routerId, name: router.name });
    return { script: setupScript({ routerName: router.name, gatewayUrl: gatewayUrl(), token }) };
  }

  if (action === 'tunnel_server') {
    const t = await tunnelServer(admin);
    if (!t.secret && caller.isPlatformAdmin) {
      t.secret = newToken();
      const { error } = await admin.from('app_config').insert({ key: 'tunnel_relay_secret', value: t.secret });
      if (error) {
        const again = await tunnelServer(admin); // created at the same moment by another request
        if (!again.secret) throw new Error(error.message);
        t.secret = again.secret;
      }
    }
    const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
    return {
      ready: tunnelReady(t),
      relay_url: t.relayUrl,
      endpoint: t.endpoint,
      ...(caller.isPlatformAdmin ? { command: `curl -fsSL "${base}/functions/v1/tunnel?f=install" | sudo HZC_SECRET=${t.secret} bash` } : {}),
    };
  }

  if (action === 'tunnel_switch') {
    const routerId = typeof body.router_id === 'string' ? body.router_id : '';
    if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
    const { data: router } = await admin
      .from('routers')
      .select('id, name, connection, tunnel_ip')
      .eq('id', routerId)
      .eq('tenant_id', caller.tenantId)
      .maybeSingle();
    if (!router) throw new HttpError(404, 'Router not found.');
    if (router.connection === 'direct') throw new HttpError(400, 'This router is reached at its public address and does not need the tunnel.');
    const t = await tunnelServer(admin);
    if (!tunnelReady(t)) throw new HttpError(400, 'The tunnel server is not set up yet. Ask Hotzonex Cloud to set it up.');
    const port = body.port === undefined || body.port === null || body.port === '' ? 80 : Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be a number from 1 to 65535.');
    const username = text(body, 'username', 'Username', 64);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) throw new HttpError(400, 'Password is required.');
    if (password.length > 128) throw new HttpError(400, 'Router password is too long.');
    const prepared = await prepareTunnel(admin, t, router, port);
    const { error } = await admin
      .from('routers')
      .update({ ...prepared.changes, port, use_https: false, username, password_enc: await encryptPassword(admin, password), last_error: null })
      .eq('id', routerId);
    if (error) throw new Error(error.message);
    // Jobs waiting for the old connector are run through the tunnel instead.
    await admin.from('router_jobs').update({ status: 'queued', started_at: null }).eq('router_id', routerId).eq('status', 'running');
    const jobId = await queueTest(admin, routerId, caller.id, 'tunnel');
    await audit(admin, caller, 'router.tunnel_switch', { router_id: routerId, name: router.name, tunnel_ip: prepared.changes.tunnel_ip });
    return { router_id: routerId, job_id: jobId, connection: 'tunnel', script: prepared.script };
  }

  if (action !== 'create' && action !== 'update') throw new HttpError(400, 'Unknown action.');
  const fields = await parseFields(admin, caller, body);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length > 128) throw new HttpError(400, 'Router password is too long.');
  const { data: site } = await admin.from('sites').select('id').eq('id', fields.site_id).eq('tenant_id', caller.tenantId).maybeSingle();
  if (!site) throw new HttpError(400, 'The chosen site does not exist.');
  const t = fields.connection === 'cloud' ? await tunnelServer(admin) : null;
  if (t && tunnelReady(t)) fields.connection = 'tunnel';
  const tunnel = fields.connection === 'tunnel';
  // Both direct and tunnel routers are logged in to with the stored (encrypted) password.
  const direct = fields.connection === 'direct' || tunnel;

  if (action === 'create') {
    // A router with this name that never connected (still "pending") is replaced, so the admin can simply try again.
    const { data: waiting } = await admin
      .from('routers')
      .select('id, status')
      .eq('tenant_id', caller.tenantId)
      .eq('name', fields.name)
      .maybeSingle();
    if (waiting?.status === 'pending') await admin.from('routers').delete().eq('id', waiting.id);

    if (direct && !password) throw new HttpError(400, 'Password is required.');
    const token = direct ? null : newToken();
    const { data: router, error } = await admin
      .from('routers')
      .insert({
        ...fields,
        ...(tunnel ? { use_https: false } : {}),
        status: 'pending',
        token_hash: token ? await sha256Hex(token) : null,
        password_enc: direct ? await encryptPassword(admin, password) : null,
      })
      .select('id')
      .single();
    if (error) dbError(error, fields.name);

    let tunnelScript: string | null = null;
    if (tunnel && t) {
      try {
        const prepared = await prepareTunnel(admin, t, { id: router.id, name: fields.name, tunnel_ip: null }, fields.port);
        const { error: tunnelError } = await admin.from('routers').update(prepared.changes).eq('id', router.id);
        if (tunnelError) throw new Error(tunnelError.message);
        tunnelScript = prepared.script;
      } catch (err) {
        await admin.from('routers').delete().eq('id', router.id);
        throw err;
      }
    }

    let jobId: string;
    try {
      jobId = await queueTest(admin, router.id, caller.id, 'create');
    } catch (err) {
      await admin.from('routers').delete().eq('id', router.id);
      throw err;
    }
    return {
      router_id: router.id,
      job_id: jobId,
      connection: fields.connection,
      ...(token ? { script: setupScript({ routerName: fields.name, gatewayUrl: gatewayUrl(), token }) } : {}),
      ...(tunnelScript ? { script: tunnelScript } : {}),
    };
  }

  // update
  const routerId = typeof body.router_id === 'string' ? body.router_id : '';
  if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
  const { data: existing } = await admin
    .from('routers')
    .select('id, connection, password_enc, token_hash')
    .eq('id', routerId)
    .eq('tenant_id', caller.tenantId)
    .maybeSingle();
  if (!existing) throw new HttpError(404, 'Router not found.');
  // A private address keeps its current way of connecting; moving to the tunnel is "tunnel_switch".
  if (fields.connection !== 'direct') fields.connection = existing.connection === 'tunnel' ? 'tunnel' : 'cloud';
  const keepTunnel = fields.connection === 'tunnel';

  const changes: Record<string, unknown> = { ...fields, last_error: null };
  const hotspotServer = typeof body.hotspot_server === 'string' ? body.hotspot_server.trim() : '';
  if (hotspotServer) changes.hotspot_server = hotspotServer.slice(0, 64);
  const dnsName = typeof body.dns_name === 'string' ? body.dns_name.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : '';
  if (dnsName) {
    if (!HOST_RE.test(dnsName) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(dnsName)) throw new HttpError(400, `"${dnsName}" is not a valid login address. Example: hotzonex.wifi`);
    changes.dns_name = dnsName;
  }
  let token: string | null = null;
  if (keepTunnel) {
    changes.use_https = false;
    if (password) changes.password_enc = await encryptPassword(admin, password);
    else if (!existing.password_enc) throw new HttpError(400, 'Password is required.');
  } else if (fields.connection === 'direct') {
    if (password) changes.password_enc = await encryptPassword(admin, password);
    else if (!existing.password_enc) throw new HttpError(400, 'Password is required.');
    changes.token_hash = null; // an installed connector script stops working
    changes.tunnel_ip = null;
    changes.wg_public_key = null;
    changes.wg_private_enc = null;
  } else {
    changes.password_enc = null;
    if (existing.connection !== 'cloud' || !existing.token_hash) {
      token = newToken();
      changes.token_hash = await sha256Hex(token);
    }
  }
  const { error } = await admin.from('routers').update(changes).eq('id', routerId);
  if (error) dbError(error, fields.name);

  // Older checks that have not run yet would use the old settings: replace them.
  await admin
    .from('router_jobs')
    .update({ status: 'failed', result: { error: 'Replaced by a newer check after the router was edited.' }, finished_at: new Date().toISOString() })
    .eq('router_id', routerId)
    .eq('type', 'test_connection')
    .in('status', ['queued', 'running']);
  const jobId = await queueTest(admin, routerId, caller.id, 'update');

  await audit(admin, caller, 'router.updated', {
    router_id: routerId,
    name: fields.name,
    connection: fields.connection,
    host: fields.host,
    password_changed: Boolean(password),
  });
  return {
    router_id: routerId,
    job_id: jobId,
    connection: fields.connection,
    ...(token ? { script: setupScript({ routerName: fields.name, gatewayUrl: gatewayUrl(), token }) } : {}),
  };
});
