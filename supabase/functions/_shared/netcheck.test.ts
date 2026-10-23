import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertPublicHost, directPort, isDnsName, isPrivateIpv4, isPrivateIpv6, sameSecret } from './netcheck.ts';

test('private and special IPv4 addresses are recognised', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '0.0.0.0', '172.16.5.4', '192.168.88.1', '169.254.169.254', '100.64.0.1', '224.0.0.1']) assert.ok(isPrivateIpv4(ip), ip);
  for (const ip of ['41.79.12.3', '8.8.8.8', '172.32.0.1']) assert.ok(!isPrivateIpv4(ip), ip);
});

test('private IPv6 addresses are recognised, including mapped IPv4', () => {
  for (const ip of ['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]']) assert.ok(isPrivateIpv6(ip), ip);
  for (const ip of ['2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.ok(!isPrivateIpv6(ip), ip);
});

test('numeric host forms that fetch reads as internal addresses are not DNS names', () => {
  for (const h of ['2130706433', '0x7f.1', '127.1', '0x7f000001']) assert.ok(!isDnsName(h), h);
  for (const h of ['router.example.com', 'abc123.sn.mynetname.net']) assert.ok(isDnsName(h), h);
});

test('assertPublicHost refuses private and numeric addresses without a lookup', async () => {
  for (const h of ['127.0.0.1', '169.254.169.254', '2852039166', '0x7f.1', 'localhost', 'x.local', '[::1]']) {
    await assert.rejects(assertPublicHost(h), h);
  }
  await assertPublicHost('41.79.12.3');
});

test('secrets compare equal only when identical', () => {
  assert.ok(sameSecret('abc', 'abc'));
  assert.ok(!sameSecret('abc', 'abd'));
  assert.ok(!sameSecret('abc', 'abcd'));
});

test('routers at a public address are logged in to over HTTPS only', () => {
  assert.equal(directPort(80), 443);
  assert.equal(directPort(443), 443);
  assert.equal(directPort(8443), 8443);
});
