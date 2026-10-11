/**
 * AES-256-GCM encryption for router admin passwords (direct connection).
 * Format: "v1:<base64 iv (12 bytes)>:<base64 ciphertext with 16-byte tag appended>".
 * The 64-hex key lives in Supabase Vault and is read with the router_secret_key() function.
 */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('The router password key is missing or damaged (Vault secret router_secret_key).');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plaintext)),
  );
  return `v1:${toBase64(iv)}:${toBase64(encrypted)}`;
}

export async function decryptSecret(encoded: string, keyHex: string): Promise<string> {
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('The stored router password has an unknown format. Enter it again.');
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(parts[1] ?? ''), tagLength: 128 }, key, fromBase64(parts[2] ?? ''));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('The stored router password cannot be read. Edit the router and enter its password again.');
  }
}
