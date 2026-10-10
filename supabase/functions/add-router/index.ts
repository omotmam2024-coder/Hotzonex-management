// add-router: validates router details, encrypts the password and queues a
// test_connection job for the Router Agent. Admins only.
//
// POST { action: "create", name, site_id, ip_address, port?, use_https?, username, password,
//        hotspot_server, dns_name }
//   → { router_id, job_id }   (the agent deletes the router if this first test fails)
// POST { action: "update", router_id, ...same fields, password? (blank = keep) }
//   → { router_id, job_id }
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { encryptSecret } from '../_shared/crypto.ts';

interface RouterFields {
  name: string;
  site_id: string;
  ip_address: string;
  port: number;
  use_https: boolean;
  username: string;
  hotspot_server: string;
  dns_name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function text(body: Record<string, unknown>, key: string, label: string, max = 100): string {
  const value = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  if (!value) throw new HttpError(400, `${label} is required.`);
  if (value.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return value;
}

/** Accepts only private IPv4 LAN addresses (10/8, 172.16/12, 192.168/16). */
export function validatePrivateIp(raw: string): string {
  const parts = raw.split('.');
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (parts.length !== 4 || octets.some((o) => Number.isNaN(o) || o > 255)) {
    throw new HttpError(400, `"${raw}" is not a valid IP address. Example: 192.168.88.1`);
  }
  const [a, b] = octets as [number, number, number, number];
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!isPrivate) {
    throw new HttpError(400, `${raw} is not a private LAN address. Use the router's local IP, e.g. 192.168.88.1.`);
  }
  return octets.join('.');
}

function parseFields(body: Record<string, unknown>): RouterFields {
  const siteId = text(body, 'site_id', 'Site');
  if (!UUID_RE.test(siteId)) throw new HttpError(400, 'Choose a site.');

  const port = body.port === undefined || body.port === null || body.port === '' ? 80 : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be a number from 1 to 65535.');

  const dnsName = text(body, 'dns_name', 'DNS name', 253).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!HOST_RE.test(dnsName)) throw new HttpError(400, `"${dnsName}" is not a valid DNS name. Example: hotzonex.wifi`);

  const hotspotServer = text(body, 'hotspot_server', 'Hotspot server name', 64);
  const username = text(body, 'username', 'Router username', 64);

  return {
    name: text(body, 'name', 'Router name', 60),
    site_id: siteId,
    ip_address: validatePrivateIp(text(body, 'ip_address', 'Private IP address', 15)),
    port,
    use_https: body.use_https === true,
    username,
    hotspot_server: hotspotServer,
    dns_name: dnsName,
  };
}

function dbError(error: { code?: string; message: string }, name: string): never {
  if (error.code === '23505') throw new HttpError(409, `A router named "${name}" already exists.`);
  if (error.code === '23503') throw new HttpError(400, 'The chosen site does not exist.');
  if (error.code === '23514') throw new HttpError(400, 'One of the values is not allowed. Check the IP address and port.');
  throw new Error(error.message);
}

serveJson(async (req) => {
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  const body = await readBody(req);
  const keyHex = Deno.env.get('ROUTER_SECRET_KEY') ?? '';

  const action = body.action;
  if (action !== 'create' && action !== 'update') throw new HttpError(400, 'Unknown action.');

  const fields = parseFields(body);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length > 128) throw new HttpError(400, 'Router password is too long.');

  const { data: site } = await admin.from('sites').select('id, is_active').eq('id', fields.site_id).maybeSingle();
  if (!site) throw new HttpError(400, 'The chosen site does not exist.');

  if (action === 'create') {
    if (!password) throw new HttpError(400, 'Router password is required.');
    const passwordEnc = await encryptSecret(password, keyHex);

    // A router with this name that never passed its first test (still "pending", e.g. the
    // Router Agent was not running) is replaced, so the admin can simply try again.
    const { data: waiting } = await admin.from('routers').select('id, status').eq('name', fields.name).maybeSingle();
    if (waiting?.status === 'pending') await admin.from('routers').delete().eq('id', waiting.id);

    const { data: router, error } = await admin
      .from('routers')
      .insert({ ...fields, password_enc: passwordEnc, status: 'pending' })
      .select('id')
      .single();
    if (error) dbError(error, fields.name);

    const { data: job, error: jobError } = await admin
      .from('router_jobs')
      .insert({ router_id: router.id, type: 'test_connection', payload: { mode: 'create' }, created_by: caller.id })
      .select('id')
      .single();
    if (jobError) {
      await admin.from('routers').delete().eq('id', router.id);
      throw new Error(jobError.message);
    }
    return { router_id: router.id, job_id: job.id };
  }

  // update
  const routerId = typeof body.router_id === 'string' ? body.router_id : '';
  if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
  const { data: existing } = await admin.from('routers').select('id, status').eq('id', routerId).maybeSingle();
  if (!existing) throw new HttpError(404, 'Router not found.');
  // A router still waiting for its first test can be corrected too: its old queued test is
  // dropped and the new one below tests the corrected settings.
  if (existing.status === 'pending') {
    await admin
      .from('router_jobs')
      .update({ status: 'failed', result: { error: 'Replaced by a newer test after the router was edited.' }, finished_at: new Date().toISOString() })
      .eq('router_id', routerId)
      .eq('type', 'test_connection')
      .eq('status', 'queued');
  }

  const changes: Record<string, unknown> = { ...fields };
  if (password) changes.password_enc = await encryptSecret(password, keyHex);

  const { error } = await admin.from('routers').update(changes).eq('id', routerId);
  if (error) dbError(error, fields.name);

  const { data: job, error: jobError } = await admin
    .from('router_jobs')
    .insert({ router_id: routerId, type: 'test_connection', payload: { mode: 'update' }, created_by: caller.id })
    .select('id')
    .single();
  if (jobError) throw new Error(jobError.message);

  await audit(admin, caller.id, 'router.updated', {
    router_id: routerId,
    name: fields.name,
    ip: fields.ip_address,
    password_changed: Boolean(password),
  });
  return { router_id: routerId, job_id: job.id };
});
