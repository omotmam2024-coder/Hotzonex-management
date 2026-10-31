import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newReferralCode, REFERRAL_MAX_USES } from './referral.ts';

test('referral codes look like R-XXXXXXXX, fit the promo code format, and differ', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = newReferralCode();
    assert.match(c, /^R-[0-9A-F]{8}$/);
    assert.match(c, /^[A-Z0-9-]{3,20}$/, 'accepted by promo_codes.code');
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  assert.equal(REFERRAL_MAX_USES, 5);
});
