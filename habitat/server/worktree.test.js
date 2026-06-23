import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBranch, worktreeName, worktreePaths } from './worktree.js';

const BASE = '/home/u/habitat-worktrees';

test('sanitizeBranch reemplaza slashes', () => {
  assert.equal(sanitizeBranch('feature/x'), 'feature-x');
  assert.equal(sanitizeBranch('fix'), 'fix');
});

test('worktreeName deriva project y tmux de un cwd bajo la base', () => {
  assert.deepEqual(worktreeName(BASE, `${BASE}/rpg/feature-x`), { project: 'rpg', tmux: 'rpg-feature-x' });
});

test('worktreeName devuelve null para cwd fuera de la base', () => {
  assert.equal(worktreeName(BASE, '/home/u/rpg'), null);
});

test('worktreeName devuelve null si falta el leaf (solo proyecto)', () => {
  assert.equal(worktreeName(BASE, `${BASE}/rpg`), null);
});

test('worktreePaths arma path y tmux consistentes con la derivación', () => {
  const { path, tmux } = worktreePaths(BASE, 'rpg', 'feature/x');
  assert.equal(path, `${BASE}/rpg/feature-x`);
  assert.equal(tmux, 'rpg-feature-x');
  // round-trip: derivar desde el path reproduce el mismo tmux
  assert.equal(worktreeName(BASE, path).tmux, tmux);
});
