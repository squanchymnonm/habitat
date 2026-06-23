import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config tiene defaults sensatos', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.PORT, 'number');
  assert.equal(typeof config.BIND, 'string');
  assert.equal(typeof config.PREVIEW_LINES, 'number');
  assert.equal(config.BIND, '127.0.0.1'); // loopback por default (Ley 1)
});

test('config: ALLOW_SPAWN y PROJECTS con defaults', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.ALLOW_SPAWN, 'boolean');
  assert.equal(Array.isArray(config.PROJECTS), true);
});

test('config: PROJECTS_ROOT y PROJECTS_STATE con defaults', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.PROJECTS_ROOT, 'string');
  assert.equal(typeof config.PROJECTS_STATE, 'string');
});

test('palette: PALETTE son 12 hex y pickColor es determinístico y miembro', async () => {
  const { PALETTE, pickColor } = await import('./palette.js');
  assert.equal(PALETTE.length, 12);
  assert.ok(PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  const a = pickColor('/home/u/proj-api');
  const b = pickColor('/home/u/proj-api');
  assert.equal(a, b);
  assert.ok(PALETTE.includes(a));
});
