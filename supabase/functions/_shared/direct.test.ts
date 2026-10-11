// Run with: node --test supabase/functions/_shared/direct.test.ts   (Node 22.18+)
// A small fake RouterOS REST API checks the direct-connection client and job helpers.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { closeSessions, directTest, disableVoucher, ensureProfileExists, pushVoucher, readUsage, removeExpired, RestClient, RouterError, userComments } from './direct.ts';

type Row = Record<string, string>;
const state: Record<string, Row[]> = {};
const writes: string[] = [];
let port = 0;

function reset() {
  state['/ip/hotspot'] = [{ '.id': '*1', name: 'hotspot1', interface: 'bridge', profile: 'hsprof1', 'address-pool': 'pool', disabled: 'false' }];
  state['/ip/hotspot/profile'] = [{ '.id': '*1', name: 'hsprof1', 'dns-name': 'hotzonex.wifi', 'login-by': 'http-chap,cookie' }];
  state['/ip/hotspot/user/profile'] = [{ '.id': '*1', name: 'default', 'shared-users': '1' }, { '.id': '*2', name: 'mine', 'rate-limit': '1M/1M', 'shared-users': '2' }];
  state['/ip/hotspot/user'] = [{ '.id': '*A', name: '11112222', comment: 'my own user', uptime: '0s', 'bytes-in': '0', 'bytes-out': '0' }];
  state['/ip/hotspot/active'] = [];
  writes.length = 0;
}

function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.headers.authorization !== `Basic ${Buffer.from('admin:secret').toString('base64')}`) return send(401, { error: 401, message: 'Unauthorized' });
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname.replace(/^\/rest/, '');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (path === '/system/resource') return send(200, { 'board-name': 'hAP ax2', version: '7.19.6 (stable)', uptime: '1d2h' });
    const idMatch = /^(.*)\/(\*[0-9A-Z]+)$/.exec(path);
    const table = idMatch ? idMatch[1]! : path;
    const rows = state[table];
    if (!rows) return send(404, { error: 404, message: 'Not Found' });
    if (req.method === 'GET') {
      const filters = [...url.searchParams].filter(([k]) => !k.startsWith('.'));
      return send(200, rows.filter((r) => filters.every(([k, v]) => r[k] === v)));
    }
    writes.push(`${req.method} ${path}`);
    if (req.method === 'PUT') {
      const body = JSON.parse(raw) as Row;
      if (rows.some((r) => r.name === body.name)) return send(400, { error: 400, message: 'Bad Request', detail: 'failure: already have user with this name' });
      rows.push({ '.id': `*${rows.length + 10}`, ...body });
      return send(201, body);
    }
    const i = rows.findIndex((r) => r['.id'] === idMatch?.[2]);
    if (i < 0) return send(404, { error: 404, message: 'Not Found' });
    if (req.method === 'PATCH') Object.assign(rows[i]!, JSON.parse(raw));
    if (req.method === 'DELETE') rows.splice(i, 1);
    return send(200, {});
  });
}

const server = createServer(handler);
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
after(() => server.close());

const client = (password = 'secret') => new RestClient({ host: '127.0.0.1', port, useHttps: false, username: 'admin', password }, 3000);
const V = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('wrong password gives a plain error', async () => {
  reset();
  await assert.rejects(client('nope').get('/system/resource'), (e: unknown) => e instanceof RouterError && e.kind === 'auth');
});

test('connection test reads the hotspot setup without writing anything', async () => {
  reset();
  const t = await directTest(client(), 'hotspot1');
  assert.equal(t.found, true);
  assert.equal(t.dns, 'hotzonex.wifi');
  assert.equal(t.version, '7.19.6 (stable)');
  assert.deepEqual(t.hotspot.user_profiles.map((p) => p.name), ['default', 'mine']);
  assert.equal(t.hotspot.users, 1);
  assert.deepEqual(writes, []);
  assert.equal((await directTest(client(), 'HOTZONEX-WIFI')).found, false);
});

test('existing profiles are left alone; missing ones are added', async () => {
  reset();
  assert.equal(await ensureProfileExists(client(), { name: 'mine', rateLimit: '9M/9M', sharedUsers: 5 }), false);
  assert.equal(state['/ip/hotspot/user/profile']![1]!['rate-limit'], '1M/1M');
  assert.equal(await ensureProfileExists(client(), { name: 'hzc-1h', rateLimit: '2M/2M', sharedUsers: 1 }), true);
  assert.deepEqual(writes, ['PUT /ip/hotspot/user/profile']);
});

test('voucher push is idempotent and never touches a user it does not own', async () => {
  reset();
  const c = client();
  const opts = { profile: 'mine', server: 'hotspot1', limitUptime: '1h', limitBytes: null };
  const names = await userComments(c);
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, names), 'added');
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, names), 'already');
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, await userComments(c)), 'already');
  assert.equal(await pushVoucher(c, { id: V, code: '11112222' }, opts, names), 'conflict');
  assert.equal(state['/ip/hotspot/user']!.find((u) => u.name === '11112222')!.comment, 'my own user');
  assert.equal(state['/ip/hotspot/user']!.find((u) => u.name === '12345678')!.comment, `hzc:${V}`);
});

test('disable, usage, disconnect and removal only act on tagged users', async () => {
  reset();
  const c = client();
  state['/ip/hotspot/user']!.push({ '.id': '*B', name: '12345678', comment: `hzc:${V}`, uptime: '10m', 'bytes-in': '5', 'bytes-out': '7', disabled: 'false' });
  state['/ip/hotspot/active']!.push({ '.id': '*C', user: '12345678', 'mac-address': 'AA:BB:CC:DD:EE:FF', address: '10.5.50.9', uptime: '00:10:00', 'bytes-in': '5', 'bytes-out': '7' });

  const usage = await readUsage(c);
  assert.deepEqual(usage.users, [{ voucher_id: V, uptime: 600, bytes: 12 }]);
  assert.equal(usage.sessions[0]?.code, '12345678');

  assert.equal(await removeExpired(c, { id: V, code: '12345678' }), false, 'online users are not removed');
  assert.deepEqual(await disableVoucher(c, V, '12345678'), { disabled: true, sessions: 1 });
  assert.equal(state['/ip/hotspot/user']!.find((u) => u.name === '12345678')!.disabled, 'yes');
  assert.equal(await closeSessions(c, '12345678', null), 0);
  assert.equal(await removeExpired(c, { id: V, code: '12345678' }), true);
  assert.equal(await removeExpired(c, { id: V, code: '11112222' }), true, 'nothing to do for an untagged user');
  assert.ok(state['/ip/hotspot/user']!.some((u) => u.name === '11112222'), 'own user kept');
  assert.ok(!state['/ip/hotspot/user']!.some((u) => u.name === '12345678'));
});
