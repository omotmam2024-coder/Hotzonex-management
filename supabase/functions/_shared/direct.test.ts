// Run with: node --test supabase/functions/_shared/direct.test.ts   (Node 22.18+)
// A small fake RouterOS REST API checks the direct-connection client and job helpers.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { closeSessions, directTest, disableVoucher, ensureProfileExists, installPortalDirect, pushVoucher, readUsage, removeExpired, restorePortalDirect, RestClient, RouterError, userComments } from './direct.ts';

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
    // Filtered reads come as JSON "print" commands, like RouterOS expects; URL query strings are not used.
    if (url.search) return send(400, { error: 400, message: 'Bad Request', detail: 'query strings are not decoded reliably' });
    if (req.method === 'POST' && path === '/tool/fetch') {
      writes.push(`FETCH ${(JSON.parse(raw) as Row)['dst-path']}`);
      return send(200, [{ status: 'finished' }]);
    }
    if (req.method === 'POST' && path.endsWith('/set')) {
      const rows = state[path.slice(0, -'/set'.length)] ?? [];
      const body = JSON.parse(raw) as Row;
      const key = body.numbers ?? body['.id'];
      const row = rows.find((r) => r.name === key || r['.id'] === key);
      if (!row) return send(400, { error: 400, message: 'Bad Request', detail: 'no such item' });
      const { numbers: _n, '.id': _i, ...changes } = body;
      Object.assign(row, changes);
      writes.push(`SET ${path} ${JSON.stringify(changes)}`);
      return send(200, []);
    }
    if (req.method === 'POST' && path.endsWith('/remove')) {
      const rows = state[path.slice(0, -'/remove'.length)] ?? [];
      const ids = String((JSON.parse(raw) as Row)['.id'] ?? '').split(',');
      if (ids.some((id) => !rows.some((r) => r['.id'] === id))) return send(400, { error: 400, message: 'Bad Request', detail: 'no such item' });
      for (const id of ids) rows.splice(rows.findIndex((r) => r['.id'] === id), 1);
      writes.push(`REMOVE ${path} ${ids.join(',')}`);
      return send(200, []);
    }
    if (req.method === 'POST' && path.endsWith('/print')) {
      const rows = state[path.slice(0, -'/print'.length)];
      if (!rows) return send(404, { error: 404, message: 'Not Found' });
      const body = JSON.parse(raw || '{}') as { '.query'?: string[]; '.proplist'?: string[] };
      const words = (body['.query'] ?? []).map((w) => [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)] as const);
      const picked = rows.filter((r) => words.every(([k, v]) => r[k] === v));
      const props = body['.proplist'];
      return send(200, props ? picked.map((r) => Object.fromEntries(props.filter((k) => k in r).map((k) => [k, r[k]]))) : picked);
    }
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
    // Ids in URL paths are not used: RouterOS does not decode them reliably.
    return send(400, { error: 400, message: 'Bad Request', detail: 'missing or invalid resource identifier' });
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
  const t = await directTest(client());
  assert.equal(t.hotspot.servers[0]?.name, 'hotspot1');
  assert.equal(t.hotspot.server_profiles[0]?.dns_name, 'hotzonex.wifi');
  assert.equal(t.version, '7.19.6 (stable)');
  assert.deepEqual(t.hotspot.user_profiles.map((p) => p.name), ['default', 'mine']);
  assert.equal(t.hotspot.users, 1);
  assert.deepEqual(writes, []);
});

test('existing profiles are left alone; missing ones are added', async () => {
  reset();
  assert.equal(await ensureProfileExists(client(), { name: 'mine', rateLimit: '9M/9M', sharedUsers: 5 }), false);
  assert.equal(state['/ip/hotspot/user/profile']![1]!['rate-limit'], '1M/1M');
  assert.equal(await ensureProfileExists(client(), { name: 'hzc-1h', rateLimit: '2M/2M', sharedUsers: 1 }), true);
  assert.deepEqual(writes, ['PUT /ip/hotspot/user/profile']);
  // MikroTicket names have spaces and colons; they are found, never added twice.
  const mt = 'profile_1Hr-se:-co:1000-ut:0d 01:00:00-vl:1d 12:00:00';
  state['/ip/hotspot/user/profile']!.push({ '.id': '*9', name: mt, 'shared-users': '1' });
  assert.equal(await ensureProfileExists(client(), { name: mt, rateLimit: null, sharedUsers: 1 }), false);
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
  // Every hotspot user is listed for the user counts and router-login sales, MikroTicket ones too.
  assert.deepEqual(usage.allUsers.map((u) => [u.name, u.uptime]), [['11112222', 0], ['12345678', 600]]);

  assert.equal(await removeExpired(c, { id: V, code: '12345678' }), false, 'online users are not removed');
  assert.deepEqual(await disableVoucher(c, V, '12345678'), { disabled: true, sessions: 1 });
  assert.equal(state['/ip/hotspot/user']!.find((u) => u.name === '12345678')!.disabled, 'yes');
  assert.equal(await closeSessions(c, '12345678', null), 0);
  assert.equal(await removeExpired(c, { id: V, code: '12345678' }), true);
  assert.equal(await removeExpired(c, { id: V, code: '11112222' }), true, 'nothing to do for an untagged user');
  assert.ok(state['/ip/hotspot/user']!.some((u) => u.name === '11112222'), 'own user kept');
  assert.ok(!state['/ip/hotspot/user']!.some((u) => u.name === '12345678'));
});

test('portal install downloads every page first, then switches the profile by name; switch back restores', async () => {
  reset();
  state['/ip/hotspot/profile']![0]!['html-directory'] = 'flash/hotspot';
  const r = await installPortalDirect(client(), 'hsprof1', 'https://x/portal?r=1', ['login.html', 'md5.js']);
  assert.deepEqual(r, { current: 'flash/hotspot', dir: 'flash/hotzonex' });
  assert.deepEqual(writes, ['FETCH flash/hotzonex/login.html', 'FETCH flash/hotzonex/md5.js', 'SET /ip/hotspot/profile/set {"html-directory":"flash/hotzonex"}']);
  await restorePortalDirect(client(), 'hsprof1', 'flash/hotspot');
  assert.equal(state['/ip/hotspot/profile']![0]!['html-directory'], 'flash/hotspot');
  await assert.rejects(installPortalDirect(client(), 'nope', 'https://x', ['login.html']), /was not found/);
});
