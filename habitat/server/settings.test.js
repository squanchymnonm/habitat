import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { createSettings, PERMISSION_MODES } from './settings.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-settings-${process.pid}-${tag}.json`);

test('default sin persistPath es acceptEdits', () => {
  assert.equal(createSettings().get().permissionMode, 'acceptEdits');
});

test('PERMISSION_MODES son los cuatro modos', () => {
  assert.deepEqual(PERMISSION_MODES, ['default', 'acceptEdits', 'plan', 'bypassPermissions']);
});

test('set válido aplica y get lo refleja', () => {
  const s = createSettings();
  assert.equal(s.set({ permissionMode: 'plan' }), true);
  assert.equal(s.get().permissionMode, 'plan');
});

test('set inválido devuelve false y no cambia el modo previo', () => {
  const s = createSettings();
  s.set({ permissionMode: 'plan' });
  assert.equal(s.set({ permissionMode: 'nope' }), false);
  assert.equal(s.get().permissionMode, 'plan');
});

test('persistencia: set escribe y un store nuevo recarga el modo', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createSettings({ persistPath: path });
    assert.equal(a.set({ permissionMode: 'bypassPermissions' }), true);
    assert.ok(existsSync(path), 'debería haber escrito el archivo');
    const b = createSettings({ persistPath: path });
    assert.equal(b.get().permissionMode, 'bypassPermissions');
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca en default acceptEdits', () => {
  const path = tmpPath('corrupt');
  writeFileSync(path, '{ no json');
  try {
    assert.equal(createSettings({ persistPath: path }).get().permissionMode, 'acceptEdits');
  } finally {
    rmSync(path, { force: true });
  }
});
