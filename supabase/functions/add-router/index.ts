// add-router: saves a router and hands out its setup script. Admins only.
// Routers connect out to Hotzonex Cloud (router-gateway), so no IP address or router
// password is needed: each router gets a random token, shown only inside its setup script.
//
// POST { action: "create", name, site_id, hotspot_server, dns_name }
//   → { router_id, job_id, script }   (the router stays "waiting" until it calls in and passes its test)
// POST { action: "update", router_id, name, site_id, hotspot_server, dns_name }
//   → { router_id, job_id }            (queues a new connection test)
// POST { action: "setup", router_id }
//   → { script }                       (new token; the previously installed connector stops working)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { setupScript } from '../_shared/routeros.ts';

interface RouterFields {
  name: string;
  site_id: string;
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

function parseFields(body: Record<string, unknown>): RouterFields {
  const siteId = text(body, 'site_id', 'Site');
  if (!UUID_RE.test(siteId)) throw new HttpError(400, 'Choose a site.');

  const dnsName = text(body, 'dns_name', 'DNS name', 253).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!HOST_RE.test(dnsName)) throw new HttpError(400, `"${dnsName}" is not a valid DNS name. Example: hotzonex.wifi`);

  return {
    name: text(body, 'name', 'Router name', 60),
    site_id: siteId,
    hotspot_server: text(body, 'hotspot_server', 'Hotspot server name', 64),
    dns_name: dnsName,
  };
}

function dbError(error: { code?: string; message: string }, name: string): never {
  if (error.code === '23505') throw new HttpError(409, `A router named "${name}" already exists.`);
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
    const { data: router } = await admin.from('routers').select('id, name').eq('id', routerId).maybeSingle();
    if (!router) throw new HttpError(404, 'Router not found.');
    const token = newToken();
    const { error } = await admin.from('routers').update({ token_hash: await sha256Hex(token) }).eq('id', routerId);
    if (error) throw new Error(error.message);
    await audit(admin, caller.id, 'router.setup_script', { router_id: routerId, name: router.name });
    return { script: setupScript({ routerName: router.name, gatewayUrl: gatewayUrl(), token }) };
  }

  if (action !== 'create' && action !== 'update') throw new HttpError(400, 'Unknown action.');
  const fields = parseFields(body);
  const { data: site } = await admin.from('sites').select('id').eq('id', fields.site_id).maybeSingle();
  if (!site) throw new HttpError(400, 'The chosen site does not exist.');

  if (action === 'create') {
    // A router with this name that never connected (still "pending") is replaced, so the admin can simply try again.
    const { data: waiting } = await admin.from('routers').select('id, status').eq('name', fields.name).maybeSingle();
    if (waiting?.status === 'pending') await admin.from('routers').delete().eq('id', waiting.id);

    const token = newToken();
    const { data: router, error } = await admin
      .from('routers')
      .insert({ ...fields, status: 'pending', token_hash: await sha256Hex(token) })
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
    return { router_id: router.id, job_id: jobId, script: setupScript({ routerName: fields.name, gatewayUrl: gatewayUrl(), token }) };
  }

  // update
  const routerId = typeof body.router_id === 'string' ? body.router_id : '';
  if (!UUID_RE.test(routerId)) throw new HttpError(400, 'Router not found.');
  const { data: existing } = await admin.from('routers').select('id').eq('id', routerId).maybeSingle();
  if (!existing) throw new HttpError(404, 'Router not found.');

  const { error } = await admin.from('routers').update({ ...fields, last_error: null }).eq('id', routerId);
  if (error) dbError(error, fields.name);

  // Older tests that have not run yet would check the old settings: replace them.
  await admin
    .from('router_jobs')
    .update({ status: 'failed', result: { error: 'Replaced by a newer test after the router was edited.' }, finished_at: new Date().toISOString() })
    .eq('router_id', routerId)
    .eq('type', 'test_connection')
    .in('status', ['queued', 'running']);
  const jobId = await queueTest(admin, routerId, caller.id, 'update');

  await audit(admin, caller.id, 'router.updated', { router_id: routerId, name: fields.name, hotspot_server: fields.hotspot_server });
  return { router_id: routerId, job_id: jobId };
});
