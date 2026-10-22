// create-staff: admin-only staff management using the service role. Everything stays
// inside the caller's business.
//
// POST { action: "list" }                                   → { staff: [...] } (adds login emails)
// POST { action: "create", email, password, full_name, role, site_id? } → { id }
// POST { action: "update", id, full_name, role, site_id?, is_active, password? } → { id }
// Platform admins only:
// POST { action: "create_business", business_name, timezone?, site_name, email, password, full_name }
//      → { tenant_id, site_id, admin_id }   (a new business with its first site and admin)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { audit, type Caller, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, passwordProblem, readBody, serveJson } from '../_shared/cors.ts';

type Role = 'admin' | 'manager' | 'seller';
const ROLES: Role[] = ['admin', 'manager', 'seller'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProfile(body: Record<string, unknown>) {
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  if (!fullName) throw new HttpError(400, 'Full name is required.');
  if (fullName.length > 80) throw new HttpError(400, 'Full name is too long.');

  const role = body.role as Role;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role.');

  const rawSite = typeof body.site_id === 'string' && body.site_id ? body.site_id : null;
  if (rawSite && !UUID_RE.test(rawSite)) throw new HttpError(400, 'Choose a site.');
  if (role !== 'admin' && !rawSite) throw new HttpError(400, 'Managers and sellers must belong to a site.');
  return { full_name: fullName, role, site_id: rawSite };
}

function parseEmail(body: Record<string, unknown>): string {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return email;
}

function checkPassword(password: string): void {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 72) throw new HttpError(400, 'Password is too long (max 72 characters).');
}

async function requireOwnSite(admin: SupabaseClient, caller: Caller, siteId: string | null): Promise<void> {
  if (!siteId) return;
  const { data: site } = await admin.from('sites').select('id').eq('id', siteId).eq('tenant_id', caller.tenantId).maybeSingle();
  if (!site) throw new HttpError(400, 'The chosen site does not exist.');
}

async function createLogin(admin: SupabaseClient, email: string, password: string, fullName: string): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created.user) {
    const msg = error?.message ?? '';
    if (/already|registered|exists/i.test(msg)) throw new HttpError(409, `${email} already has a login.`);
    const weak = passwordProblem(msg);
    if (weak) throw new HttpError(400, weak);
    throw new Error(msg || 'Could not create the login.');
  }
  return created.user.id;
}

serveJson(async (req) => {
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  const body = await readBody(req);

  if (body.action === 'list') {
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, full_name, role, site_id, is_active, created_at')
      .eq('tenant_id', caller.tenantId)
      .order('full_name');
    if (error) throw new Error(error.message);

    const staff = await Promise.all(
      (profiles ?? []).map(async (p) => {
        const { data } = await admin.auth.admin.getUserById(p.id);
        return { ...p, email: data?.user?.email ?? '' };
      }),
    );
    return { staff };
  }

  if (body.action === 'create') {
    const email = parseEmail(body);
    const password = typeof body.password === 'string' ? body.password : '';
    checkPassword(password);
    const profile = parseProfile(body);
    await requireOwnSite(admin, caller, profile.site_id);

    const userId = await createLogin(admin, email, password, profile.full_name);
    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id: userId, tenant_id: caller.tenantId, ...profile, is_active: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(userId);
      throw new Error(profileError.message);
    }

    await audit(admin, caller, 'staff.created', { staff_id: userId, email, ...profile });
    return { id: userId };
  }

  if (body.action === 'update') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) throw new HttpError(400, 'Staff member not found.');
    const profile = parseProfile(body);
    const isActive = body.is_active !== false;
    const password = typeof body.password === 'string' ? body.password : '';
    if (password) checkPassword(password);

    if (id === caller.id && (profile.role !== 'admin' || !isActive)) {
      throw new HttpError(400, 'You cannot remove your own admin access. Ask another admin.');
    }

    const { data: existing } = await admin.from('profiles').select('id').eq('id', id).eq('tenant_id', caller.tenantId).maybeSingle();
    if (!existing) throw new HttpError(404, 'Staff member not found.');
    // The Hotzonex Cloud owner's login is changed only by that person (on their own Security page).
    if (id !== caller.id) {
      const { data: owner } = await admin.from('platform_admins').select('user_id').eq('user_id', id).maybeSingle();
      if (owner) throw new HttpError(403, 'This is the Hotzonex Cloud owner’s login: only they can change it.');
    }
    await requireOwnSite(admin, caller, profile.site_id);

    const { error } = await admin.from('profiles').update({ ...profile, is_active: isActive }).eq('id', id).eq('tenant_id', caller.tenantId);
    if (error) {
      if (error.code === '23503') throw new HttpError(400, 'The chosen site does not exist.');
      throw new Error(error.message);
    }

    // Disabled staff are also blocked at login; re-enabling lifts the ban.
    const { error: authError } = await admin.auth.admin.updateUserById(id, {
      ...(password ? { password } : {}),
      ban_duration: isActive ? 'none' : '876000h',
    });
    if (authError) throw passwordProblem(authError.message) ? new HttpError(400, passwordProblem(authError.message)!) : new Error(authError.message);

    await audit(admin, caller, 'staff.updated', {
      staff_id: id,
      ...profile,
      is_active: isActive,
      password_changed: Boolean(password),
    });
    return { id };
  }

  if (body.action === 'create_business') {
    if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can add a business.');
    const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
    if (!businessName || businessName.length > 100) throw new HttpError(400, 'Enter the business name (up to 100 characters).');
    const siteName = (typeof body.site_name === 'string' ? body.site_name.trim() : '') || 'Main site';
    if (siteName.length > 80) throw new HttpError(400, 'The site name is too long.');
    const timezone = (typeof body.timezone === 'string' ? body.timezone.trim() : '') || 'Africa/Juba';
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new HttpError(400, 'Choose a valid time zone, for example Africa/Juba.');
    }
    const email = parseEmail(body);
    const password = typeof body.password === 'string' ? body.password : '';
    checkPassword(password);
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    if (!fullName || fullName.length > 80) throw new HttpError(400, "Enter the business admin's full name.");

    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .insert({ name: businessName, timezone })
      .select('id')
      .single();
    if (tenantError) {
      if (tenantError.code === '23505') throw new HttpError(409, `A business called ${businessName} already exists.`);
      throw new Error(tenantError.message);
    }

    // Undo the business if any later step fails, so a retry starts clean.
    let userId: string | null = null;
    try {
      const { data: site, error: siteError } = await admin
        .from('sites')
        .insert({ tenant_id: tenant.id, name: siteName, timezone })
        .select('id')
        .single();
      if (siteError) throw new Error(siteError.message);

      userId = await createLogin(admin, email, password, fullName);
      const { error: profileError } = await admin
        .from('profiles')
        .insert({ id: userId, tenant_id: tenant.id, full_name: fullName, role: 'admin', site_id: null, is_active: true });
      if (profileError) throw new Error(profileError.message);

      await audit(admin, { id: caller.id, tenantId: tenant.id }, 'tenant.created', { name: businessName, admin_email: email, by_platform_admin: caller.id });
      return { tenant_id: tenant.id, site_id: site.id, admin_id: userId };
    } catch (err) {
      if (userId) await admin.auth.admin.deleteUser(userId);
      await admin.from('sites').delete().eq('tenant_id', tenant.id);
      await admin.from('tenants').delete().eq('id', tenant.id);
      throw err;
    }
  }

  throw new HttpError(400, 'Unknown action.');
});
