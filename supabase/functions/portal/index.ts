// portal: serves a router's Hotzonex login-portal pages, rendered from its template and settings.
// GET ?r=<router id>&f=<file>   (file: login.html, status.html, …, md5.js)
// Called by the router itself while installing the portal (it has no user login). The pages only
// contain what customers see anyway (business name, plans and prices), so no secret is needed.
import { serviceClient } from '../_shared/auth.ts';
import { PORTAL_FILES, renderPortalFile, type PortalFile, type PortalPlan, type PortalTemplate } from '../_shared/portal.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: string, status: number, type = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return reply('Use GET.', 405);
  const url = new URL(req.url);
  const routerId = url.searchParams.get('r') ?? '';
  const file = url.searchParams.get('f') ?? 'login.html';
  if (!UUID_RE.test(routerId) || !(PORTAL_FILES as readonly string[]).includes(file)) return reply('Not found.', 404);

  try {
    const db = serviceClient();
    const { data: router } = await db.from('routers').select('id, tenant_id').eq('id', routerId).maybeSingle();
    if (!router) return reply('Not found.', 404);
    const [{ data: cfg }, { data: plans }] = await Promise.all([
      db.from('portal_configs').select('template, settings').eq('router_id', routerId).maybeSingle(),
      db.from('plans').select('name, price_ssp, uptime_seconds, color').eq('tenant_id', router.tenant_id).eq('is_active', true).order('price_ssp'),
    ]);
    const body = renderPortalFile(file as PortalFile, (cfg?.template as PortalTemplate) ?? 'classic', cfg?.settings ?? {}, (plans ?? []) as PortalPlan[]);
    return reply(body, 200, file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return reply('Server error.', 500);
  }
});
