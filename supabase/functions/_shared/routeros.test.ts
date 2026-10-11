// Run with: node --test supabase/functions/_shared/routeros.test.ts   (Node 22.18+)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectorSource,
  disableBlock,
  disconnectBlock,
  END_MARKER,
  fromRouterOsTime,
  kickBlock,
  parseReport,
  profileCommands,
  pushBlock,
  removeBlock,
  rosStr,
  scriptBuilder,
  setupScript,
  syncProfilesBlock,
  testBlock,
  toRouterOsTime,
  usageBlock,
} from './routeros.ts';

const JOB = '11111111-2222-4333-8444-555555555555';
const V1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TOKEN = 'ab'.repeat(32);

/** Reads a RouterOS string literal starting at s[i] === '"'; returns [value, index after the closing quote]. */
function readString(s: string, i: number): [string, number] {
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[++j];
      out += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n;
    } else if (c === '"') {
      return [out, j + 1];
    } else {
      out += c;
    }
  }
  throw new Error(`Unterminated string at ${i}`);
}

/** Checks quotes and (), [], {} are balanced outside string literals and comments, and no bare $ hides in a string. */
function assertBalanced(script: string): void {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const line of script.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    let i = 0;
    while (i < line.length) {
      const c = line[i] as string;
      if (c === '"') {
        const end = readString(line, i)[1];
        const literal = line.slice(i, end);
        assert.ok(!/(^|[^\\])\$/.test(literal), `unescaped $ in ${literal}`);
        i = end;
        continue;
      }
      if ('([{'.includes(c)) stack.push(c);
      if (c in pairs) assert.equal(stack.pop(), pairs[c], `unbalanced ${c} in: ${line}`);
      i++;
    }
  }
  assert.deepEqual(stack, [], 'unclosed brackets');
}

test('rosStr escapes RouterOS specials and round-trips', () => {
  const nasty = 'a"b\\c$d?e\nf';
  const q = rosStr(nasty);
  assert.equal(q, '"a\\"b\\\\c\\$d\\?e\\nf"');
  assert.equal(readString(q, 0)[0], nasty);
});

test('time conversion both ways', () => {
  assert.equal(toRouterOsTime(9000), '2h30m');
  assert.equal(toRouterOsTime(604800 + 3661), '1w1h1m1s');
  assert.throws(() => toRouterOsTime(0));
  assert.equal(fromRouterOsTime('00:05:12'), 312);
  assert.equal(fromRouterOsTime('1d02:03:04'), 93784);
  assert.equal(fromRouterOsTime('1w2d03:04:05'), 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(fromRouterOsTime('2h30m'), 9000);
  assert.equal(fromRouterOsTime(''), 0);
});

test('setup script embeds the connector as one escaped string that decodes back exactly', () => {
  const script = setupScript({ routerName: 'Home "office"', gatewayUrl: 'https://x.supabase.co/functions/v1/router-gateway', token: TOKEN });
  assertBalanced(script);
  const line = script.split('\n').find((l) => l.startsWith('/system script add'));
  assert.ok(line);
  const start = line.indexOf('source="') + 'source='.length;
  const [source, end] = readString(line, start);
  assert.equal(end, line.length, 'source is the last argument');
  assert.equal(source, connectorSource('https://x.supabase.co/functions/v1/router-gateway', TOKEN));
  assert.ok(source.includes(TOKEN));
  assert.ok(source.includes(END_MARKER));
  assertBalanced(source);
  assert.ok(script.includes('interval=30s'));
});

test('parseReport reads acks and a complete usage report', () => {
  const r = parseReport(
    [
      'H|1',
      'I|hAP ax2|7.19.6 (stable)|Home|1d02:00:00',
      'A|12345678|AA:BB:CC:DD:EE:FF|10.5.50.9|00:10:00|1000|2000',
      `U|hzc:${V1}|00:30:00|500|700`,
      'U|some other comment|00:30:00|1|1',
      'UE',
      `T|${JOB}|1|hotspot1,|hotzonex.wifi|hAP ax2|7.19.6 (stable)|1d02:00:00`,
      `P|${JOB}|${V1}|added`,
      `J|${JOB}|ok|1,2`,
      `R|${V1}`,
      'E|usage report failed',
      'garbage line',
    ].join('\n'),
  );
  assert.equal(r.connectorVersion, '1');
  assert.equal(r.info?.version, '7.19.6 (stable)');
  assert.deepEqual(r.usage?.sessions, [{ code: '12345678', mac: 'AA:BB:CC:DD:EE:FF', ip: '10.5.50.9', uptime: 600, bytes_in: 1000, bytes_out: 2000 }]);
  assert.deepEqual(r.usage?.users, [{ voucher_id: V1, uptime: 1800, bytes: 1200 }]);
  assert.equal(r.tests[0]?.found, true);
  assert.deepEqual(r.tests[0]?.servers, ['hotspot1']);
  assert.equal(r.tests[0]?.dns, 'hotzonex.wifi');
  assert.deepEqual(r.pushes, [{ job: JOB, voucher: V1, result: 'added' }]);
  assert.deepEqual(r.jobs, [{ job: JOB, ok: true, detail: '1,2' }]);
  assert.deepEqual(r.removed, [V1]);
  assert.deepEqual(r.errors, ['usage report failed']);
});

test('a re-sent older usage report is replaced by the newest one', () => {
  const r = parseReport(
    ['I|b|v|n|u', 'A|111|AA|10.0.0.2|00:01:00|1|1', 'UE', 'I|b|v|n|u', 'A|222|BB|10.0.0.3|00:02:00|1|1', 'A|222|BB|10.0.0.3|00:02:00|1|1', 'UE'].join('\n'),
  );
  assert.deepEqual(
    r.usage?.sessions.map((x) => x.code),
    ['222'],
  );
});

test('usage without the end marker is ignored (an incomplete list must not clear online users)', () => {
  const r = parseReport('H|1\nA|12345678|AA|10.0.0.2|00:01:00|1|1\n');
  assert.equal(r.usage, null);
});

test('every command block is balanced and builder ends with the marker', () => {
  const profile = { name: 'hzc-1h', rateLimit: '2M/4M', sharedUsers: 1 };
  const blocks = [
    usageBlock(),
    testBlock(JOB, 'hotspot1'),
    profileCommands({ name: 'p', rateLimit: null, sharedUsers: 2 }),
    syncProfilesBlock(JOB, [profile]),
    pushBlock({
      jobId: JOB,
      profile,
      server: 'hotspot1',
      limitUptime: '1h',
      limitBytes: null,
      vouchers: [
        { id: V1, code: '12345678' },
        { id: JOB, code: '87654321' },
      ],
    }),
    disableBlock(JOB, V1, '12345678'),
    disconnectBlock(JOB, '12345678', 'aa:bb:cc:dd:ee:ff'),
    kickBlock(['12345678']),
    removeBlock([{ id: V1, code: '12345678' }]),
  ];
  for (const b of blocks) assertBalanced(b);

  const sb = scriptBuilder();
  for (const b of blocks) sb.add(b);
  sb.more();
  const script = sb.build();
  assertBalanced(script);
  assert.ok(script.startsWith(':global hzcOut\n:global hzcMore\n'));
  assert.ok(script.trimEnd().endsWith(`:set hzcMore true\n${END_MARKER}`));
});

test('setup script changes no system settings', () => {
  const script = setupScript({ routerName: 'R', gatewayUrl: 'https://x/functions/v1/router-gateway', token: TOKEN });
  assert.ok(!script.includes('/certificate'));
  const commands = script.split('\n').filter((l) => l.startsWith('/'));
  assert.ok(commands.every((l) => /^\/system (script|scheduler) (add|remove|run)/.test(l)), commands.join('\n'));
});

test('plan profiles are only added when missing, never changed', () => {
  const cmds = profileCommands({ name: 'hzc-1h', rateLimit: '2M/2M', sharedUsers: 1 });
  assert.ok(cmds.includes('profile add'));
  assert.ok(!/ set /.test(cmds));
});

test('test report carries a read-only snapshot of the router hotspot setup', () => {
  const r = parseReport(
    [
      'HS|hotspot1|bridge-hotspot|hsprof1|hs-pool|false',
      'HP|hsprof1|hotzonex.wifi|http-chap;cookie',
      'UP|default||1',
      'UP|1hour|2M/2M|1',
      'HC|25|3',
      `T|${JOB}|1|hotspot1,|hotzonex.wifi|hAP|7.19|1d`,
    ].join('\n'),
  );
  assert.deepEqual(r.hotspot?.servers, [{ name: 'hotspot1', interface: 'bridge-hotspot', profile: 'hsprof1', address_pool: 'hs-pool', disabled: false }]);
  assert.deepEqual(r.hotspot?.server_profiles, [{ name: 'hsprof1', dns_name: 'hotzonex.wifi', login_by: 'http-chap;cookie' }]);
  assert.deepEqual(r.hotspot?.user_profiles.map((p) => p.name), ['default', '1hour']);
  assert.equal(r.hotspot?.users, 25);
  assert.equal(r.hotspot?.active, 3);
});

test('push block calls the helper once per voucher with quoted values', () => {
  const block = pushBlock({
    jobId: JOB,
    profile: { name: 'hzc-1h', rateLimit: null, sharedUsers: 1 },
    server: 'hotspot1',
    limitUptime: '1h',
    limitBytes: '1048576',
    vouchers: [{ id: V1, code: '12345678' }],
  });
  assert.match(block, /\$add c="12345678" i="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" j="11111111-2222-4333-8444-555555555555" p="hzc-1h" s="hotspot1" lu="1h" lb="1048576"/);
  assert.match(block, /comment=\$t/);
});

test('disconnect with a MAC filters on the upper-case MAC', () => {
  assert.match(disconnectBlock(JOB, '1234', 'aa:bb:cc:dd:ee:ff'), /user="1234" and mac-address="AA:BB:CC:DD:EE:FF"/);
});
