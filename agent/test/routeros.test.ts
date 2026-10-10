import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { decryptSecret } from '../src/crypto.js';
import { RouterError, RouterOSClient } from '../src/routeros.js';

/** Same format the add-router Edge Function writes (WebCrypto appends the tag to the ciphertext). */
function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1:${iv.toString('base64')}:${data.toString('base64')}`;
}

describe('decryptSecret', () => {
  const key = randomBytes(32);

  it('round-trips a password', () => {
    assert.equal(decryptSecret(encrypt('Pässw0rd!#', key), key), 'Pässw0rd!#');
  });

  it('rejects a different key with a plain message', () => {
    assert.throws(() => decryptSecret(encrypt('x', key), randomBytes(32)), /ROUTER_SECRET_KEY/);
  });

  it('rejects unknown formats', () => {
    assert.throws(() => decryptSecret('plain-text', key), /unknown format/);
  });
});

describe('RouterOSClient', () => {
  let server: http.Server;
  let port = 0;
  const auth = `Basic ${Buffer.from('hzc-api:good').toString('base64')}`;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/rest/hang')) return; // never answers
      if (req.headers.authorization !== auth) {
        res.writeHead(401).end(JSON.stringify({ error: 401, message: 'Unauthorized' }));
        return;
      }
      if (req.url === '/rest/system/resource') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ version: '7.16' }));
        return;
      }
      res.writeHead(400).end(JSON.stringify({ error: 400, message: 'Bad Request', detail: 'no such command' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const client = (password: string, timeoutMs = 2000, p = port) =>
    new RouterOSClient({ name: 'Test', ip: '127.0.0.1', port: p, useHttps: false, username: 'hzc-api', password }, timeoutMs);

  it('reads JSON with basic auth', async () => {
    assert.deepEqual(await client('good').get('/system/resource'), { version: '7.16' });
  });

  it('reports a wrong password plainly', async () => {
    await assert.rejects(client('bad').get('/system/resource'), (e: unknown) => e instanceof RouterError && e.message === 'Wrong username or password');
  });

  it('passes RouterOS error details through', async () => {
    await assert.rejects(client('good').get('/nope'), /no such command/);
  });

  it('times out with "No reply from"', async () => {
    await assert.rejects(client('good', 300).get('/hang'), (e: unknown) => e instanceof RouterError && e.kind === 'timeout' && /No reply from 127\.0\.0\.1/.test(e.message));
  });

  it('explains a refused connection', async () => {
    // Grab a free port, then close it so nothing is listening there.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await assert.rejects(client('good', 1000, closedPort).get('/system/resource'), (e: unknown) => e instanceof RouterError && e.kind === 'refused');
  });
});
