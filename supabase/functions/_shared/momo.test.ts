// Run with: node --test supabase/functions/_shared/momo.test.ts   (Node 22.18+)
// A fake MTN MoMo Collections API checks the client: login, request to pay, status, failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MomoClient, MomoError, momoMsisdn, momoReason, paidInFull, type MomoAccount } from './momo.ts';

const account: MomoAccount = {
  environment: 'sandbox',
  targetEnvironment: 'sandbox',
  currency: 'EUR',
  apiUser: '0b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
  apiKey: 'key123456',
  subscriptionKey: 'sub123456',
};

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeMomo(status: Record<string, unknown> | number = { status: 'SUCCESSFUL', amount: '1000', currency: 'EUR', financialTransactionId: '987654' }) {
  const seen: Seen[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ method: init?.method ?? 'GET', url, headers, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (code: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status: code });
    if (headers['Ocp-Apim-Subscription-Key'] !== 'sub123456') return json(401, { message: 'Access denied' });
    if (url.endsWith('/collection/token/')) {
      return headers.Authorization === `Basic ${btoa(`${account.apiUser}:key123456`)}` ? json(200, { access_token: 'tok', expires_in: 3600 }) : json(401);
    }
    if (headers.Authorization !== 'Bearer tok') return json(401);
    if (url.endsWith('/collection/v1_0/requesttopay') && init?.method === 'POST') return json(202);
    if (url.includes('/collection/v1_0/requesttopay/')) return typeof status === 'number' ? json(status) : json(200, status);
    return json(404);
  }) as typeof fetch;
  return { http, seen };
}

test('phone numbers become MoMo numbers (country code, digits only)', () => {
  assert.equal(momoMsisdn('0921234567'), '211921234567');
  assert.equal(momoMsisdn('+211 92 123 4567'), '211921234567');
  assert.equal(momoMsisdn('00256771234567'), '256771234567');
  assert.equal(momoMsisdn('46733123453'), '46733123453');
  assert.equal(momoMsisdn('12'), null);
});

test('request to pay: login once, then charge the phone with our reference', async () => {
  const { http, seen } = fakeMomo();
  const client = new MomoClient(account, http);
  await client.requestToPay({ referenceId: 'ref-1', amount: 1000, msisdn: '211921234567', externalId: 'pr-1', note: 'Cafe: 1 hour' });
  assert.equal(seen.length, 2);
  assert.match(seen[0]!.url, /^https:\/\/sandbox\.momodeveloper\.mtn\.com\/collection\/token\/$/);
  const pay = seen[1]!;
  assert.equal(pay.headers['X-Reference-Id'], 'ref-1');
  assert.equal(pay.headers['X-Target-Environment'], 'sandbox');
  assert.deepEqual(pay.body, {
    amount: '1000',
    currency: 'EUR',
    externalId: 'pr-1',
    payer: { partyIdType: 'MSISDN', partyId: '211921234567' },
    payerMessage: 'Cafe: 1 hour',
    payeeNote: 'Cafe: 1 hour',
  });
  await client.paymentStatus('ref-1');
  assert.equal(seen.filter((s) => s.url.endsWith('/token/')).length, 1, 'the token is reused');
});

test('status: paid in full only for the exact amount and currency', async () => {
  const paid = await new MomoClient(account, fakeMomo().http).paymentStatus('ref-1');
  assert.equal(paid.status, 'SUCCESSFUL');
  assert.equal(paid.financialTransactionId, '987654');
  assert.ok(paidInFull(paid, 1000, 'EUR'));
  assert.ok(!paidInFull(paid, 2000, 'EUR'));
  assert.ok(!paidInFull(paid, 1000, 'SSP'));
  const pending = await new MomoClient(account, fakeMomo({ status: 'PENDING', amount: '1000', currency: 'EUR' }).http).paymentStatus('ref-1');
  assert.ok(!paidInFull(pending, 1000, 'EUR'));
});

test('status: failures carry MoMo reason; an unknown payment counts as failed', async () => {
  const failed = await new MomoClient(account, fakeMomo({ status: 'FAILED', reason: 'APPROVAL_REJECTED', amount: '1000', currency: 'EUR' }).http).paymentStatus('r');
  assert.equal(failed.status, 'FAILED');
  assert.equal(momoReason(failed.reason), 'The payment was declined on the phone.');
  const missing = await new MomoClient(account, fakeMomo(404).http).paymentStatus('r');
  assert.equal(missing.status, 'FAILED');
});

test('a wrong key is reported plainly', async () => {
  const bad = new MomoClient({ ...account, apiKey: 'wrong' }, fakeMomo().http);
  await assert.rejects(() => bad.test(), (err: unknown) => err instanceof MomoError && /API user, API key or subscription key/.test(err.message));
  const badSub = new MomoClient({ ...account, subscriptionKey: 'nope' }, fakeMomo().http);
  await assert.rejects(() => badSub.test(), MomoError);
});

test('production uses MTN production address', async () => {
  const { http, seen } = fakeMomo();
  await new MomoClient({ ...account, environment: 'production', targetEnvironment: 'mtnsouthsudan' }, http).test();
  assert.match(seen[0]!.url, /^https:\/\/proxy\.momoapi\.mtn\.com\//);
});
