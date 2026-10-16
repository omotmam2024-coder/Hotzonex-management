// signup: a new business starts a free trial by itself (no login yet).
//
// POST { business_name, full_name, email, password, phone, site_name?, timezone? }
//   → { tenant_id } : the business, its first site and its admin login; then the app logs in.
//
// Limited to a few sign-ups per device a day. The trial length comes from app_config
// (billing_trial_days); billing starts when it ends (see billing_run in the database).
import { serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { cleanPhone } from '../_shared/buy.ts';
import { checkSignup, InputError, type SignupInput } from '../_shared/signup.ts';

const PER_IP_DAY = 3;
const SIGNUPS_PER_HOUR = 20;

serveJson(async (req) => {
  const db = serviceClient();
  const body = await readBody(req);
  let s: SignupInput;
  try {
    s = checkSignup(body);
  } catch (err) {
    if (err instanceof InputError) throw new HttpError(400, err.message);
    throw err;
  }
  const phone = cleanPhone(body.phone);
  if (!phone) throw new HttpError(400, 'Type a phone number we can reach you on.');

  // The visitor's address as Cloudflare saw it (a visitor cannot set this header themselves).
  const ip =
    (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0] ?? '').trim().slice(0, 64) ||
    'unknown';
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [{ count }, { count: lastHour }] = await Promise.all([
    db.from('tenant_billing').select('tenant_id', { count: 'exact', head: true }).eq('signup_ip', ip).gte('updated_at', dayAgo),
    db.from('tenant_billing').select('tenant_id', { count: 'exact', head: true }).eq('created_via', 'signup').gte('updated_at', hourAgo),
  ]);
  if ((count ?? 0) >= PER_IP_DAY) throw new HttpError(429, 'Too many sign-ups from this device today. Contact Hotzonex Cloud.');
  // However many devices are used, sign-ups stop for a while after a burst (and Hotzonex is told).
  if ((lastHour ?? 0) >= SIGNUPS_PER_HOUR) throw new HttpError(429, 'Many businesses are signing up right now. Please try again in an hour, or contact Hotzonex Cloud.');

  const { data: cfg } = await db.from('app_config').select('value').eq('key', 'billing_trial_days').maybeSingle();
  const trialDays = Math.min(Math.max(Number(cfg?.value ?? 14) || 14, 0), 90);

  const { data: tenant, error: tenantError } = await db.from('tenants').insert({ name: s.businessName, timezone: s.timezone }).select('id').single();
  if (tenantError) {
    if (tenantError.code === '23505') throw new HttpError(409, `A business called ${s.businessName} already exists. Choose another name.`);
    throw new Error(tenantError.message);
  }

  // Undo everything if a later step fails, so trying again starts clean.
  let userId: string | null = null;
  try {
    const { data: site, error: siteError } = await db
      .from('sites')
      .insert({ tenant_id: tenant.id, name: s.siteName, timezone: s.timezone })
      .select('id')
      .single();
    if (siteError) throw new Error(siteError.message);

    const { data: created, error: userError } = await db.auth.admin.createUser({
      email: s.email,
      password: s.password,
      email_confirm: true,
      user_metadata: { full_name: s.fullName },
    });
    if (userError || !created.user) {
      if (/already|registered|exists/i.test(userError?.message ?? '')) throw new HttpError(409, `${s.email} already has a login. Log in instead.`);
      throw new Error(userError?.message || 'Could not create the login.');
    }
    userId = created.user.id;

    const { error: profileError } = await db
      .from('profiles')
      .insert({ id: userId, tenant_id: tenant.id, full_name: s.fullName, role: 'admin', site_id: null, is_active: true });
    if (profileError) throw new Error(profileError.message);

    await db
      .from('tenant_billing')
      .upsert(
        {
          tenant_id: tenant.id,
          status: trialDays > 0 ? 'trial' : 'active',
          exempt: false,
          trial_ends_at: trialDays > 0 ? new Date(Date.now() + trialDays * 86400_000).toISOString() : null,
          created_via: 'signup',
          signup_ip: ip,
          contact_phone: phone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );
    await db.from('audit_log').insert({ tenant_id: tenant.id, user_id: userId, action: 'tenant.signed_up', details: { name: s.businessName, email: s.email, phone } });

    // Hotzonex Cloud hears about every new business.
    const { data: platform } = await db.rpc('platform_tenant_id');
    if (platform) {
      await db.rpc('raise_alert', {
        p_tenant_id: platform,
        p_kind: 'billing',
        p_key: `signup:${tenant.id}`,
        p_title: `New business: ${s.businessName}`,
        p_body: `${s.fullName} · ${s.email} · ${phone}. Free trial of ${trialDays} days.`,
        p_resolved: true,
      });
      await db.rpc('wake_alerts_sender');
    }
    return { tenant_id: tenant.id, site_id: site.id, trial_days: trialDays };
  } catch (err) {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('sites').delete().eq('tenant_id', tenant.id);
    await db.from('tenants').delete().eq('id', tenant.id);
    throw err;
  }
});
