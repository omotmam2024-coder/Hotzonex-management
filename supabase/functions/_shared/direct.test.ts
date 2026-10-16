// Run with: node --test supabase/functions/_shared/direct.test.ts   (Node 22.18+)
// A small fake RouterOS REST API checks the direct-connection client and job helpers.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { closeSessions, directTest, removeLeftoverProfiles, disableVoucher, ensureProfileExists, installPortalDirect, pushVoucher, readUsage, removeExpired, removeProfileIfUnused, removeVoucherUsers, restorePortalDirect, upsertManagedProfile, RestClient, RouterError, matchRouterProfile, readRouterUsers, expiredRouterUsers, mikroticketSeconds, routerClockText, setWalledGarden } from './direct.ts';

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
      if (body.name !== undefined && rows.some((r) => r.name === body.name)) return send(400, { error: 400, message: 'Bad Request', detail: 'failure: already have user with this name' });
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
  const names = (await readRouterUsers(c)).comments;
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, names), 'added');
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, names), 'already');
  assert.equal(await pushVoucher(c, { id: V, code: '12345678' }, opts, (await readRouterUsers(c)).comments), 'already');
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

test('profiles Hotzonex added earlier are removed only when no plan and no user needs them', async () => {
  reset();
  state['/ip/hotspot/user/profile'] = [
    { '.id': '*1', name: 'default' },
    { '.id': '*2', name: 'profile_1Hr-se:-co:1000' },
    { '.id': '*3', name: 'hzc-2h' },
    { '.id': '*4', name: 'hzc-1d' },
    { '.id': '*5', name: 'hzc-1w' },
  ];
  state['/ip/hotspot/user'] = [{ '.id': '*A', name: '11112222', profile: 'hzc-1d', comment: 'my own user', uptime: '0s' }];
  const removed = await removeLeftoverProfiles(client(), new Set(['hzc-1w']));
  assert.deepEqual(removed, ['hzc-2h']);
  assert.deepEqual(state['/ip/hotspot/user/profile']!.map((p) => p.name), ['default', 'profile_1Hr-se:-co:1000', 'hzc-1d', 'hzc-1w']);
  const usage = await readUsage(client());
  assert.deepEqual(usage.userProfiles.map((p) => p.name), ['default', 'profile_1Hr-se:-co:1000', 'hzc-1d', 'hzc-1w']);
});

test('vouchers deleted in Hotzonex leave the router; profiles go only while no user is on them', async () => {
  reset();
  const W = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  state['/ip/hotspot/user']!.push(
    { '.id': '*B', name: '12345678', profile: 'mine', comment: `hzc:${V}` },
    { '.id': '*C', name: '87654321', profile: 'mine', comment: 'someone else' },
  );
  state['/ip/hotspot/active']!.push({ '.id': '*D', user: '12345678', 'mac-address': 'AA:BB:CC:DD:EE:FF' });
  // Tagged user removed (its session closed first); same code with another tag left alone; gone one counts as done.
  assert.equal(await removeVoucherUsers(client(), [{ id: V, code: '12345678' }, { id: W, code: '87654321' }, { id: W, code: '00000000' }]), 1);
  assert.deepEqual(state['/ip/hotspot/user']!.map((u) => u.name), ['11112222', '87654321']);
  assert.equal(state['/ip/hotspot/active']!.length, 0);

  assert.deepEqual(await removeProfileIfUnused(client(), 'mine'), { removed: false, users: 1 });
  assert.ok(state['/ip/hotspot/user/profile']!.some((p) => p.name === 'mine'), 'kept while a user is on it');
  state['/ip/hotspot/user'] = state['/ip/hotspot/user']!.filter((u) => u.profile !== 'mine');
  assert.deepEqual(await removeProfileIfUnused(client(), 'mine'), { removed: true, users: 0 });
  assert.deepEqual(state['/ip/hotspot/user/profile']!.map((p) => p.name), ['default']);
  assert.deepEqual(await removeProfileIfUnused(client(), 'mine'), { removed: false, users: 0 }, 'already gone');
});

test('cards are made like the router\'s own vouchers: its matching profile and its password style', async () => {
  reset();
  const c = client();
  // MikroTicket PINs: no password.
  state['/ip/hotspot/user'] = ['0001', '0002', '0003', '0004'].map((n, i) => ({ '.id': `*${i + 1}`, name: n, password: '', comment: 'Mikroticket-dc:2026-10-10' }));
  const pin = await readRouterUsers(c);
  assert.equal(pin.passwordStyle, 'empty');
  assert.deepEqual(pin.sample, { empty: 4, same: 0, readable: 4 });
  assert.equal(await pushVoucher(c, { id: V, code: '5555' }, { profile: 'p', server: 'all', limitUptime: '1h', limitBytes: null, password: pin.passwordStyle }, pin.comments), 'added');
  assert.equal(state['/ip/hotspot/user']!.find((u) => u.name === '5555')!.password, '');

  // Password = code, or passwords the router does not show: password = code.
  state['/ip/hotspot/user'] = ['0001', '0002', '0003'].map((n, i) => ({ '.id': `*${i + 1}`, name: n, password: n }));
  assert.equal((await readRouterUsers(c)).passwordStyle, 'same');
  state['/ip/hotspot/user'] = ['0001', '0002', '0003'].map((n, i) => ({ '.id': `*${i + 1}`, name: n }));
  assert.equal((await readRouterUsers(c)).passwordStyle, 'same');

  const office = [
    'default',
    'profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:2d 00:00:00',
    'Guest',
  ];
  const home1Hr = 'profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:1d 12:00:00';
  assert.equal(matchRouterProfile(home1Hr, office), office[1], 'same label and price on another router');
  assert.equal(matchRouterProfile('Guest', office), 'Guest');
  assert.equal(matchRouterProfile('profile_1Hr-se:-co:1500-pr:-ut:0d 01:00:00', office), null, 'another price is another plan');
  assert.equal(matchRouterProfile('LITE', office), null);
});

test('a profile Hotzonex manages is added, then renamed and updated with the plan; users stay on it', async () => {
  reset();
  const c = client();
  const first = 'profile_6Hrs-se:-co:3500-pr:-lu:7-lp:7-ut:0d 06:00:00-bt:-kt:true-nu:true-np:true-tp:2';
  assert.equal(await upsertManagedProfile(c, { name: first, previousName: first, rateLimit: '5M/5M', sharedUsers: 1 }), 'added');
  assert.equal(await upsertManagedProfile(c, { name: first, previousName: first, rateLimit: '5M/5M', sharedUsers: 1 }), 'unchanged');
  const added = state['/ip/hotspot/user/profile']!.find((p) => p.name === first)!;
  state['/ip/hotspot/user']!.push({ '.id': '*U', name: '0001', profile: first });
  const second = first.replace('co:3500', 'co:4000');
  assert.equal(await upsertManagedProfile(c, { name: second, previousName: first, rateLimit: '10M/10M', sharedUsers: 2 }), 'updated');
  assert.equal(added.name, second, 'the same profile, renamed');
  assert.equal(added['rate-limit'], '10M/10M');
  assert.equal(added['shared-users'], '2');
  assert.ok(!state['/ip/hotspot/user/profile']!.some((p) => p.name === first));
});

test('expired MikroTicket cards: time used up or validity over, never online ones, vouchers or staff users', () => {
  const p1h = 'profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:2d 00:00:00';
  const base = { profile: p1h, limitUptime: 0, comment: '' };
  const users = [
    { ...base, id: '*1', name: 'used-up', uptime: 3600, comment: 'Mikroticket-dc:x-da:2026-10-15 08:00:00' },
    { ...base, id: '*2', name: 'half', uptime: 1800, comment: 'Mikroticket-dc:x-da:2026-10-15 08:00:00' },
    { ...base, id: '*3', name: 'validity-over', uptime: 600, comment: 'Mikroticket-dc:x-da:2026-10-13 09:00:00' },
    { ...base, id: '*4', name: 'online', uptime: 3600 },
    { ...base, id: '*5', name: 'unused', uptime: 0 },
    { ...base, id: '*6', name: 'voucher', uptime: 9999, comment: 'hzc:3f2b2a4e-0000-4000-8000-000000000000' },
    { ...base, id: '*7', name: 'staff', profile: 'Guest', uptime: 99999 },
    { ...base, id: '*8', name: 'own-limit', uptime: 1300, limitUptime: 1200 },
  ];
  const real = Date.parse('2026-10-15T08:00:00Z'); // 10:00 in Juba
  const out = expiredRouterUsers(users, new Set(['online']), '2026-10-15 10:00:00', real).map((u) => u.name);
  assert.deepEqual(out, ['used-up', 'validity-over', 'own-limit']);
  assert.deepEqual(expiredRouterUsers(users, new Set(['online']), null).map((u) => u.name), ['used-up', 'own-limit'], 'no router clock: only used-up time');
});

test('expired MikroTicket cards: a wrong router clock never ends a card early', () => {
  const p1h = 'profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:2d 00:00:00';
  const base = { profile: p1h, limitUptime: 0, uptime: 600 };
  const real = Date.parse('2026-10-15T08:00:00Z');
  // Stamped in 1970 after a power cut, read once the clock synced: the card just started.
  const reset = [{ ...base, id: '*1', name: 'after-power-cut', comment: 'Mikroticket-dc:x-da:1970-01-01 00:00:12' }];
  assert.deepEqual(expiredRouterUsers(reset, new Set(), '2026-10-15 10:00:00', real), []);
  // The clock itself still in 2000: validity is not judged, used-up time still is.
  const users = [
    { ...base, id: '*2', name: 'old-stamp', comment: 'Mikroticket-dc:x-da:2026-10-10 09:00:00' },
    { ...base, id: '*3', name: 'used-up', uptime: 3600, comment: '' },
  ];
  assert.deepEqual(expiredRouterUsers(users, new Set(), '2000-01-01 00:05:00', real).map((u) => u.name), ['used-up']);
  // A stamp in the future (clock was ahead) is not trusted either.
  const ahead = [{ ...base, id: '*4', name: 'ahead', comment: 'Mikroticket-dc:x-da:2027-01-01 00:00:00' }];
  assert.deepEqual(expiredRouterUsers(ahead, new Set(), '2026-10-15 10:00:00', real), []);
});

test('router clock text from new and old RouterOS dates', () => {
  assert.equal(routerClockText({ date: '2026-10-15', time: '19:03:07' }), '2026-10-15 19:03:07');
  assert.equal(routerClockText({ date: 'oct/15/2026', time: '19:03:07' }), '2026-10-15 19:03:07');
  assert.equal(routerClockText({}), null);
  assert.equal(mikroticketSeconds('profile_x-ut:0d 01:00:00-vl:1d 12:00:00', 'vl'), 129600);
});

test('Buy page walled garden: Hotzonex entries replaced, the owner\'s own entries kept, removed when switched off', async () => {
  reset();
  state['/ip/hotspot/walled-garden'] = [{ '.id': '*1', 'dst-host': 'mybank.example', action: 'allow', comment: 'owner' }, { '.id': '*2', 'dst-host': 'old.example', action: 'allow', comment: 'hzc-buy' }];
  state['/ip/hotspot/walled-garden/ip'] = [];
  const c = client();
  assert.deepEqual(await setWalledGarden(c, ['app.hotzonex.net', 'x.supabase.co'], true), { removed: 1, added: 2 });
  assert.deepEqual(state['/ip/hotspot/walled-garden']!.map((r) => r['dst-host']), ['mybank.example', 'app.hotzonex.net', 'x.supabase.co']);
  assert.deepEqual(state['/ip/hotspot/walled-garden/ip']!.map((r) => [r['dst-host'], r.action]), [['app.hotzonex.net', 'accept'], ['x.supabase.co', 'accept']]);
  assert.deepEqual(await setWalledGarden(c, [], false), { removed: 4, added: 0 });
  assert.deepEqual(state['/ip/hotspot/walled-garden']!.map((r) => r.comment), ['owner']);
});
