// WhatsApp alerts without an API key: a normal WhatsApp number (Hotzonex Cloud's sender SIM) is
// linked like WhatsApp Web to a small program on the tunnel server (VPS). The alerts Edge Function
// asks that program, through the server's HTTPS relay, to send each alert as a normal message.
//
// This is unofficial (WhatsApp Web protocol, library @whiskeysockets/baileys). Low volume to people
// who expect the messages keeps the risk of WhatsApp blocking the sender low, but it is not zero:
// use a separate SIM for sending, never the owner's personal number.

/** Phone numbers as WhatsApp wants them: country code and number, digits only (e.g. 211924904216). */
export const WA_NUMBER_RE = /^[1-9][0-9]{7,14}$/;

/** "0924 904 216", "+211 924-904-216", "00211924904216" → "211924904216". Local 0 + 9 digits = South Sudan (+211). */
export function normalizeWhatsAppNumber(input: string): string | null {
  let n = input.trim().replace(/[\s().-]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (/^0[0-9]{9}$/.test(n)) n = `211${n.slice(1)}`;
  return WA_NUMBER_RE.test(n) ? n : null;
}

/** "211924904216" → "+211 924 904 216" for people to read. */
export function formatWhatsAppNumber(n: string): string {
  const m = /^211([0-9]{3})([0-9]{3})([0-9]{3})$/.exec(n);
  return m ? `+211 ${m[1]} ${m[2]} ${m[3]}` : `+${n}`;
}

export const WA_PORT = 3410;
/** Session id of Hotzonex Cloud's own sender (alerts to business owners); businesses use their id. */
export const WA_PLATFORM_SID = 'hzc';
export const BAILEYS_VERSION = '6.7.24';
export const QRCODE_VERSION = '1.5.4';

/**
 * The program that runs on the VPS (Node 20, ES module). It holds several linked WhatsApp numbers
 * ("sessions"): "hzc" is Hotzonex Cloud's own sender (alerts to business owners), and each
 * business that sends reminders to its customers links its own number under its business id.
 * Sessions live in /var/lib/hzc-wa/auth/<id>. It listens on 127.0.0.1 only (Caddy forwards
 * https://<relay>/wa/* to it, only with the secret) and checks the secret in x-hzc-wa again.
 *
 *   GET  /wa/<id>/status  → { state: none|starting|qr|connected|reconnecting|logged_out, me, since, qr (PNG data URL while linking) }
 *   POST /wa/<id>/link    → starts the session (shows a QR code if no phone is linked yet), then as status
 *   POST /wa/<id>/send    { to: "211…", text } → { sent: true }   (per number: one message every 1.5 s at most)
 *   POST /wa/<id>/logout  → unlinks the phone and forgets the session
 */
export const WA_BRIDGE_JS = String.raw`// Hotzonex Cloud WhatsApp sender. Installed by Hotzonex (Businesses > WhatsApp sender); do not edit.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';

const SECRET = process.env.HZC_WA_SECRET || '';
const PORT = Number(process.env.HZC_WA_PORT || ${WA_PORT});
const AUTH_DIR = process.env.HZC_WA_AUTH || '/var/lib/hzc-wa/auth';
const GAP_MS = Number(process.env.HZC_WA_GAP_MS || 1500);
const MAX_SESSIONS = Number(process.env.HZC_WA_MAX_SESSIONS || 300);
const SID_RE = /^[a-z0-9-]{3,40}$/;
if (!/^[0-9a-f]{32,128}$/.test(SECRET)) {
  console.error('HZC_WA_SECRET is missing or wrong.');
  process.exit(1);
}

const quiet = {
  level: 'silent',
  child() { return quiet; },
  trace() {}, debug() {}, info() {}, warn() {},
  error() {},
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let waVersion;
let waVersionAt = 0;

/** The newest WhatsApp Web version, looked up at most every 6 hours (the library's own after 10 s). */
async function version() {
  if (Date.now() - waVersionAt < 6 * 3600 * 1000) return waVersion;
  waVersionAt = Date.now();
  try {
    const got = await Promise.race([fetchLatestBaileysVersion(), wait(10000).then(() => ({}))]);
    if (got.version) waVersion = got.version;
  } catch {
    /* keep the last one */
  }
  return waVersion;
}

/** id → { sock, state, qr, me, since, retry, timer, chain } */
const sessions = new Map();

function setState(sid, s, state) {
  s.state = state;
  s.since = new Date().toISOString();
  console.log(sid + ': ' + state + (s.me ? ' as ' + s.me : ''));
}

function session(sid) {
  let s = sessions.get(sid);
  if (!s) {
    s = { sock: null, state: 'starting', qr: null, me: null, since: new Date().toISOString(), retry: 0, timer: null, chain: Promise.resolve(), stopped: false };
    sessions.set(sid, s);
  }
  return s;
}

async function start(sid) {
  const s = session(sid);
  if (s.stopped) return;
  clearTimeout(s.timer);
  const dir = join(AUTH_DIR, sid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { state: auth, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    auth,
    version: await version(),
    logger: quiet,
    browser: ['Hotzonex Cloud', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    printQRInTerminal: false,
  });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (s.sock !== sock) return;
    if (u.qr) {
      s.qr = u.qr;
      setState(sid, s, 'qr');
    }
    if (u.connection === 'open') {
      s.qr = null;
      s.retry = 0;
      s.me = String((sock.user && sock.user.id) || '').split(':')[0].split('@')[0] || null;
      setState(sid, s, 'connected');
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : undefined;
      s.sock = null;
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone: forget it; it starts again (with a new QR code) only when asked.
        s.me = null;
        s.qr = null;
        setState(sid, s, 'logged_out');
        forget(sid).catch(() => {});
        return;
      }
      setState(sid, s, 'reconnecting');
      s.retry = Math.min(s.retry + 1, 8);
      s.timer = setTimeout(() => start(sid).catch((e) => failed(sid, e)), code === DisconnectReason.restartRequired ? 500 : 1000 * 2 ** s.retry);
    }
  });
}

function failed(sid, err) {
  const s = session(sid);
  console.error(sid + ': start failed: ' + (err && err.message ? err.message : err));
  setState(sid, s, 'reconnecting');
  clearTimeout(s.timer);
  s.timer = setTimeout(() => start(sid).catch((e) => failed(sid, e)), 30000);
}

/** Stops a session and deletes its saved login. */
async function forget(sid) {
  const s = sessions.get(sid);
  if (s) {
    s.stopped = true;
    clearTimeout(s.timer);
    const sock = s.sock;
    s.sock = null;
    if (sock) await sock.logout().catch(() => {});
    sessions.delete(sid);
  }
  await rm(join(AUTH_DIR, sid), { recursive: true, force: true });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function queued(s, fn) {
  const p = s.chain.then(fn);
  s.chain = p.then(() => wait(GAP_MS), () => wait(GAP_MS));
  return p;
}

async function send(s, to, text) {
  const sock = s.sock;
  if (s.state !== 'connected' || !sock) throw httpError(503, 'This WhatsApp sender is not connected.');
  const found = await sock.onWhatsApp(to + '@s.whatsapp.net');
  const hit = found && found[0];
  if (!hit || !hit.exists) throw httpError(404, 'This number is not on WhatsApp.');
  await sock.sendMessage(hit.jid, { text });
}

async function status(sid) {
  const s = sessions.get(sid);
  if (!s) return { state: 'none', me: null, since: null, qr: null };
  const image = s.state === 'qr' && s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 300 }) : null;
  return { state: s.state, me: s.me, since: s.since, qr: image };
}

function authorized(req) {
  const got = Buffer.from(String(req.headers['x-hzc-wa'] || ''));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16384) {
        reject(httpError(413, 'Too large.'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'Bad JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    if (!authorized(req)) return reply(403, { error: 'Forbidden' });
    const m = /^\/wa\/([^/]+)\/(status|link|send|logout)$/.exec(String(req.url || '').split('?')[0]);
    if (!m) return reply(404, { error: 'Not found.' });
    const [, sid, action] = m;
    if (!SID_RE.test(sid)) return reply(400, { error: 'Wrong sender id.' });
    if (req.method === 'GET' && action === 'status') return reply(200, await status(sid));
    if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
    if (action === 'link') {
      if (!sessions.has(sid)) {
        if (sessions.size >= MAX_SESSIONS) return reply(429, { error: 'Too many linked WhatsApp numbers on this server.' });
        session(sid);
        start(sid).catch((e) => failed(sid, e));
        await wait(1500);
      }
      return reply(200, await status(sid));
    }
    if (action === 'send') {
      const s = sessions.get(sid);
      if (!s) return reply(503, { error: 'This WhatsApp sender is not linked.' });
      const body = await readJson(req);
      const to = String(body.to || '');
      const text = String(body.text || '');
      if (!/^[1-9][0-9]{7,14}$/.test(to)) return reply(400, { error: 'Wrong phone number.' });
      if (!text.trim() || text.length > 4000) return reply(400, { error: 'Empty or too long message.' });
      await queued(s, () => send(s, to, text));
      return reply(200, { sent: true });
    }
    if (action === 'logout') {
      await forget(sid);
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'Not found.' });
  } catch (err) {
    if (!err.status) console.error('Request failed: ' + (err && err.message ? err.message : err));
    reply(err.status || 500, { error: err.status ? err.message : 'WhatsApp could not send this message.' });
  }
});

/** Starts every linked number found on disk (after a restart of this program or the server). */
async function boot() {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  // The first version kept Hotzonex's own sender directly in AUTH_DIR: move it to AUTH_DIR/hzc.
  const flat = await stat(join(AUTH_DIR, 'creds.json')).catch(() => null);
  if (flat) {
    await mkdir(join(AUTH_DIR, 'hzc'), { recursive: true, mode: 0o700 });
    for (const f of await readdir(AUTH_DIR)) {
      const from = join(AUTH_DIR, f);
      if ((await stat(from)).isFile()) await rename(from, join(AUTH_DIR, 'hzc', f));
    }
  }
  for (const sid of await readdir(AUTH_DIR)) {
    if (!SID_RE.test(sid) || sessions.size >= MAX_SESSIONS) continue;
    if (!(await stat(join(AUTH_DIR, sid, 'creds.json')).catch(() => null))) continue;
    session(sid);
    start(sid).catch((e) => failed(sid, e));
    await wait(500);
  }
}

server.listen(PORT, '127.0.0.1', () => console.log('Hotzonex WhatsApp sender on 127.0.0.1:' + PORT));
boot().catch((e) => console.error('Boot failed: ' + (e && e.message ? e.message : e)));
`;

/** The one-command installer for the tunnel server. Holds no secret: it is passed as HZC_WA_SECRET. */
export function waInstallScript(): string {
  if (WA_BRIDGE_JS.includes('HZC_WA_JS_EOF')) throw new Error('bridge source contains the heredoc marker');
  return `#!/usr/bin/env bash
# Hotzonex Cloud WhatsApp sender: links a normal WhatsApp number to this server to send alerts.
# Run it on the Hotzonex tunnel server. Running it again is safe (the linked phone stays linked).
set -euo pipefail
if [ "$(id -u)" != "0" ]; then echo "Run this as root (put sudo in front)."; exit 1; fi
if [ -z "\${HZC_WA_SECRET:-}" ]; then echo "HZC_WA_SECRET is missing. Copy the full command from Hotzonex (Businesses > WhatsApp sender)."; exit 1; fi
case "$HZC_WA_SECRET" in *[!0-9a-f]*) echo "HZC_WA_SECRET looks wrong. Copy the command again."; exit 1;; esac
if [ ! -s /etc/caddy/Caddyfile ]; then echo "Install the Hotzonex tunnel server on this VPS first (Routers > Tunnel server)."; exit 1; fi

echo "== Node.js 20"
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== WhatsApp sender program"
id hzc-wa >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hzc-wa --shell /usr/sbin/nologin hzc-wa
install -d -o hzc-wa -g hzc-wa -m 700 /var/lib/hzc-wa
install -d -m 755 /opt/hzc-wa
cat > /opt/hzc-wa/package.json <<'EOF'
{ "name": "hzc-wa", "private": true, "type": "module",
  "dependencies": { "@whiskeysockets/baileys": "${BAILEYS_VERSION}", "qrcode": "${QRCODE_VERSION}" } }
EOF
cat > /opt/hzc-wa/server.mjs <<'HZC_WA_JS_EOF'
${WA_BRIDGE_JS}HZC_WA_JS_EOF
# --ignore-scripts: no package may run its own install commands on this server.
(cd /opt/hzc-wa && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
chown -R root:root /opt/hzc-wa
chmod -R go-w /opt/hzc-wa
install -d -m 700 /etc/hotzonex
(umask 077; printf 'HZC_WA_SECRET=%s\\n' "$HZC_WA_SECRET" > /etc/hotzonex/wa.env)

cat > /etc/systemd/system/hzc-wa.service <<'EOF'
[Unit]
Description=Hotzonex WhatsApp sender
After=network-online.target
Wants=network-online.target
[Service]
User=hzc-wa
EnvironmentFile=/etc/hotzonex/wa.env
Environment=HZC_WA_AUTH=/var/lib/hzc-wa/auth
ExecStart=/usr/bin/env node /opt/hzc-wa/server.mjs
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=/var/lib/hzc-wa
CapabilityBoundingSet=
AmbientCapabilities=
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
[Install]
WantedBy=multi-user.target
EOF

echo "== HTTPS relay: /wa"
install -d -m 755 /etc/caddy/hzc.d
# Only requests that carry the secret reach the program; anything else gets the relay's plain 404.
(umask 027; cat > /etc/caddy/hzc.d/wa.caddy <<EOF
@hzc_wa {
	path /wa/*
	header X-Hzc-Wa $HZC_WA_SECRET
}
handle @hzc_wa {
	reverse_proxy 127.0.0.1:${WA_PORT}
}
EOF
)
chgrp caddy /etc/caddy/hzc.d/wa.caddy 2>/dev/null || true
if ! grep -q 'import /etc/caddy/hzc.d/' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-wa
  sed -i '0,/{[[:space:]]*$/s//{\\n\\timport \\/etc\\/caddy\\/hzc.d\\/*.caddy/' /etc/caddy/Caddyfile
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  echo "The relay settings did not pass Caddy's check; putting the old ones back."
  [ -f /etc/caddy/Caddyfile.before-wa ] && cp /etc/caddy/Caddyfile.before-wa /etc/caddy/Caddyfile
  exit 1
fi

systemctl daemon-reload
systemctl enable hzc-wa >/dev/null
systemctl restart hzc-wa
systemctl reload caddy

echo "== Checking"
for i in $(seq 1 30); do
  if out="$(curl -fsS --max-time 10 -X POST -H "x-hzc-wa: $HZC_WA_SECRET" http://127.0.0.1:${WA_PORT}/wa/${WA_PLATFORM_SID}/link 2>/dev/null)"; then
    echo "$out" | grep -o '"state":"[a-z_]*"' || true
    echo "== Done. Go back to Hotzonex (Businesses > WhatsApp sender) and scan the QR code with the"
    echo "   sender phone: WhatsApp > Settings > Linked devices > Link a device."
    exit 0
  fi
  sleep 2
done
echo "The WhatsApp sender did not start. Look at: journalctl -u hzc-wa -n 50"
exit 1
`;
}
