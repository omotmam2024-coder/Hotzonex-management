// momo: a business's MTN MoMo API login (Business admins only). Customers then pay on the Buy page
// with a prompt on their phone, and the card is given as soon as MoMo confirms the payment.
//
// POST { action: "save", enabled, environment, target_environment, currency, api_user, api_key?, subscription_key? }
//   → { saved: true }   (keys left blank keep the saved ones; keys are stored encrypted, never sent back)
// POST { action: "test" } → { ok: true }   (logs in to MoMo with the saved keys)
// POST { action: "remove" } → { removed: true }
// What is saved (without keys) is read with the database function momo_account().
import { audit, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { HttpError, readBody, serveJson } from '../_shared/cors.ts';
import { encryptSecret } from '../_shared/crypto.ts';
import { MomoClient, MomoError } from '../_shared/momo.ts';
import { momoAccount, secretKey } from '../_shared/momo-account.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(body: Record<string, unknown>, name: string): string {
  const v = typeof body[name] === 'string' ? (body[name] as string).trim() : '';
  if (v && !/^[A-Za-z0-9_-]{8,128}$/.test(v)) throw new HttpError(400, 'The MoMo keys are letters and digits, as shown on the MTN MoMo developer page.');
  return v;
}

serveJson(async (req) => {
  const db = serviceClient();
  const caller = await requireAdmin(req, db);
  const body = await readBody(req);

  if (body.action === 'save') {
    const environment = body.environment === 'production' ? 'production' : 'sandbox';
    const target = typeof body.target_environment === 'string' ? body.target_environment.trim().toLowerCase() : '';
    if (!/^[a-z]{3,40}$/.test(target)) throw new HttpError(400, 'Type the target environment from MTN (for example sandbox or mtnsouthsudan).');
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Type the currency code from MTN (SSP; the sandbox uses EUR).');
    const apiUser = typeof body.api_user === 'string' ? body.api_user.trim() : '';
    if (!UUID_RE.test(apiUser)) throw new HttpError(400, 'The API user is the long ID from MTN (like 1a2b3c4d-…).');
    const apiKey = key(body, 'api_key');
    const subscriptionKey = key(body, 'subscription_key');

    const { data: existing } = await db.from('momo_accounts').select('tenant_id').eq('tenant_id', caller.tenantId).maybeSingle();
    if (!existing && (!apiKey || !subscriptionKey)) throw new HttpError(400, 'Type the API key and the subscription key.');
    const secret = apiKey || subscriptionKey ? await secretKey(db) : '';
    const { error } = await db.from('momo_accounts').upsert(
      {
        tenant_id: caller.tenantId,
        enabled: body.enabled === true,
        environment,
        target_environment: target,
        currency,
        api_user: apiUser,
        ...(apiKey ? { api_key_enc: await encryptSecret(apiKey, secret) } : {}),
        ...(subscriptionKey ? { subscription_key_enc: await encryptSecret(subscriptionKey, secret) } : {}),
        updated_by: caller.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );
    if (error) throw new Error(`MoMo login not saved: ${error.message}`);
    await audit(db, caller, 'momo.saved', { enabled: body.enabled === true, environment, target_environment: target, currency, keys_changed: Boolean(apiKey || subscriptionKey) });
    return { saved: true };
  }

  if (body.action === 'test') {
    const account = await momoAccount(db, caller.tenantId, true);
    if (!account) throw new HttpError(400, 'Save the MoMo login first.');
    try {
      await new MomoClient(account).test();
    } catch (err) {
      if (err instanceof MomoError) throw new HttpError(400, err.message);
      throw err;
    }
    return { ok: true };
  }

  if (body.action === 'remove') {
    const { error } = await db.from('momo_accounts').delete().eq('tenant_id', caller.tenantId);
    if (error) throw new Error(error.message);
    await audit(db, caller, 'momo.removed', {});
    return { removed: true };
  }

  throw new HttpError(400, 'Unknown action.');
});
