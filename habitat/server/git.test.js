import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
} from './git.js';

test('validBranch acepta nombres seguros y rechaza inválidos', () => {
  assert.equal(validBranch('feature/x'), true);
  assert.equal(validBranch('fix-123_a.b'), true);
  assert.equal(validBranch(''), false);
  assert.equal(validBranch('a b'), false);
  assert.equal(validBranch('../evil'), false);
  assert.equal(validBranch('a;rm -rf'), false);
  assert.equal(validBranch('-b'), false);
  assert.equal(validBranch('--force'), false);
});

test('worktreeAdd rechaza base/path con prefijo - (flag smuggling)', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeAdd('/proj', 'feat', '--foo', '/wt/x', exec), false);
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '-rf', exec), false);
  assert.equal(called, false);
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
    if (args.includes('list')) return '';
    if (args.includes('rev-parse')) throw new Error('no existe');
    throw new Error('worktree add failed');
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/feat', exec), false);
});

test('worktreeAdd reutiliza el worktree existente de la rama (sesión cerrada sin limpiar)', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('list')) {
      return 'worktree /wt/proj/feat\nHEAD abc123\nbranch refs/heads/feat\n\n';
    }
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec);
  assert.equal(ok, true);
  assert.ok(!calls.some((c) => c.includes('worktree add')), 'no debe ejecutar worktree add');
});

test('worktreeAdd no secuestra una rama en uso en otra ruta -> false', async () => {
  const exec = async (file, args) => {
    if (args.includes('list')) return 'worktree /otro/lado\nHEAD abc123\nbranch refs/heads/feat\n\n';
    return '';
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec), false);
});

test('worktreeRemove ejecuta git worktree remove y devuelve true', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'remove', '/wt/proj/feat',
  ]);
});

test('worktreeRemove rechaza path con prefijo - (flag smuggling) sin ejecutar', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeRemove('/proj', '-rf', {}, exec), false);
  assert.equal(called, false);
});

test('worktreeRemove ante fallo de git (worktree sucio) devuelve false', async () => {
  const exec = async () => { throw new Error('contains modified or untracked files'); };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), false);
});

test('worktreeRemove con force:true agrega --force', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', { force: true }, exec), true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'remove', '--force', '/wt/proj/feat',
  ]);
});

test('findNestedRepos devuelve las subcarpetas con .git, ordenadas', async () => {
  const deps = {
    readdir: async () => ([
      { name: 'front', isDirectory: () => true },
      { name: 'back', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false },
      { name: 'docs', isDirectory: () => true },
    ]),
    stat: async (p) => {
      if (p.endsWith('/back/.git') || p.endsWith('/front/.git')) return {};
      throw new Error('ENOENT');
    },
  };
  assert.deepEqual(await findNestedRepos('/proj', deps), ['back', 'front']);
});

test('findNestedRepos devuelve [] si el dir no existe', async () => {
  const deps = { readdir: async () => { throw new Error('ENOENT'); }, stat: async () => ({}) };
  assert.deepEqual(await findNestedRepos('/nope', deps), []);
});
