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

test('config expone USER/PASSWORD_HASH/SESSIONS_PATH/SESSION_TTL_MS/COOKIE_SECURE con defaults', async () => {
  delete process.env.HABITAT_USER;
  delete process.env.HABITAT_PASSWORD_HASH;
  delete process.env.HABITAT_SESSION_TTL_MS;
  delete process.env.HABITAT_COOKIE_SECURE;
  const { default: cfg } = await import(`./config.js?cfg=${Math.random()}`);
  assert.equal(cfg.USER, '');
  assert.equal(cfg.PASSWORD_HASH, '');
  assert.equal(cfg.SESSION_TTL_MS, 86_400_000);
  assert.equal(cfg.COOKIE_SECURE, true);
  assert.ok(cfg.SESSIONS_PATH.endsWith('.sessions.json'));
});

test('ALLOW_GIT_WRITE: off por default, on con HABITAT_ALLOW_GIT_WRITE=1', async () => {
  delete process.env.HABITAT_ALLOW_GIT_WRITE;
  const a = (await import(`./config.js?case=off${Math.random()}`)).default;
  assert.equal(a.ALLOW_GIT_WRITE, false);
  process.env.HABITAT_ALLOW_GIT_WRITE = '1';
  const b = (await import(`./config.js?case=on${Math.random()}`)).default;
  assert.equal(b.ALLOW_GIT_WRITE, true);
  delete process.env.HABITAT_ALLOW_GIT_WRITE;
});
