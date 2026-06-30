import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stage, unstage, discard, commit, push, pull, mergeDefault, abort } from './git-write.js';

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

test('commit rechaza mensaje vacío y usa -m', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await commit('/proj', '   ', exec)).ok, false);
  await commit('/proj', 'mi mensaje', exec);
  assert.deepEqual(got, '-C /proj commit -m mi mensaje');
});

test('push intenta git push y cae a -u origin <branch> si falla', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (calls.length === 1) { const e = new Error('no upstream'); e.stderr = 'has no upstream branch'; throw e; }
    return '';
  };
  const r = await push('/proj', 'feature/x', exec);
  assert.equal(r.ok, true);
  assert.ok(calls[0].includes('push'));
  assert.ok(calls[1].includes('push -u origin feature/x'));
});

test('mergeDefault hace fetch + merge y reporta conflicto', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('fetch')) { assert.ok(a.includes('fetch origin main')); return ''; }
    if (a.startsWith('-C /proj merge')) { const e = new Error('m'); e.stdout = 'CONFLICT (content): Merge conflict in a.js'; throw e; }
    if (a.includes('diff --name-only --diff-filter=U')) return 'a.js\0';
    return '';
  };
  const r = await mergeDefault('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.files, ['a.js']);
});

test('pull --no-edit y abort --abort', async () => {
  let pullArgs, abortArgs;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('pull')) pullArgs = a;
    if (a.includes('merge --abort')) abortArgs = a;
    return '';
  };
  assert.equal((await pull('/proj', exec)).ok, true);
  assert.ok(pullArgs.includes('pull --no-edit'));
  assert.equal((await abort('/proj', exec)).ok, true);
  assert.ok(abortArgs.includes('merge --abort'));
});
