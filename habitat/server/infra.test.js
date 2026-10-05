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

test('runInfraCommand se queda con el FINAL del stderr (compose imprime el progreso primero)', async () => {
  const progreso = Array.from({ length: 20 }, (_, i) => ` Container infra-db-${i}  Creating`).join('\n');
  const exec = async () => {
    const e = new Error('Command failed');
    e.stderr = `${progreso}\nError response from daemon: Bind for 0.0.0.0:5432 failed: port is already allocated\n`;
    throw e;
  };
  const r = await runInfraCommand('docker compose up -d', '/wt/x', exec);
  assert.equal(r.ok, false);
  assert.match(r.message, /port is already allocated/);
  assert.doesNotMatch(r.message, /infra-db-0 /); // el progreso del principio se descarta
  assert.ok(r.message.split('\n').length <= 6);
  assert.ok(r.message.length <= 800);
});

test('runInfraCommand sin stderr cae al message del error', async () => {
  const exec = async () => { throw new Error('spawn sh ENOENT'); };
  assert.match((await runInfraCommand('x', '/wt/x', exec)).message, /ENOENT/);
});

test('runInfraCommand por timeout avisa que el comando de infra se cortó', async () => {
  const exec = async () => { const e = new Error('Command failed'); e.killed = true; e.signal = 'SIGTERM'; e.stderr = 'Building...'; throw e; };
  const r = await runInfraCommand('make up', '/wt/x', exec);
  assert.equal(r.ok, false);
  assert.match(r.message, /comando de infra tardó más de 15 min y se cortó/);
  assert.doesNotMatch(r.message, /remoto/);
});
