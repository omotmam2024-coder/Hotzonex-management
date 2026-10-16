import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyRequestSchema, cashHandoverSchema, generateVouchersSchema, planSchema, signupSchema, staffSchema, validate } from '../src/lib/validation.ts';

const ID = '3f2b2a4e-0000-4000-8000-000000000000';

test('generate vouchers: whole numbers in range, ids required', () => {
  assert.deepEqual(validate(generateVouchersSchema, { p_router_id: ID, p_plan_id: ID, p_quantity: '50', p_code_length: '7' }), {
    p_router_id: ID, p_plan_id: ID, p_quantity: 50, p_code_length: 7,
  });
  assert.throws(() => validate(generateVouchersSchema, { p_router_id: '', p_plan_id: ID, p_quantity: '5', p_code_length: '7' }), /Choose a router/);
  assert.throws(() => validate(generateVouchersSchema, { p_router_id: ID, p_plan_id: ID, p_quantity: '1001', p_code_length: '7' }), /1 to 1000/);
  assert.throws(() => validate(generateVouchersSchema, { p_router_id: ID, p_plan_id: ID, p_quantity: '2.5', p_code_length: '7' }), /1 to 1000/);
  assert.throws(() => validate(generateVouchersSchema, { p_router_id: ID, p_plan_id: ID, p_quantity: '5', p_code_length: '4' }), /6 to 10/);
});

test('staff: new needs email and password; managers and sellers need a site', () => {
  const ok = { full_name: ' Akol ', email: 'Akol@Example.com ', password: 'long-pass', role: 'seller', site_id: ID };
  assert.equal(validate(staffSchema(true), ok).email, 'akol@example.com');
  assert.throws(() => validate(staffSchema(true), { ...ok, password: 'short' }), /at least 8/);
  assert.throws(() => validate(staffSchema(true), { ...ok, email: 'nope' }), /valid email/);
  assert.throws(() => validate(staffSchema(true), { ...ok, site_id: '' }), /must belong to a site/);
  assert.equal(validate(staffSchema(false), { ...ok, email: '', password: '' }).password, '', 'editing keeps the password');
  assert.equal(validate(staffSchema(true), { ...ok, role: 'admin', site_id: '' }).role, 'admin');
});

test('plan: blank numbers give the plain message', () => {
  const ok = { name: '1Hr', price_ssp: 1000, uptime_seconds: 3600, validity_seconds: null, rate_limit: '2M/2M', data_limit_mb: null, shared_users: 1, router_ids: [ID] };
  assert.equal(validate(planSchema, ok).name, '1Hr');
  assert.throws(() => validate(planSchema, { ...ok, price_ssp: NaN }), /whole number of SSP/);
  assert.throws(() => validate(planSchema, { ...ok, rate_limit: '2 megabits' }), /2M\/2M/);
  assert.throws(() => validate(planSchema, { ...ok, shared_users: 51 }), /1 to 50/);
  assert.throws(() => validate(planSchema, { ...ok, router_ids: [] }), /at least one router/);
});

test('buy, sign-up and cash: cleaned like the server does', () => {
  assert.deepEqual(validate(buyRequestSchema, { plan_id: ID, phone: '092 123-4567', txn_ref: ' mp241015.1 ' }), { plan_id: ID, phone: '0921234567', txn_ref: 'MP241015.1' });
  assert.throws(() => validate(buyRequestSchema, { plan_id: ID, phone: '12', txn_ref: 'MP2410' }), /phone number you paid from/);
  assert.throws(() => validate(signupSchema, { business_name: 'Juba WiFi', site_name: '', full_name: 'Deng', phone: '0921234567', email: 'x', password: 'long-pass' }), /valid email/);
  assert.equal(validate(cashHandoverSchema, { amount: '20000', note: '' }).amount, 20000);
  assert.throws(() => validate(cashHandoverSchema, { amount: '0', note: '' }), /amount received/);
});
