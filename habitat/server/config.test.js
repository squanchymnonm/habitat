import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config tiene defaults sensatos', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.PORT, 'number');
  assert.equal(typeof config.BIND, 'string');
  assert.equal(typeof config.PREVIEW_LINES, 'number');
  assert.equal(typeof config.MAX_CONTEXT, 'number');
  assert.ok(config.MAX_CONTEXT > 0);
  assert.equal(config.BIND, '127.0.0.1'); // loopback por default (Ley 1)
});

test('config: ALLOW_SPAWN y PROJECTS con defaults', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.ALLOW_SPAWN, 'boolean');
  assert.equal(Array.isArray(config.PROJECTS), true);
});
