// create-staff: admin-only staff management using the service role.
//
// POST { action: "list" }                                   → { staff: [...] } (adds login emails)
// POST { action: "create", email, password, full_name, role, site_id? } → { id }
// POST { action: "update", id, full_name, role, site_id?, is_active, password? } → { id }
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';

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

function checkPassword(password: string): void {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 72) throw new HttpError(400, 'Password is too long (max 72 characters).');
}

serveJson(async (req) => {
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  const body = await readBody(req);

  if (body.action === 'list') {
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, full_name, role, site_id, is_active, created_at')
      .order('full_name');
    if (error) throw new Error(error.message);

    const emails = new Map<string, string>();
    for (let page = 1; page <= 20; page++) {
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) throw new Error(listError.message);
      for (const u of data.users) emails.set(u.id, u.email ?? '');
      if (data.users.length < 200) break;
    }
    return { staff: (profiles ?? []).map((p) => ({ ...p, email: emails.get(p.id) ?? '' })) };
  }

  if (body.action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    const password = typeof body.password === 'string' ? body.password : '';
    checkPassword(password);
    const profile = parseProfile(body);

    if (profile.site_id) {
      const { data: site } = await admin.from('sites').select('id').eq('id', profile.site_id).maybeSingle();
      if (!site) throw new HttpError(400, 'The chosen site does not exist.');
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
    });
    if (createError || !created.user) {
      const msg = createError?.message ?? '';
      if (/already|registered|exists/i.test(msg)) throw new HttpError(409, `${email} already has a login.`);
      throw new Error(msg || 'Could not create the login.');
    }

    const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, ...profile, is_active: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(profileError.message);
    }

    await audit(admin, caller.id, 'staff.created', { staff_id: created.user.id, email, ...profile });
    return { id: created.user.id };
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

    const { data: existing } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Staff member not found.');

    const { error } = await admin.from('profiles').update({ ...profile, is_active: isActive }).eq('id', id);
    if (error) {
      if (error.code === '23503') throw new HttpError(400, 'The chosen site does not exist.');
      throw new Error(error.message);
    }

    // Disabled staff are also blocked at login; re-enabling lifts the ban.
    const { error: authError } = await admin.auth.admin.updateUserById(id, {
      ...(password ? { password } : {}),
      ban_duration: isActive ? 'none' : '876000h',
    });
    if (authError) throw new Error(authError.message);

    await audit(admin, caller.id, 'staff.updated', {
      staff_id: id,
      ...profile,
      is_active: isActive,
      password_changed: Boolean(password),
    });
    return { id };
  }

  throw new HttpError(400, 'Unknown action.');
});
