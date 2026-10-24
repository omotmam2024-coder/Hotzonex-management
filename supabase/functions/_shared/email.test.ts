// Run with: node --test supabase/functions/_shared/email.test.ts   (Node 22.18+)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FROM, sendEmail, staffWelcomeEmail } from './email.ts';

const base = {
  to: 'amani@example.com',
  name: 'Amani',
  business: 'Juba <WiFi> & Co',
  role: 'seller' as const,
  loginUrl: 'https://hotzonex.net/login',
  passwordUrl: 'https://example.supabase.co/auth/v1/verify?token=abc&type=recovery',
};

test('welcome email: business, role, login address and password link; names are escaped', () => {
  const e = staffWelcomeEmail({ ...base, lang: 'en' });
  assert.equal(e.subject, 'Welcome to Juba <WiFi> & Co on Hotzonex Cloud');
  assert.match(e.html, /Juba &#60;WiFi&#62; &#38; Co/);
  assert.doesNotMatch(e.html, /<WiFi>/);
  assert.match(e.html, /Cashier \/ agent/);
  assert.match(e.html, /href="https:\/\/hotzonex.net\/login"/);
  assert.match(e.html, /token=abc&#38;type=recovery/);
  assert.match(e.text, /Choose your own password: https:\/\/example.supabase.co/);
  assert.doesNotMatch(e.text + e.html, /password: [^ ]*secret/i);
});

test('welcome email: Arabic is right to left, Kiswahili has its own words', () => {
  assert.match(staffWelcomeEmail({ ...base, lang: 'ar' }).html, /dir="rtl"/);
  assert.match(staffWelcomeEmail({ ...base, lang: 'sw' }).subject, /^Karibu Juba/);
});

test('welcome email without a password link still says where to log in', () => {
  const e = staffWelcomeEmail({ ...base, lang: 'en', passwordUrl: null });
  assert.doesNotMatch(e.text, /Choose your own password/);
  assert.match(e.text, /https:\/\/hotzonex.net\/login/);
});

test('sendEmail: posts to Resend with the key, sender and idempotency key', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
  }) as typeof fetch;
  const problem = await sendEmail(staffWelcomeEmail({ ...base, lang: 'en' }), { apiKey: 're_test', idempotencyKey: 'welcome:1', http });
  assert.equal(problem, null);
  assert.equal(seen!.url, 'https://api.resend.com/emails');
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer re_test');
  assert.equal(headers['Idempotency-Key'], 'welcome:1');
  const body = JSON.parse(String(seen!.init.body)) as { from: string; to: string[] };
  assert.equal(body.from, DEFAULT_FROM);
  assert.deepEqual(body.to, ['amani@example.com']);
});

test('sendEmail never throws: no key, refused, unreachable', async () => {
  const email = staffWelcomeEmail({ ...base, lang: 'en' });
  assert.match((await sendEmail(email, { apiKey: undefined })) ?? '', /RESEND_API_KEY/);
  const refused = (async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 })) as typeof fetch;
  assert.match((await sendEmail(email, { apiKey: 'k', http: refused })) ?? '', /HTTP 403: Domain not verified/);
  const down = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  assert.match((await sendEmail(email, { apiKey: 'k', http: down })) ?? '', /could not be reached/);
});
