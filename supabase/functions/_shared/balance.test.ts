import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceOf, cleanCardCode, isStarted, type CardRow } from './balance.ts';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const card = (over: Partial<CardRow> = {}): CardRow => ({
  code: '1234567',
  status: 'active',
  first_used_at: '2026-10-31T10:00:00Z',
  expires_at: null,
  uptime_used_seconds: 1800,
  bytes_used: 0,
  plans: { name: '1 hour', uptime_seconds: 3600, data_limit_mb: null },
  ...over,
});

test('cleanCardCode: spaces removed, letters and digits only', () => {
  assert.equal(cleanCardCode(' 4281 242 '), '4281242');
  assert.equal(cleanCardCode('ab12'), 'ab12');
  assert.equal(cleanCardCode('123'), null);
  assert.equal(cleanCardCode('12345678901234567890123'), null);
  assert.equal(cleanCardCode("1234'; drop"), null);
  assert.equal(cleanCardCode(1234567), null);
});

test('a card never used is never described', () => {
  assert.equal(isStarted(card({ status: 'unused', first_used_at: null })), false);
  assert.equal(isStarted(card({ status: 'sold', first_used_at: null })), false, 'sold but not yet used is not shown either');
  assert.equal(isStarted(card({ status: 'disabled' })), false, 'a voided card is not shown');
  assert.equal(isStarted(card()), true);
  assert.equal(isStarted(card({ status: 'expired', first_used_at: null })), true);
});

test('balance: time left, data left, finished', () => {
  const b = balanceOf(card(), NOW);
  assert.deepEqual([b.state, b.seconds_left, b.mb_left], ['active', 1800, null]);
  assert.equal(balanceOf(card({ uptime_used_seconds: 3600 }), NOW).state, 'finished');
  assert.equal(balanceOf(card({ uptime_used_seconds: 9999 }), NOW).seconds_left, 0, 'never negative');
  const data = card({ plans: { name: '1 GB', uptime_seconds: null, data_limit_mb: 1024 }, bytes_used: 300 * 1_048_576 });
  const d = balanceOf(data, NOW);
  assert.deepEqual([d.state, d.seconds_left, d.mb_left], ['active', null, 724]);
  assert.equal(balanceOf(card({ expires_at: '2026-10-31T11:00:00Z' }), NOW).state, 'finished', 'use-within period over');
  assert.equal(balanceOf(card({ expires_at: '2026-11-02T11:00:00Z' }), NOW).state, 'active');
  assert.equal(balanceOf(card({ status: 'expired' }), NOW).state, 'finished');
});
