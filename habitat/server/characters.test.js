import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMES, autoName } from './characters.js';

test('NAMES no está vacío y todos son válidos como branch/carpeta', () => {
  assert.ok(NAMES.length >= 10);
  for (const n of NAMES) assert.match(n, /^[a-zA-Z0-9._-]+$/);
});
test('autoName devuelve un nombre de NAMES cuando hay libres', () => {
  assert.ok(NAMES.includes(autoName([])));
});
test('autoName nunca devuelve un nombre ya usado (50 sorteos)', () => {
  const used = ['mario', 'luigi', 'link'];
  for (let i = 0; i < 50; i++) {
    const r = autoName(used);
    assert.ok(NAMES.includes(r), `${r} debería estar en NAMES`);
    assert.ok(!used.includes(r), `${r} no debería estar en used`);
  }
});
test('autoName sufija (y no repite) cuando todos están usados', () => {
  const r = autoName(NAMES);
  assert.match(r, /-\d+$/);
  assert.ok(!NAMES.includes(r));
});
