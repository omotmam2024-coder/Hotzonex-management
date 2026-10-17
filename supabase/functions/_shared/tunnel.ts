// Tunnel connection: routers without a public IP (CGNAT, Starlink, 4G) keep a WireGuard tunnel open
// to the admin's own small server (VPS). Nothing is scheduled on the router: WireGuard keeps the
// tunnel up by itself (persistent-keepalive) and reconnects after power cuts.
//
//   router 10.99.0.N ──WireGuard──► VPS 10.99.0.1 ──► relay (Caddy, HTTPS) ◄── router-direct (Hotzonex)
//
// The relay only forwards /rest/… requests to 10.99.0.x addresses and only with the relay secret;
// the router's own username and password are still needed for every request.
// Pure functions (WebCrypto only) so they run in tests under Node too.
import { rosStr } from './routeros.ts';

export const TUNNEL_PREFIX = '10.99.0.';
export const VPS_TUNNEL_IP = '10.99.0.1';
export const WG_PORT = 51820;
export const ROUTER_WG_INTERFACE = 'wg-hzc';
export const ROUTER_WG_LISTEN_PORT = 51831;
export const TUNNEL_COMMENT = 'hotzonex-tunnel';

export const TUNNEL_IP_RE = /^10\.99\.0\.(\d{1,3})$/;
export const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** A WireGuard key pair (Curve25519), both keys base64 like `wg genkey` / `wg pubkey`. */
export async function generateWgKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: toBase64(pkcs8.slice(pkcs8.length - 32)), publicKey: toBase64(raw) };
}

/** The lowest free tunnel address from 10.99.0.2 to 10.99.0.254. */
export function nextTunnelIp(used: (string | null)[]): string {
  const taken = new Set(used.map((ip) => Number(TUNNEL_IP_RE.exec(ip ?? '')?.[1] ?? -1)));
  for (let n = 2; n <= 254; n++) if (!taken.has(n)) return `${TUNNEL_PREFIX}${n}`;
  throw new Error('All 253 tunnel addresses are in use.');
}

/** Base URL of a tunnel router's REST API through the relay. */
export function relayRestUrl(relayUrl: string, tunnelIp: string, port: number): string {
  if (!TUNNEL_IP_RE.test(tunnelIp)) throw new Error(`Invalid tunnel address ${tunnelIp}`);
  return `${relayUrl.replace(/\/$/, '')}/r/${tunnelIp}:${port}/rest`;
}

/** WireGuard [Peer] sections for the VPS, one per tunnel router. */
export function peersConfig(routers: { name: string; tunnel_ip: string | null; wg_public_key: string | null }[]): string {
  const lines = ['# hzc-peers'];
  for (const r of routers) {
    if (!r.tunnel_ip || !TUNNEL_IP_RE.test(r.tunnel_ip) || !r.wg_public_key || !WG_KEY_RE.test(r.wg_public_key)) continue;
    lines.push('', '[Peer]', `# ${r.name.replace(/[\r\n]/g, ' ')}`, `PublicKey = ${r.wg_public_key}`, `AllowedIPs = ${r.tunnel_ip}/32`);
  }
  return lines.join('\n') + '\n';
}

export interface TunnelScriptOptions {
  routerName: string;
  privateKey: string;
  tunnelIp: string;
  vpsPublicKey: string;
  endpoint: string; // VPS public IP or name
  wwwPort: number; // the router's www (REST) service port
}

/**
 * One-time router script. It checks for a running hotspot first and changes nothing without one.
 * Then it adds only: a WireGuard interface "wg-hzc" with one peer (the VPS), the tunnel address,
 * and one firewall rule that lets the VPS reach the www service. All three are tagged
 * comment=hotzonex-tunnel. The old hzc-cloud scheduler and script are removed. Safe to paste again.
 */
export function tunnelSetupScript(o: TunnelScriptOptions): string {
  const c = rosStr(TUNNEL_COMMENT);
  const wg = rosStr(ROUTER_WG_INTERFACE);
  const rule = `chain=input in-interface=${wg} src-address=${VPS_TUNNEL_IP} protocol=tcp dst-port=${o.wwwPort} action=accept comment=${c}`;
  return [
    `:put ${rosStr(`Hotzonex Cloud: checking router ${o.routerName.replace(/[\r\n]/g, ' ')}...`)}`,
    ':if ([:len [/ip hotspot find where disabled=no]] = 0) do={',
    '  :put "Hotzonex Cloud: no running hotspot found. Set up the hotspot first (IP > Hotspot > Hotspot Setup), then paste this script again. Nothing was changed."',
    '} else={',
    '  :foreach i in=[/ip hotspot find where disabled=no] do={ :put ("Hotzonex Cloud: hotspot " . [/ip hotspot get $i name] . " is running on " . [/ip hotspot get $i interface] . ". It will not be changed.") }',
    `  /ip firewall filter remove [find where comment=${c}]`,
    `  /ip address remove [find where comment=${c}]`,
    `  /interface wireguard peers remove [find where comment=${c}]`,
    `  /interface wireguard remove [find where name=${wg}]`,
    `  /interface wireguard add name=${wg} listen-port=${ROUTER_WG_LISTEN_PORT} private-key=${rosStr(o.privateKey)} comment=${c}`,
    `  /interface wireguard peers add interface=${wg} public-key=${rosStr(o.vpsPublicKey)} endpoint-address=${rosStr(o.endpoint)} endpoint-port=${WG_PORT} allowed-address=${VPS_TUNNEL_IP}/32 persistent-keepalive=25s comment=${c}`,
    `  /ip address add address=${o.tunnelIp}/24 interface=${wg} comment=${c}`,
    '  :local first [/ip firewall filter find where dynamic=no]',
    '  :if ([:len $first] > 0) do={',
    `    /ip firewall filter add ${rule} place-before=[:pick $first 0]`,
    '  } else={',
    `    /ip firewall filter add ${rule}`,
    '  }',
    '  /system scheduler remove [find where name="hzc-cloud"]',
    '  /system script remove [find where name="hzc-cloud"]',
    '  :if ([/ip service get www disabled]) do={ :put "Hotzonex Cloud: WARNING the www service is switched off. Turn it on (IP > Services > www), or Hotzonex cannot reach the router." }',
    `  :if ([/ip service get www port] != ${o.wwwPort}) do={ :put ("Hotzonex Cloud: WARNING the www service uses port " . [/ip service get www port] . ", not ${o.wwwPort}. Edit the router in Hotzonex and set Port to " . [/ip service get www port] . ".") }`,
    `  :put "Hotzonex Cloud: tunnel installed (no scheduler). The router shows Online on the website within a minute."`,
    '}',
    '',
  ].join('\n');
}

/**
 * Bash installer for the VPS (Ubuntu/Debian). Run as root with HZC_SECRET set. It installs WireGuard
 * and Caddy, serves the relay at https://<ip-with-dashes>.sslip.io (or HZC_DOMAIN) with a free
 * certificate, keeps the router list in sync with Hotzonex every 30 s, and registers itself.
 * Running it again keeps the server's WireGuard key.
 */
export function vpsInstallScript(supabaseUrl: string): string {
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/tunnel`;
  return `#!/usr/bin/env bash
# Hotzonex Cloud tunnel server: WireGuard for the routers + HTTPS relay for Hotzonex.
set -euo pipefail
HZC_FN=${JSON.stringify(fnUrl)}
if [ "$(id -u)" != "0" ]; then echo "Run this as root (put sudo in front)."; exit 1; fi
if [ -z "\${HZC_SECRET:-}" ]; then echo "HZC_SECRET is missing. Copy the full command from Hotzonex (Routers > Tunnel server)."; exit 1; fi
case "$HZC_SECRET" in *[!0-9a-f]*) echo "HZC_SECRET looks wrong. Copy the command again."; exit 1;; esac

echo "== Installing WireGuard and Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y wireguard curl gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

PUBLIC_IP="$(curl -4fsS --max-time 15 https://api.ipify.org)"
HOST="\${HZC_DOMAIN:-$(echo "$PUBLIC_IP" | tr . -).sslip.io}"
echo "== Public IP $PUBLIC_IP, relay https://$HOST"

install -d -m 700 /etc/hotzonex
[ -s /etc/hotzonex/wg.key ] || (umask 077; wg genkey > /etc/hotzonex/wg.key)
VPS_PUB="$(wg pubkey < /etc/hotzonex/wg.key)"
(umask 077; cat > /etc/hotzonex/env <<EOF
HZC_FN=$HZC_FN
HZC_SECRET=$HZC_SECRET
EOF
)
(umask 077; cat > /etc/hotzonex/wg0-interface.conf <<EOF
[Interface]
Address = ${VPS_TUNNEL_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = $(cat /etc/hotzonex/wg.key)
EOF
)
[ -f /etc/wireguard/wg0.conf ] || install -m 600 /etc/hotzonex/wg0-interface.conf /etc/wireguard/wg0.conf

echo "== Router list sync (every 30 s)"
cat > /usr/local/bin/hzc-wg-sync <<'EOF'
#!/usr/bin/env bash
# Writes the WireGuard peers (one per router) from Hotzonex and applies them without dropping tunnels.
set -euo pipefail
. /etc/hotzonex/env
peers="$(curl -fsS --max-time 20 -H "x-hzc-relay: $HZC_SECRET" "$HZC_FN?f=peers")" || exit 0
case "$peers" in "# hzc-peers"*) ;; *) exit 0;; esac
new="$(cat /etc/hotzonex/wg0-interface.conf; printf '\\n%s\\n' "$peers")"
if [ "$new" != "$(cat /etc/wireguard/wg0.conf 2>/dev/null)" ]; then
  (umask 077; printf '%s\\n' "$new" > /etc/wireguard/wg0.conf.new)
  mv /etc/wireguard/wg0.conf.new /etc/wireguard/wg0.conf
  if ip link show wg0 >/dev/null 2>&1; then wg syncconf wg0 <(wg-quick strip wg0); fi
fi
EOF
chmod 755 /usr/local/bin/hzc-wg-sync
cat > /etc/systemd/system/hzc-wg-sync.service <<'EOF'
[Unit]
Description=Hotzonex router list sync
After=network-online.target wg-quick@wg0.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hzc-wg-sync
EOF
cat > /etc/systemd/system/hzc-wg-sync.timer <<'EOF'
[Unit]
Description=Hotzonex router list sync every 30 seconds
[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
AccuracySec=5s
[Install]
WantedBy=timers.target
EOF

echo "== HTTPS relay"
# Extra routes (e.g. the WhatsApp sender, /wa) live in /etc/caddy/hzc.d and survive running this again.
install -d -m 755 /etc/caddy/hzc.d
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
\timport /etc/caddy/hzc.d/*.caddy
\t@relay {
\t\theader X-Hzc-Relay $HZC_SECRET
\t\tpath_regexp hzc ^/r/(10\\.99\\.0\\.[0-9]{1,3}):([0-9]{1,5})(/rest(/.*)?)$
\t}
\thandle @relay {
\t\trewrite * {re.hzc.3}?{query}
\t\treverse_proxy {re.hzc.1}:{re.hzc.2} {
\t\t\theader_up Host {re.hzc.1}
\t\t\theader_up -X-Hzc-Relay
\t\t\ttransport http {
\t\t\t\tdial_timeout 4s
\t\t\t}
\t\t}
\t}
\thandle {
\t\trespond "Hotzonex tunnel server" 404
\t}
}
EOF
chmod 640 /etc/caddy/Caddyfile
chgrp caddy /etc/caddy/Caddyfile 2>/dev/null || true

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow ${WG_PORT}/udp; ufw allow 80/tcp; ufw allow 443/tcp
fi

systemctl daemon-reload
systemctl enable --now wg-quick@wg0
systemctl enable --now hzc-wg-sync.timer
systemctl enable caddy
systemctl restart caddy

echo "== Registering with Hotzonex"
curl -fsS --max-time 20 -X POST -H "x-hzc-relay: $HZC_SECRET" -H "Content-Type: application/json" \\
  -d "{\\"public_key\\":\\"$VPS_PUB\\",\\"relay_url\\":\\"https://$HOST\\",\\"endpoint\\":\\"$PUBLIC_IP\\"}" "$HZC_FN?f=register"
echo
/usr/local/bin/hzc-wg-sync || true
echo "== Done. The tunnel server is ready. Go back to Hotzonex: it now shows the tunnel server as Ready."
echo "   Make sure UDP ${WG_PORT} and TCP 80/443 are open in your VPS provider's firewall."
`;
}
