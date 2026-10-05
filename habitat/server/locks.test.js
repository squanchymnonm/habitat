import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocks } from './locks.js';

test('run serializa: la segunda llamada concurrente sobre la misma key falla con busy', async () => {
  const locks = createLocks();
  let release;
  const primera = locks.run('/repo', () => new Promise((r) => { release = r; }));
  await assert.rejects(() => locks.run('/repo', async () => 'x'), /busy/);
  release('ok');
  assert.equal(await primera, 'ok');
  // liberada: ahora sí entra
  assert.equal(await locks.run('/repo', async () => 'y'), 'y');
});

test('run no bloquea keys distintas', async () => {
  const locks = createLocks();
  let release;
  const a = locks.run('/a', () => new Promise((r) => { release = r; }));
  assert.equal(await locks.run('/b', async () => 'b'), 'b');
  release('a');
  assert.equal(await a, 'a');
});

test('run libera la key aunque fn lance', async () => {
  const locks = createLocks();
  await assert.rejects(() => locks.run('/repo', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await locks.run('/repo', async () => 'ok'), 'ok');
});

test('has indica si la key está tomada mientras corre fn', async () => {
  const locks = createLocks();
  let release;
  assert.equal(locks.has('infra:s1'), false);
  const p = locks.run('infra:s1', () => new Promise((r) => { release = r; }));
  assert.equal(locks.has('infra:s1'), true);
  assert.equal(locks.has('infra:s2'), false);
  release();
  await p;
  assert.equal(locks.has('infra:s1'), false);
});
