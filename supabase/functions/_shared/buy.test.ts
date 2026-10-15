// Run with: node --test supabase/functions/_shared/buy.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanPhone, cleanTxnRef, providerLabel } from './buy.ts';

test('phone numbers and transaction IDs as customers type them', () => {
  assert.equal(cleanPhone(' 092 123-4567 '), '0921234567');
  assert.equal(cleanPhone('+211 (921) 234 567'), '+211921234567');
  assert.equal(cleanPhone('12ab'), null);
  assert.equal(cleanTxnRef(' mp2410.1234 '), 'MP2410.1234');
  assert.equal(cleanTxnRef('a b c d 1'), 'ABCD1');
  assert.equal(cleanTxnRef('x%_'), null);
  assert.equal(cleanTxnRef('abc'), null, 'too short');
  assert.equal(providerLabel('mtn_momo'), 'MTN MoMo');
});
