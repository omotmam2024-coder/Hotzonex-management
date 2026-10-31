import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandBackground, contrastWithWhite, darken, DEFAULT_BRAND_COLOR, isReadableBrand, normalizeHex } from '../src/lib/brandColor.ts';

test('normalizeHex accepts only full 6-digit colours', () => {
  assert.equal(normalizeHex(' #15479C '), '#15479c');
  assert.equal(normalizeHex('#fff'), null);
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex('#12345g'), null);
  assert.equal(normalizeHex('#15479c; background:url(x)'), null);
  assert.equal(normalizeHex(null), null);
});

test('readable brand: white text needs 4.5:1 contrast', () => {
  assert.ok(isReadableBrand('#15479c'), 'Hotzonex blue');
  assert.ok(isReadableBrand('#c2410c'), 'deep orange');
  assert.ok(!isReadableBrand('#ffff00'), 'yellow is too light');
  assert.ok(!isReadableBrand('#f97316'), 'bright orange is too light for white text');
  assert.ok(contrastWithWhite('#ffffff') < 1.1 && contrastWithWhite('#000000') > 20);
});

test('darken and background', () => {
  assert.equal(darken('#ffffff', 0), '#ffffff');
  assert.equal(darken('#ffffff', 1), '#000000');
  assert.equal(darken('#c8c8c8', 0.5), '#646464');
  assert.match(brandBackground(null), new RegExp(DEFAULT_BRAND_COLOR));
  assert.match(brandBackground('#c2410c'), /#c2410c/);
  assert.match(brandBackground('not a colour'), new RegExp(DEFAULT_BRAND_COLOR), 'bad values fall back, never reach CSS');
});
