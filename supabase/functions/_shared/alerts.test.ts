// Run with: node --test supabase/functions/_shared/alerts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertMessage, LINK_CODE_RE, wantsAlert } from './alerts.ts';

test('alert text is plain, with icon, details and business', () => {
  assert.equal(
    alertMessage({ kind: 'router_offline', title: 'Main office is offline', body: 'Last seen 13 Oct 10:13.' }, 'Hotzonex WiFi'),
    '🔴 Main office is offline\nLast seen 13 Oct 10:13.\n— Hotzonex WiFi',
  );
  assert.equal(alertMessage({ kind: 'low_stock', title: 'HQ: 3 × 1Hr left', body: ' ' }, ''), '📉 HQ: 3 × 1Hr left');
});

test('each switch covers its alerts; billing always goes', () => {
  const s = { telegram_chat_id: '1', notify_offline: false, notify_push: true, notify_low_stock: false, notify_payments: true };
  assert.equal(wantsAlert(s, 'router_online'), false);
  assert.equal(wantsAlert(s, 'push_warning'), true);
  assert.equal(wantsAlert(s, 'low_stock'), false);
  assert.equal(wantsAlert(s, 'billing'), true);
  assert.ok(LINK_CODE_RE.test('abcdefghjk23'));
  assert.ok(!LINK_CODE_RE.test('abc'));
  assert.ok(!LINK_CODE_RE.test('abcdefghjk2l'), 'no look-alike letters');
});
