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
let n = 0;
export const DisconnectReason = { loggedOut: 401, restartRequired: 515 };
export async function fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; }
export async function useMultiFileAuthState(folder) { return { state: { folder }, saveCreds() {} }; }
export function makeWASocket({ auth }) {
  const handlers = {};
  const id = ++n;
  const s = {
    user: null,
    ev: { on(name, fn) { (handlers[name] ||= []).push(fn); } },
    emit(name, data) { for (const fn of handlers[name] || []) fn(data); },
    async onWhatsApp(jid) { const num = jid.split('@')[0]; return num.endsWith('0') ? [] : [{ exists: true, jid }]; },
    async sendMessage(jid, msg) { appendFileSync(LOG, auth.folder.split('/').pop() + '>' + jid + '|' + msg.text + '\\n'); },
    async logout() { appendFileSync(LOG, 'logout ' + auth.folder.split('/').pop() + '\\n'); },
  };
  setTimeout(() => s.emit('connection.update', { qr: 'QR-' + id }), 20);
  setTimeout(() => { s.user = { id: '2119000000' + String(id).padStart(2, '0') + ':7@s.whatsapp.net' }; s.emit('connection.update', { connection: 'open' }); }, 2500);
  return s;
}
`;

function startProgram() {
  child = spawn(process.execPath, [join(dir, 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, HZC_WA_SECRET: SECRET, HZC_WA_PORT: String(PORT), HZC_WA_AUTH: join(dir, 'auth'), HZC_WA_GAP_MS: '10', FAKE_LOG: join(dir, 'log.txt') },
    stdio: 'ignore',
  });
}

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/wa/hzc/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('the WhatsApp sender did not start');
}

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
  // A login saved by the first version (directly in the auth folder) must move to auth/hzc.
  mkdirSync(join(dir, 'auth'), { recursive: true });
  writeFileSync(join(dir, 'auth', 'creds.json'), '{}');
  startProgram();
  await waitUp();
});

after(() => {
  child?.kill();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = (path: string, init: RequestInit = {}, secret = SECRET) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-hzc-wa': secret, ...(init.headers ?? {}) } });
const status = async (sid: string) => (await call(`/wa/${sid}/status`)).json();
const send = (sid: string, to: string, text: string) => call(`/wa/${sid}/send`, { method: 'POST', body: JSON.stringify({ to, text }) });

test('VPS program: refuses requests without the secret, odd ids and paths', async () => {
  assert.equal((await call('/wa/hzc/status', {}, 'b'.repeat(48))).status, 403);
  assert.equal((await call('/wa/hzc/status', {}, '')).status, 403);
  assert.equal((await call('/wa/AB/status')).status, 400);
  assert.equal((await call('/wa/../status')).status, 404);
  assert.equal((await call('/wa/hzc/nope')).status, 404);
  assert.equal((await call('/wa/hzc/send')).status, 405);
});

test('VPS program: the old single login moved to "hzc" and started by itself', async () => {
  assert.ok(existsSync(join(dir, 'auth', 'hzc', 'creds.json')));
  assert.ok(!existsSync(join(dir, 'auth', 'creds.json')));
  await sleep(3000);
  const s = await status('hzc');
  assert.equal(s.state, 'connected');
});

test('VPS program: each business links its own number; sending, wrong numbers, unlinking', async () => {
  const biz = 'b3f1c2d4-0000-4000-8000-000000000001';
  assert.equal((await status(biz)).state, 'none');
  assert.equal((await send(biz, '211924904216', 'x')).status, 503);

  let s = await (await call(`/wa/${biz}/link`, { method: 'POST' })).json();
  assert.equal(s.state, 'qr');
  assert.match(s.qr, /^data:image\/png;base64,/);
  assert.equal((await send(biz, '211924904216', 'x')).status, 503);

  await sleep(1500);
  s = await status(biz);
  assert.equal(s.state, 'connected');
  assert.match(s.me, /^2119000000\d\d$/);
  assert.notEqual(s.me, (await status('hzc')).me);

  assert.equal((await send(biz, '211924904216', 'Your voucher ends soon')).status, 200);
  assert.equal((await send('hzc', '211924904216', 'Router offline')).status, 200);
  assert.equal((await send(biz, '211924904210', 'x')).status, 404);
  assert.equal((await send(biz, '0924', 'x')).status, 400);
  assert.equal((await send(biz, '211924904216', ' ')).status, 400);
  assert.equal((await call(`/wa/${biz}/send`, { method: 'POST', body: '{bad' })).status, 400);

  const log = readFileSync(join(dir, 'log.txt'), 'utf8');
  assert.match(log, new RegExp(`^${biz}>211924904216@s\\.whatsapp\\.net\\|Your voucher ends soon$`, 'm'));
  assert.match(log, /^hzc>211924904216@s\.whatsapp\.net\|Router offline$/m);

  assert.equal((await call(`/wa/${biz}/logout`, { method: 'POST' })).status, 200);
  assert.equal((await status(biz)).state, 'none');
  assert.ok(!existsSync(join(dir, 'auth', biz)));
  assert.equal((await status('hzc')).state, 'connected');
});

test('VPS program: after a restart, saved logins start again', async () => {
  mkdirSync(join(dir, 'auth', 'shop-2'), { recursive: true });
  writeFileSync(join(dir, 'auth', 'shop-2', 'creds.json'), '{}');
  child?.kill();
  await sleep(300);
  startProgram();
  await waitUp();
  await sleep(3500);
  assert.equal((await status('hzc')).state, 'connected');
  assert.equal((await status('shop-2')).state, 'connected');
});
