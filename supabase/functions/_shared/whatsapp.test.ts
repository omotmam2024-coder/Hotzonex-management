import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { formatWhatsAppNumber, normalizeWhatsAppNumber, WA_BRIDGE_JS, waInstallScript } from './whatsapp.ts';

test('WhatsApp numbers: local South Sudan numbers, + and 00 prefixes, junk refused', () => {
  assert.equal(normalizeWhatsAppNumber('0924904216'), '211924904216');
  assert.equal(normalizeWhatsAppNumber('0924 904 216'), '211924904216');
  assert.equal(normalizeWhatsAppNumber('+211 924-904-216'), '211924904216');
  assert.equal(normalizeWhatsAppNumber('00211924904216'), '211924904216');
  assert.equal(normalizeWhatsAppNumber('211924904216'), '211924904216');
  assert.equal(normalizeWhatsAppNumber('+254 712 345 678'), '254712345678');
  assert.equal(normalizeWhatsAppNumber('12345'), null);
  assert.equal(normalizeWhatsAppNumber('0924abc216'), null);
  assert.equal(normalizeWhatsAppNumber(''), null);
  assert.equal(formatWhatsAppNumber('211924904216'), '+211 924 904 216');
  assert.equal(formatWhatsAppNumber('254712345678'), '+254712345678');
});

test('install script: valid bash, holds no secret, carries the program unchanged', () => {
  const script = waInstallScript();
  const check = spawnSync('bash', ['-n'], { input: script });
  assert.equal(check.status, 0, String(check.stderr));
  assert.ok(script.includes(WA_BRIDGE_JS));
  assert.ok(!/HZC_WA_SECRET=[0-9a-f]{8}/.test(script));
  assert.ok(script.includes("import /etc/caddy/hzc.d/"));
  // Caddy only forwards requests carrying the secret; packages cannot run install scripts; sandboxed service.
  assert.ok(script.includes('header X-Hzc-Wa $HZC_WA_SECRET'));
  assert.ok(script.includes('--ignore-scripts'));
  assert.ok(script.includes('User=hzc-wa') && script.includes('CapabilityBoundingSet=') && script.includes('ProtectSystem=strict'));
  assert.ok(script.includes('127.0.0.1') && !/listen\([^)]*0\.0\.0\.0/.test(script));
});

// ---------------------------------------------------------------------------------------------
// The VPS program, run with a fake WhatsApp library (no network).
// ---------------------------------------------------------------------------------------------

const SECRET = 'a'.repeat(48);
const PORT = 34000 + Math.floor(Math.random() * 1000);
let dir = '';
let child: ReturnType<typeof spawn> | null = null;

const FAKE_BAILEYS = `
import { appendFileSync } from 'node:fs';
const LOG = process.env.FAKE_LOG;
export const DisconnectReason = { loggedOut: 401, restartRequired: 515 };
export async function fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; }
export async function useMultiFileAuthState() { return { state: {}, saveCreds() {} }; }
export function makeWASocket() {
  const handlers = {};
  const s = {
    user: null,
    ev: { on(name, fn) { (handlers[name] ||= []).push(fn); } },
    emit(name, data) { for (const fn of handlers[name] || []) fn(data); },
    async onWhatsApp(jid) { const n = jid.split('@')[0]; return n.endsWith('0') ? [] : [{ exists: true, jid }]; },
    async sendMessage(jid, msg) { appendFileSync(LOG, jid + '|' + msg.text + '\\n'); },
    async logout() { appendFileSync(LOG, 'logout\\n'); },
  };
  setTimeout(() => s.emit('connection.update', { qr: 'QR-1' }), 20);
  setTimeout(() => { s.user = { id: '211900000001:7@s.whatsapp.net' }; s.emit('connection.update', { connection: 'open' }); }, 400);
  return s;
}
`;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hzc-wa-'));
  const pkg = (name: string, code: string) => {
    const p = join(dir, 'node_modules', ...name.split('/'));
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }));
    writeFileSync(join(p, 'index.js'), code);
  };
  pkg('@whiskeysockets/baileys', FAKE_BAILEYS);
  pkg('qrcode', `export default { async toDataURL(t) { return 'data:image/png;base64,' + Buffer.from(t).toString('base64'); } };`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(dir, 'server.mjs'), WA_BRIDGE_JS);
  writeFileSync(join(dir, 'log.txt'), '');
  child = spawn(process.execPath, [join(dir, 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, HZC_WA_SECRET: SECRET, HZC_WA_PORT: String(PORT), HZC_WA_AUTH: join(dir, 'auth'), HZC_WA_GAP_MS: '10', FAKE_LOG: join(dir, 'log.txt') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/wa/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('the WhatsApp sender did not start');
});

after(() => {
  child?.kill();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit = {}, secret = SECRET) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-hzc-wa': secret, ...(init.headers ?? {}) } });

test('VPS program: refuses requests without the secret', async () => {
  assert.equal((await call('/wa/status', {}, 'b'.repeat(48))).status, 403);
  assert.equal((await call('/wa/status', {}, '')).status, 403);
});

test('VPS program: QR code while linking, then connected, sends, refuses bad numbers, logs out', async () => {
  let s = await (await call('/wa/status')).json();
  if (s.state !== 'qr') {
    await new Promise((r) => setTimeout(r, 50));
    s = await (await call('/wa/status')).json();
  }
  assert.equal(s.state, 'qr');
  assert.match(s.qr, /^data:image\/png;base64,/);

  // Not connected yet: nothing is sent.
  assert.equal((await call('/wa/send', { method: 'POST', body: JSON.stringify({ to: '211924904216', text: 'hi' }) })).status, 503);

  await new Promise((r) => setTimeout(r, 500));
  s = await (await call('/wa/status')).json();
  assert.equal(s.state, 'connected');
  assert.equal(s.me, '211900000001');
  assert.equal(s.qr, null);

  const ok = await call('/wa/send', { method: 'POST', body: JSON.stringify({ to: '211924904216', text: 'Router offline' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { sent: true });
  assert.equal((await call('/wa/send', { method: 'POST', body: JSON.stringify({ to: '211924904210', text: 'x' }) })).status, 404);
  assert.equal((await call('/wa/send', { method: 'POST', body: JSON.stringify({ to: '0924', text: 'x' }) })).status, 400);
  assert.equal((await call('/wa/send', { method: 'POST', body: JSON.stringify({ to: '211924904216', text: ' ' }) })).status, 400);
  assert.equal((await call('/wa/send', { method: 'POST', body: '{bad' })).status, 400);
  assert.equal((await call('/wa/nope')).status, 404);

  assert.equal((await call('/wa/logout', { method: 'POST' })).status, 200);
  const log = readFileSync(join(dir, 'log.txt'), 'utf8');
  assert.match(log, /^211924904216@s\.whatsapp\.net\|Router offline$/m);
  assert.match(log, /^logout$/m);
  s = await (await call('/wa/status')).json();
  assert.ok(['qr', 'starting', 'logged_out'].includes(s.state), s.state);
});
