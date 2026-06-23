import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMES, autoName } from './characters.js';

test('NAMES no está vacío y todos son válidos como branch/carpeta', () => {
  assert.ok(NAMES.length >= 10);
  for (const n of NAMES) assert.match(n, /^[a-zA-Z0-9._-]+$/);
});
test('autoName devuelve el primer nombre libre', () => {
  assert.equal(autoName([]), NAMES[0]);
  assert.equal(autoName([NAMES[0]]), NAMES[1]);
});
test('autoName sufija cuando todos están usados', () => {
  assert.equal(autoName(NAMES), `${NAMES[0]}-2`);
});
