// A business's MTN MoMo login, read and decrypted with the service role (Edge Functions only).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { decryptSecret } from './crypto.ts';
import type { MomoAccount, MomoEnvironment } from './momo.ts';

export async function secretKey(db: SupabaseClient): Promise<string> {
  const { data: key, error } = await db.rpc('router_secret_key');
  if (error || typeof key !== 'string') throw new Error('The secret key could not be read.');
  return key;
}

/** The business's MoMo login, or null when it has none or has switched it off. */
export async function momoAccount(db: SupabaseClient, tenantId: string, includeOff = false): Promise<MomoAccount | null> {
  const { data: row, error } = await db
    .from('momo_accounts')
    .select('enabled, environment, target_environment, currency, api_user, api_key_enc, subscription_key_enc')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`MoMo login lookup failed: ${error.message}`);
  if (!row || (!row.enabled && !includeOff)) return null;
  const key = await secretKey(db);
  return {
    environment: row.environment as MomoEnvironment,
    targetEnvironment: row.target_environment as string,
    currency: row.currency as string,
    apiUser: row.api_user as string,
    apiKey: await decryptSecret(row.api_key_enc as string, key),
    subscriptionKey: await decryptSecret(row.subscription_key_enc as string, key),
  };
}
