import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { HttpError } from './cors.ts';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge Function secret ${name}`);
  return value;
}

/** Service-role client: bypasses RLS. Use only after checking the caller. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  id: string;
  role: 'admin' | 'manager' | 'seller';
  siteId: string | null;
  /** The caller's business; everything the caller does stays inside it. */
  tenantId: string;
  /** Runs Hotzonex Cloud itself (and logged in with the 2-step code): may add and support businesses. */
  isPlatformAdmin: boolean;
  /** A platform admin managing a customer's business (support mode): tenantId is that business. */
  supporting: boolean;
}

/** The "aal" claim of a token getUser has already accepted ("aal2": logged in with the 2-step code). */
function assurance(token: string): string {
  try {
    const part = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as { aal?: unknown };
    return typeof claims.aal === 'string' ? claims.aal : '';
  } catch {
    return '';
  }
}

/** Resolves the logged-in staff member from the request's JWT and requires an active admin of an active business. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please log in again.');

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError(401, 'Your login has expired. Please log in again.');
  // Someone with a 2-step login set up may act only after typing the code (as in the database).
  if ((userData.user.factors ?? []).some((f) => f.status === 'verified') && assurance(token) !== 'aal2') {
    throw new HttpError(401, 'Type your 2-step code to continue (log in again).');
  }

  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, role, site_id, is_active, tenant_id, tenants(is_active)')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  if (!profile || !profile.is_active) throw new HttpError(403, 'Your staff account is not active.');
  const tenant = profile.tenants as unknown as { is_active: boolean } | null;
  if (!tenant?.is_active) throw new HttpError(403, 'This business is switched off. Contact Hotzonex Cloud.');
  if (profile.role !== 'admin') throw new HttpError(403, 'Only admins can do this.');

  const { data: platform, error: platformError } = await admin
    .from('platform_admins')
    .select('user_id, acting_tenant_id, acting_until')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (platformError) throw new Error(`Platform admin lookup failed: ${platformError.message}`);
  // Platform powers need the 2-step login, like in the database (is_platform_admin, app_tenant_id).
  const isPlatformAdmin = !!platform && assurance(token) === 'aal2';
  const supporting = isPlatformAdmin && !!platform?.acting_tenant_id && new Date(platform.acting_until as string).getTime() > Date.now();
  return {
    id: profile.id,
    role: profile.role,
    siteId: supporting ? null : profile.site_id,
    tenantId: supporting ? (platform!.acting_tenant_id as string) : profile.tenant_id,
    isPlatformAdmin,
    supporting,
  };
}

/** Like requireAdmin, but only for the people who run Hotzonex Cloud itself. */
export async function requirePlatformAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const caller = await requireAdmin(req, admin);
  if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can do this, logged in with their 2-step code (Security page).');
  return caller;
}

export async function audit(admin: SupabaseClient, caller: Pick<Caller, 'id' | 'tenantId'>, action: string, details: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('audit_log').insert({ tenant_id: caller.tenantId, user_id: caller.id, action, details });
  if (error) console.error(`Audit log write failed: ${error.message}`);
}
