import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stage, unstage, discard } from './git-write.js';

test('stage usa git add -- <paths>', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return ''; };
  const r = await stage('/proj', ['a.js', 'b.js'], exec);
  assert.equal(r.ok, true);
  assert.deepEqual(got, ['git', '-C', '/proj', 'add', '--', 'a.js', 'b.js']);
});

test('unstage usa restore --staged', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await unstage('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore --staged -- a.js'));
});

test('discard usa restore --', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await discard('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore -- a.js'));
});

test('rechaza paths con prefijo - y arrays vacíos (flag smuggling)', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await stage('/proj', ['-rf'], exec)).ok, false);
  assert.equal((await stage('/proj', [], exec)).ok, false);
  assert.equal(called, false);
});

test('devuelve ok:false con stderr recortado ante fallo', async () => {
  const exec = async () => { const e = new Error('boom'); e.stderr = 'fatal: pathspec\nlinea2'; e.code = 1; throw e; };
  const r = await stage('/proj', ['a.js'], exec);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('fatal: pathspec'));
});
