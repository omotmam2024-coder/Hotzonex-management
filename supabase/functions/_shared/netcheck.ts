// Checks that keep router connections on the public internet (never Hotzonex Cloud's own network)
// and compare secrets without leaking their content through timing.

/** Addresses that only work inside a local network (or are not router addresses at all). */
export function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Loopback, local, link-local and IPv4-mapped private IPv6 addresses. */
export function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return false;
  if (h === '::' || h === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h);
}

export const isDottedIpv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

/**
 * A router name must be a real DNS name: its last label starts with a letter. This turns away
 * numeric forms such as "2130706433" or "0x7f.1", which fetch reads as internal addresses.
 */
export function isDnsName(host: string): boolean {
  const labels = host.split('.');
  return /^[a-z][a-z0-9-]*$/i.test(labels[labels.length - 1] ?? '');
}

/**
 * Throws when the host is, or currently resolves to, a private address. Run right before each
 * connection: a name can be pointed somewhere else after the router was saved.
 */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.replace(/^\[|\]$/g, '');
  if (isDottedIpv4(h)) {
    if (isPrivateIpv4(h)) throw new Error(`${host} is not a public address.`);
    return;
  }
  if (h.includes(':')) {
    if (isPrivateIpv6(h)) throw new Error(`${host} is not a public address.`);
    return;
  }
  if (!isDnsName(h) || h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/i.test(h)) throw new Error(`${host} is not a public address.`);
  const [a, aaaa] = await Promise.all([Deno.resolveDns(h, 'A').catch(() => [] as string[]), Deno.resolveDns(h, 'AAAA').catch(() => [] as string[])]);
  if (a.some(isPrivateIpv4) || aaaa.some(isPrivateIpv6)) throw new Error(`${host} leads to a private address.`);
}

/**
 * The port Hotzonex logs in to a router at its public address. That login crosses the internet,
 * so it is always HTTPS (the router's www-ssl service): the form's default web port 80 becomes 443.
 */
export function directPort(port: number): number {
  return port === 80 ? 443 : port;
}

/** Constant-time comparison of two strings. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
