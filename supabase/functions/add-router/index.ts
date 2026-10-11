// add-router: saves a router from the simple form (address, port, username, password, comment)
// and queues its first check. Admins only.
//
// How Hotzonex reaches the router depends on the address:
//   private (192.168.x.x, 10.x.x.x, …)  → "cloud": the address is only reachable inside the router's
//       own network, so the router connects out to Hotzonex Cloud after a one-time setup script.
//       No password is stored; only the SHA-256 of a random token.
//   public IP or DNS name               → "direct": Hotzonex logs in to the router's REST API with the
//       username and password (encrypted with AES-256-GCM, key in Supabase Vault).
// The hotspot server and its DNS name are read from the router at the first check.
//
// POST { action: "create", host, port?, username, password, comment?, site_id? }
//   → { router_id, job_id, connection, script? }      (script for cloud routers)
// POST { action: "update", router_id, …same fields (password blank = keep), hotspot_server?, dns_name? }
//   → { router_id, job_id, connection, script? }
// POST { action: "setup", router_id }  (cloud routers) → { script }   (new token)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { encryptSecret } from '../_shared/crypto.ts';
import { setupScript } from '../_shared/routeros.ts';

interface RouterFields {
  name: string;
  site_id: string;
  connection: 'cloud' | 'direct';
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

async function parseFields(admin: SupabaseClient, body: Record<string, unknown>): Promise<RouterFields> {
  const host = parseHost(text(body, 'host', 'Address', 253));
  const port = body.port === undefined || body.port === null || body.port === '' ? 80 : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be a number from 1 to 65535.');
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > 60) throw new HttpError(400, 'Comment is too long (max 60 characters).');

  // The only active site is used when none is chosen.
  let siteId = typeof body.site_id === 'string' ? body.site_id : '';
  if (!siteId) {
    const { data: sites } = await admin.from('sites').select('id').eq('is_active', true).limit(2);
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

async function encryptPassword(admin: SupabaseClient, password: string): Promise<string> {
  const { data: key, error } = await admin.rpc('router_secret_key');
  if (error || typeof key !== 'string') throw new Error('The router password key could not be read.');
  return encryptSecret(password, key);
}

function dbError(error: { code?: string; message: string }, name: string): never {
  if (error.code === '23505') throw new HttpError(409, `A router named "${name}" already exists. Use a different comment.`);
  if (error.code === '23503') throw new HttpError(400, 'The chosen site does not exist.');
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
    const { data: router } = await admin.from('routers').select('id, name, connection').eq('id', routerId).maybeSingle();
    if (!router) throw new HttpError(404, 'Router not found.');
    if (router.connection !== 'cloud') throw new HttpError(400, 'This router is connected by IP address and does not use a setup script.');
    const token = newToken();
    const { error } = await admin.from('routers').update({ token_hash: await sha256Hex(token) }).eq('id', routerId);
    if (error) throw new Error(error.message);
    await audit(admin, caller.id, 'router.setup_script', { router_id: routerId, name: router.name });
    return { script: setupScript({ routerName: router.name, gatewayUrl: gatewayUrl(), token }) };
  }

  if (action !== 'create' && action !== 'update') throw new HttpError(400, 'Unknown action.');
  const fields = await parseFields(admin, body);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length > 128) throw new HttpError(400, 'Router password is too long.');
  const { data: site } = await admin.from('sites').select('id').eq('id', fields.site_id).maybeSingle();
  if (!site) throw new HttpError(400, 'The chosen site does not exist.');
  const direct = fields.connection === 'direct';

  if (action === 'create') {
    // A router with this name that never connected (still "pending") is replaced, so the admin can simply try again.
    const { data: waiting } = await admin.from('routers').select('id, status').eq('name', fields.name).maybeSingle();
    if (waiting?.status === 'pending') await admin.from('routers').delete().eq('id', waiting.id);

    if (direct && !password) throw new HttpError(400, 'Password is required.');
    const token = direct ? null : newToken();
    const { data: router, error } = await admin
      .from('routers')
      .insert({
        ...fields,
        status: 'pending',
        token_hash: token ? await sha256Hex(token) : null,
        password_enc: direct ? await encryptPassword(admin, password) : null,
      })
      .select('id')
      .single();
    if (error) dbError(error, fields.name);

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
    };
  }

  // update
  const routerId = typeof body.router_id === 'string' ? body.router_id : '';
  if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
  const { data: existing } = await admin.from('routers').select('id, connection, password_enc, token_hash').eq('id', routerId).maybeSingle();
  if (!existing) throw new HttpError(404, 'Router not found.');

  const changes: Record<string, unknown> = { ...fields, last_error: null };
  const hotspotServer = typeof body.hotspot_server === 'string' ? body.hotspot_server.trim() : '';
  if (hotspotServer) changes.hotspot_server = hotspotServer.slice(0, 64);
  const dnsName = typeof body.dns_name === 'string' ? body.dns_name.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : '';
  if (dnsName) {
    if (!HOST_RE.test(dnsName) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(dnsName)) throw new HttpError(400, `"${dnsName}" is not a valid login address. Example: hotzonex.wifi`);
    changes.dns_name = dnsName;
  }
  let token: string | null = null;
  if (direct) {
    if (password) changes.password_enc = await encryptPassword(admin, password);
    else if (!existing.password_enc) throw new HttpError(400, 'Password is required.');
    changes.token_hash = null; // an installed connector script stops working
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

  await audit(admin, caller.id, 'router.updated', {
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
