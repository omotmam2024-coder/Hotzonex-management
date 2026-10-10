import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromRouterOsTime, toRouterOsTime } from '../src/routerTime.js';

describe('toRouterOsTime', () => {
  it('converts seconds to RouterOS time', () => {
    assert.equal(toRouterOsTime(7200), '2h');
    assert.equal(toRouterOsTime(9000), '2h30m');
    assert.equal(toRouterOsTime(86400), '1d');
    assert.equal(toRouterOsTime(93784), '1d2h3m4s');
    assert.equal(toRouterOsTime(604800), '1w');
    assert.equal(toRouterOsTime(2592000), '4w2d');
  });

  it('rejects zero and fractions', () => {
    assert.throws(() => toRouterOsTime(0));
    assert.throws(() => toRouterOsTime(1.5));
  });
});

describe('fromRouterOsTime', () => {
  it('parses RouterOS time back to seconds', () => {
    assert.equal(fromRouterOsTime('2h30m'), 9000);
    assert.equal(fromRouterOsTime('1w2d3h4m5s'), 788645);
    assert.equal(fromRouterOsTime('00:05:00'), 300);
    assert.equal(fromRouterOsTime('1d02:00:00'), 93600);
    assert.equal(fromRouterOsTime(''), 0);
  });

  it('round-trips', () => {
    for (const s of [1, 59, 3600, 7200, 86399, 604800, 1209600 + 3661]) assert.equal(fromRouterOsTime(toRouterOsTime(s)), s);
  });
});
