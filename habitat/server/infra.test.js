import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInfraCommand, UP_TIMEOUT_MS } from './infra.js';

test('runInfraCommand corre sh -c en cwd con timeout largo', async () => {
  let call;
  const exec = async (file, args, opts) => { call = { file, args, opts }; return ''; };
  assert.deepEqual(await runInfraCommand('make up', '/wt/x', exec), { ok: true });
  assert.equal(call.file, 'sh');
  assert.deepEqual(call.args, ['-c', 'make up']);
  assert.equal(call.opts.cwd, '/wt/x');
  assert.equal(call.opts.timeout, UP_TIMEOUT_MS);
  assert.ok(call.opts.maxBuffer >= 16 * 1024 * 1024);
});

test('runInfraCommand devuelve el error recortado', async () => {
  const exec = async () => { const e = new Error('x'); e.stderr = 'Error: port is already allocated'; throw e; };
  const r = await runInfraCommand('make up', '/wt/x', exec);
  assert.equal(r.ok, false);
  assert.match(r.message, /port is already allocated/);
});
