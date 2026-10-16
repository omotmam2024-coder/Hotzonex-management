/** Address printed on cards, e.g. "http://hotzonex.wifi". */
export function loginAddress(dnsName: string): string {
  return `http://${dnsName}`;
}

/**
 * QR target that logs the customer straight in: username and password are both the code. It uses
 * the hotspot's IP when known: the router's DNS name only works on phones that ask the router for
 * names, and many phones use Google's "Private DNS" instead ("site can't be reached").
 */
export function loginUrl(dnsName: string, code: string, hotspotIp = ''): string {
  const c = encodeURIComponent(code);
  return `http://${hotspotIp || dnsName}/login?username=${c}&password=${c}`;
}
