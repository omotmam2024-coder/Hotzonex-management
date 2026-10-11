// Run with: node --test supabase/functions/_shared/mikroticket.test.ts   (Node 22.18+)
// The parser lives in the web app (web/src/lib/mikroticket.ts); it is tested here with the other pure modules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMikroticketProfile, profileLabel } from '../../../web/src/lib/mikroticket.ts';

test('reads label, price, time and validity from MikroTicket profile names', () => {
  assert.deepEqual(parseMikroticketProfile('profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:1d 12:00:00'), {
    label: '1Hr',
    price: 1000,
    uptimeSeconds: 3600,
    validitySeconds: 129600,
  });
  assert.deepEqual(parseMikroticketProfile('profile_1Week-se:-co:15000-pr:-lu:7-lp:7-ut:7d 00:00:00-bt:-kt:true-nu:true-np:true-tp:2'), {
    label: '1Week',
    price: 15000,
    uptimeSeconds: 604800,
    validitySeconds: null,
  });
  assert.equal(parseMikroticketProfile('profile_Enjoy-se:-co:0.0-pr:-lu:7-lp:7-ut:0d 00:45:00-bt:-kt:false-nu:true-np:true-tp:2')?.price, 0);
});

test('other profile names are left alone', () => {
  for (const name of ['default', 'Guest', 'LITE', 'hzc-1d']) {
    assert.equal(parseMikroticketProfile(name), null);
    assert.equal(profileLabel(name), name);
  }
  assert.equal(profileLabel('profile_3Hrs-se:-co:2000-pr:-lu:7-lp:7-ut:0d 03:00:00-bt:-kt:true-nu:true-np:true-tp:2'), '3Hrs (MikroTicket)');
});
