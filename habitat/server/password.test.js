import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword produce formato scrypt$N$salt$hash', () => {
  const h = hashPassword('secreta');
  const parts = h.split('$');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '16384');
  assert.ok(parts[2].length > 0 && parts[3].length > 0);
});

test('verifyPassword acepta la contraseña correcta', () => {
  const h = hashPassword('correcta');
  assert.equal(verifyPassword('correcta', h), true);
});

test('verifyPassword rechaza la contraseña incorrecta', () => {
  const h = hashPassword('correcta');
  assert.equal(verifyPassword('incorrecta', h), false);
});

test('dos hashes de la misma contraseña difieren (salt aleatorio)', () => {
  assert.notEqual(hashPassword('x'), hashPassword('x'));
});

test('verifyPassword con formato inválido devuelve false sin tirar', () => {
  assert.equal(verifyPassword('x', 'no-es-un-hash'), false);
  assert.equal(verifyPassword('x', ''), false);
});
