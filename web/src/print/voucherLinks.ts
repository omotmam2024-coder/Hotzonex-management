/** Address printed on cards, e.g. "http://hotzonex.wifi". */
export function loginAddress(dnsName: string): string {
  return `http://${dnsName}`;
}

/** QR target that logs the customer straight in: username and password are both the code. */
export function loginUrl(dnsName: string, code: string): string {
  const c = encodeURIComponent(code);
  return `http://${dnsName}/login?username=${c}&password=${c}`;
}
