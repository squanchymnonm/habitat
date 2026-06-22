import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validBranch, branchExists, worktreeAdd } from './git.js';

test('validBranch acepta nombres seguros y rechaza inválidos', () => {
  assert.equal(validBranch('feature/x'), true);
  assert.equal(validBranch('fix-123_a.b'), true);
  assert.equal(validBranch(''), false);
  assert.equal(validBranch('a b'), false);
  assert.equal(validBranch('../evil'), false);
  assert.equal(validBranch('a;rm -rf'), false);
});

test('branchExists true cuando rev-parse no falla', async () => {
  const exec = async (file, args) => {
    assert.equal(file, 'git');
    assert.deepEqual(args, ['-C', '/proj', 'rev-parse', '--verify', '--quiet', 'refs/heads/feat']);
    return 'abc123\n';
  };
  assert.equal(await branchExists('/proj', 'feat', exec), true);
});

test('branchExists false cuando rev-parse falla', async () => {
  const exec = async () => { throw new Error('unknown revision'); };
  assert.equal(await branchExists('/proj', 'nope', exec), false);
});

test('worktreeAdd con rama nueva usa -b y la base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) throw new Error('no existe'); // rama nueva
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feature/x', 'main', '/wt/proj/feature-x', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '-b', 'feature/x', '/wt/proj/feature-x', 'main',
  ]);
});

test('worktreeAdd con rama existente no usa -b ni base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) return 'abc\n'; // rama existe
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '/wt/proj/feat', 'feat',
  ]);
});

test('worktreeAdd con branch inválida devuelve false sin ejecutar', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeAdd('/proj', '../evil', 'main', '/wt/x', exec), false);
  assert.equal(called, false);
});

test('worktreeAdd ante fallo de git devuelve false', async () => {
  const exec = async (file, args) => {
    if (args.includes('rev-parse')) throw new Error('no existe');
    throw new Error('worktree add failed');
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/feat', exec), false);
});
