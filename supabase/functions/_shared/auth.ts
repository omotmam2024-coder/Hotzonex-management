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
  /** Runs Hotzonex Cloud itself: may add businesses. */
  isPlatformAdmin: boolean;
}

/** Resolves the logged-in staff member from the request's JWT and requires an active admin of an active business. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please log in again.');

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError(401, 'Your login has expired. Please log in again.');

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
    .select('user_id')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (platformError) throw new Error(`Platform admin lookup failed: ${platformError.message}`);
  return { id: profile.id, role: profile.role, siteId: profile.site_id, tenantId: profile.tenant_id, isPlatformAdmin: !!platform };
}

/** Like requireAdmin, but only for the people who run Hotzonex Cloud itself. */
export async function requirePlatformAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const caller = await requireAdmin(req, admin);
  if (!caller.isPlatformAdmin) throw new HttpError(403, 'Only Hotzonex Cloud platform admins can do this.');
  return caller;
}

export async function audit(admin: SupabaseClient, caller: Pick<Caller, 'id' | 'tenantId'>, action: string, details: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('audit_log').insert({ tenant_id: caller.tenantId, user_id: caller.id, action, details });
  if (error) console.error(`Audit log write failed: ${error.message}`);
}
