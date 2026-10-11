// Run with: node --test supabase/functions/_shared/tunnel.test.ts   (Node 22.18+)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { RestClient, RouterError } from './direct.ts';
import { generateWgKeyPair, nextTunnelIp, peersConfig, relayRestUrl, tunnelSetupScript, vpsInstallScript, WG_KEY_RE } from './tunnel.ts';

test('WireGuard keys: the public key belongs to the private key (same as wg pubkey)', async () => {
  const { privateKey, publicKey } = await generateWgKeyPair();
  assert.match(privateKey, WG_KEY_RE);
  assert.match(publicKey, WG_KEY_RE);
  const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(privateKey, 'base64')]);
  const spki = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' });
  assert.equal(Buffer.from(spki.subarray(spki.length - 32)).toString('base64'), publicKey);
});

test('tunnel addresses: lowest free from 10.99.0.2, never the server address', () => {
  assert.equal(nextTunnelIp([]), '10.99.0.2');
  assert.equal(nextTunnelIp(['10.99.0.2', '10.99.0.4', null]), '10.99.0.3');
  assert.throws(() => nextTunnelIp(Array.from({ length: 253 }, (_, i) => `10.99.0.${i + 2}`)));
  assert.equal(relayRestUrl('https://1-2-3-4.sslip.io/', '10.99.0.7', 87), 'https://1-2-3-4.sslip.io/r/10.99.0.7:87/rest');
  assert.throws(() => relayRestUrl('https://x', '192.168.88.1', 80));
});

test('router script: checks the hotspot first, adds only tagged tunnel items, removes the scheduler', () => {
  const script = tunnelSetupScript({
    routerName: 'Home',
    privateKey: 'a'.repeat(43) + '=',
    tunnelIp: '10.99.0.2',
    vpsPublicKey: 'b'.repeat(43) + '=',
    endpoint: '203.0.113.5',
    wwwPort: 87,
  });
  const lines = script.split('\n');
  assert.ok(lines.findIndex((l) => l.includes('/ip hotspot find where disabled=no')) < lines.findIndex((l) => l.includes('/interface wireguard add')));
  assert.match(script, /Nothing was changed/);
  assert.match(script, /\/interface wireguard add name="wg-hzc" listen-port=51831 private-key="a{43}=" comment="hotzonex-tunnel"/);
  assert.match(script, /endpoint-address="203\.0\.113\.5" endpoint-port=51820 allowed-address=10\.99\.0\.1\/32 persistent-keepalive=25s/);
  assert.match(script, /\/ip address add address=10\.99\.0\.2\/24 interface="wg-hzc"/);
  assert.match(script, /src-address=10\.99\.0\.1 protocol=tcp dst-port=87 action=accept comment="hotzonex-tunnel" place-before=/);
  assert.match(script, /\/system scheduler remove \[find where name="hzc-cloud"\]/);
  assert.doesNotMatch(script, /scheduler add|script add|\/ip hotspot (set|add|remove)|user profile (set|add|remove)/);
  // Every line that adds something is tagged, so pasting again replaces it instead of adding twice.
  for (const l of lines.filter((x) => / add /.test(x))) assert.match(l, /comment="hotzonex-tunnel"/, l);
  const opens = (script.match(/\{/g) ?? []).length;
  assert.equal(opens, (script.match(/\}/g) ?? []).length);
});

test('VPS installer is valid bash and the relay only forwards /rest to tunnel addresses with the secret', () => {
  const sh = vpsInstallScript('https://abc.supabase.co/');
  execFileSync('bash', ['-n'], { input: sh });
  assert.match(sh, /HZC_FN="https:\/\/abc\.supabase\.co\/functions\/v1\/tunnel"/);
  assert.match(sh, /header X-Hzc-Relay \$HZC_SECRET/);
  assert.match(sh, /path_regexp hzc \^\/r\/\(10\\\.99\\\.0\\\.\[0-9\]\{1,3\}\):\(\[0-9\]\{1,5\}\)\(\/rest\(\/\.\*\)\?\)\$/);
  assert.match(sh, /Address = 10\.99\.0\.1\/24/);
  assert.doesNotMatch(sh, /net\.ipv4\.ip_forward/);
});

test('peers config skips routers without a valid key or address', () => {
  const key = 'c'.repeat(43) + '=';
  const conf = peersConfig([
    { name: 'A', tunnel_ip: '10.99.0.2', wg_public_key: key },
    { name: 'B', tunnel_ip: null, wg_public_key: key },
    { name: 'C', tunnel_ip: '10.99.0.3', wg_public_key: 'bad' },
  ]);
  assert.ok(conf.startsWith('# hzc-peers'));
  assert.equal((conf.match(/\[Peer\]/g) ?? []).length, 1);
  assert.match(conf, /PublicKey = c{43}=\nAllowedIPs = 10\.99\.0\.2\/32/);
});

test('REST client goes through the relay with its secret, and explains a disconnected router', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.url} ${req.headers['x-hzc-relay']} ${req.headers.authorization ? 'auth' : ''}`);
    if (req.url?.startsWith('/r/10.99.0.9:')) {
      res.writeHead(502);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '7.24.5' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const relay = (ip: string) => ({ baseUrl: relayRestUrl(`http://127.0.0.1:${port}`, ip, 87), secret: 's3cret' });
    const ok = new RestClient({ host: '10.99.0.2', port: 87, useHttps: false, username: 'admin', password: 'x', relay: relay('10.99.0.2') });
    assert.deepEqual(await ok.get('/system/resource'), { version: '7.24.5' });
    assert.equal(seen[0], '/r/10.99.0.2:87/rest/system/resource s3cret auth');
    const down = new RestClient({ host: '10.99.0.9', port: 87, useHttps: false, username: 'admin', password: 'x', relay: relay('10.99.0.9') });
    await assert.rejects(down.get('/system/resource'), (e: unknown) => e instanceof RouterError && e.kind === 'timeout' && /not connected to the tunnel/.test(e.message));
  } finally {
    server.close();
  }
});
