import { createDecipheriv } from 'node:crypto';

/**
 * Decrypts a router password written by the add-router Edge Function.
 * Format: "v1:<base64 iv (12 bytes)>:<base64 ciphertext with 16-byte GCM tag appended>".
 */
export function decryptSecret(encoded: string, key: Buffer): string {
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Stored router password has an unknown format.');
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const data = Buffer.from(parts[2] ?? '', 'base64');
  if (iv.length !== 12 || data.length < 17) throw new Error('Stored router password is damaged.');

  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Cannot decrypt the router password. ROUTER_SECRET_KEY on this computer must match the Edge Function secret.');
  }
}
