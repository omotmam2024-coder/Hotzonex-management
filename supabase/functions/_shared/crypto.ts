/**
 * AES-256-GCM encryption for router passwords.
 * Output: "v1:<base64 iv (12 bytes)>:<base64 ciphertext with 16-byte tag appended>".
 * The Router Agent decrypts the same format with the same ROUTER_SECRET_KEY (64 hex chars).
 */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('ROUTER_SECRET_KEY must be 64 hex characters (openssl rand -hex 32).');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plaintext)),
  );
  return `v1:${toBase64(iv)}:${toBase64(encrypted)}`;
}
