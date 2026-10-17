import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BILLING_CODES,
  BILLING_VARS,
  billingCode,
  billingDate,
  billingDays,
  billingInvoiceId,
  cleanTemplates,
  DEFAULT_TEMPLATES,
  LANGS,
  renderBilling,
  ssp,
  unknownVars,
} from './billing-messages.ts';

const INV = '0b6f6a0e-4c1d-4b5e-9a0c-2f6d1c9e8a11';

test('every message has a default in English, Arabic and Kiswahili, using only its own words', () => {
  for (const code of BILLING_CODES) {
    for (const lang of LANGS) {
      const t = DEFAULT_TEMPLATES[code][lang];
      assert.ok(t.length > 20, `${code}/${lang} is empty`);
      assert.deepEqual(unknownVars(code, t), [], `${code}/${lang}`);
      assert.ok(t.includes('{business}'), `${code}/${lang} names the business`);
    }
  }
  // The Arabic texts are Arabic, the Kiswahili ones Kiswahili.
  assert.match(DEFAULT_TEMPLATES.renew_soon.ar, /[؀-ۿ]/);
  assert.match(DEFAULT_TEMPLATES.renew_soon.sw, /huduma/);
});

test('alert keys map to messages, invoice ids and days', () => {
  assert.equal(billingCode(`invoice:${INV}`), 'invoice');
  assert.equal(billingCode(`receipt:${INV}`), 'paid');
  assert.equal(billingCode(`renew:${INV}:3`), 'renew_soon');
  assert.equal(billingCode(`trial_ending:${INV}:7`), 'trial_ending');
  assert.equal(billingCode('router_offline:x'), null);
  assert.equal(billingInvoiceId(`due_soon:${INV}`), INV);
  assert.equal(billingInvoiceId(`trial_ending:${INV}:1`), null);
  assert.equal(billingDays(`renew:${INV}:7`), 7);
  assert.equal(billingDays(`invoice:${INV}`), null);
});

test('rendering fills the words, drops an empty payment line, and uses custom texts first', () => {
  const vars = { business: 'Juba WiFi', days: 3, date: '31/10/2026', amount: ssp(120000), pay: '' };
  const en = renderBilling('renew_soon', 'en', vars);
  assert.equal(en, '⏳ Juba WiFi: your Hotzonex Cloud service is paid until 31/10/2026 (3 day(s) left). Next month: 120,000 SSP. Pay early so the app is not paused.');
  const withPay = renderBilling('renew_soon', 'sw', { ...vars, pay: 'MTN MoMo 092 123 4567' });
  assert.ok(withPay.endsWith('\nMTN MoMo 092 123 4567'));
  assert.ok(withPay.includes('zimebaki siku 3'));
  const ar = renderBilling('paid', 'ar', { business: 'Juba WiFi', invoice: 'HZC-2026-00001', amount: ssp(5000) });
  assert.ok(ar.includes('HZC-2026-00001') && ar.includes('5,000 SSP') && ar.startsWith('✅ Juba WiFi'));
  const custom = cleanTemplates({ paid: { en: '  Thanks {business}!  ', ar: '', fr: 'x' }, nope: { en: 'x' } });
  assert.deepEqual(custom, { paid: { en: 'Thanks {business}!' } });
  assert.equal(renderBilling('paid', 'en', { business: 'A' }, custom), 'Thanks A!');
  assert.equal(renderBilling('paid', 'ar', { business: 'A', invoice: 'I', amount: '1 SSP' }, custom), renderBilling('paid', 'ar', { business: 'A', invoice: 'I', amount: '1 SSP' }));
});

test('unknown words are reported; dates are the same in every language', () => {
  assert.deepEqual(unknownVars('paid', 'Hi {business} {due} {due} {invoice}'), ['due']);
  assert.ok(BILLING_VARS.invoice.includes('period'));
  assert.equal(billingDate('2026-10-31'), '31/10/2026');
  assert.equal(billingDate('2026-10-31T22:30:00Z'), '01/11/2026'); // Juba is UTC+2
  assert.equal(billingDate(null), '');
});
