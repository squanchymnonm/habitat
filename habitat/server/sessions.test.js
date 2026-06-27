import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { createSessionStore } from './sessions.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-sessions-${process.pid}-${tag}.json`);

test('create devuelve un id y validate lo acepta', () => {
  const s = createSessionStore({ ttlMs: 1000, now: () => 0 });
  const id = s.create('nico');
  assert.ok(typeof id === 'string' && id.length >= 16);
  assert.deepEqual(s.validate(id), { user: 'nico' });
});

test('validate de id inexistente devuelve null', () => {
  const s = createSessionStore({ now: () => 0 });
  assert.equal(s.validate('nope'), null);
});

test('sesión expirada devuelve null', () => {
  let t = 0;
  const s = createSessionStore({ ttlMs: 100, now: () => t });
  const id = s.create('nico');
  t = 101;
  assert.equal(s.validate(id), null);
});

test('validate renueva la expiración (sliding)', () => {
  let t = 0;
  const s = createSessionStore({ ttlMs: 100, now: () => t });
  const id = s.create('nico');
  t = 80; assert.deepEqual(s.validate(id), { user: 'nico' }); // renueva a 180
  t = 150; assert.deepEqual(s.validate(id), { user: 'nico' }); // seguiría viva
});

test('destroy invalida la sesión', () => {
  const s = createSessionStore({ now: () => 0 });
  const id = s.create('nico');
  s.destroy(id);
  assert.equal(s.validate(id), null);
});

test('persistencia: un store nuevo recarga las sesiones del disco', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createSessionStore({ persistPath: path, ttlMs: 100000, now: () => 0 });
    const id = a.create('nico');
    assert.ok(existsSync(path));
    const b = createSessionStore({ persistPath: path, ttlMs: 100000, now: () => 0 });
    assert.deepEqual(b.validate(id), { user: 'nico' });
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca vacío sin tirar', () => {
  const path = tmpPath('corrupt');
  rmSync(path, { force: true });
  writeFileSync(path, '{ no json');
  try {
    const s = createSessionStore({ persistPath: path, now: () => 0 });
    assert.equal(s.validate('x'), null);
  } finally {
    rmSync(path, { force: true });
  }
});
