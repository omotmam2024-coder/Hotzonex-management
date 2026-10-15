// Run with: node --test supabase/functions/_shared/signup.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSignup } from './signup.ts';

const ok = { business_name: ' Juba  WiFi ', full_name: 'Deng Akol', email: 'Deng@Example.com', password: 'long-secret-1' };

test('sign-up form: cleaned, defaults filled in', () => {
  assert.deepEqual(checkSignup(ok), {
    businessName: 'Juba WiFi',
    fullName: 'Deng Akol',
    email: 'deng@example.com',
    password: 'long-secret-1',
    siteName: 'Main site',
    timezone: 'Africa/Juba',
  });
});

test('sign-up form: weak or wrong input refused with a plain reason', () => {
  assert.throws(() => checkSignup({ ...ok, password: 'short' }), /at least 8/);
  assert.throws(() => checkSignup({ ...ok, password: 'deng@example.com' }), /not your email/);
  assert.throws(() => checkSignup({ ...ok, password: 'my juba wifi 1' }), /business name/);
  assert.throws(() => checkSignup({ ...ok, email: 'nope' }), /valid email/);
  assert.throws(() => checkSignup({ ...ok, timezone: 'Mars/Base' }), /time zone/);
});
