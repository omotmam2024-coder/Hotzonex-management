/** Address printed on cards, e.g. "http://hotzonex.wifi". */
export function loginAddress(dnsName: string): string {
  return `http://${dnsName}`;
}
