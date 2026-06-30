import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePorcelain, workingStatus } from './git-read.js';

test('parsePorcelain separa staged/unstaged/untracked/conflicted', () => {
  // formato porcelain v1 -z: "XY path\0", rename agrega token de origen
  const z = 'M  a.js\0 M b.js\0MM c.js\0?? new.txt\0UU conf.js\0R  renamed.js\0old.js\0';
  const r = parsePorcelain(z);
  assert.deepEqual(r.staged.map((e) => e.rel).sort(), ['a.js', 'c.js', 'renamed.js'].sort());
  assert.deepEqual(r.unstaged.map((e) => e.rel).sort(), ['b.js', 'c.js'].sort());
  assert.deepEqual(r.untracked.map((e) => e.rel), ['new.txt']);
  assert.deepEqual(r.conflicted.map((e) => e.rel), ['conf.js']);
  const rn = r.staged.find((e) => e.rel === 'renamed.js');
  assert.equal(rn.old, 'old.js');
});

test('workingStatus llama a git status --porcelain=v1 -z', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return '?? x\0'; };
  const r = await workingStatus('/proj', exec);
  assert.deepEqual(got, ['git', '-C', '/proj', 'status', '--porcelain=v1', '-z']);
  assert.deepEqual(r.untracked.map((e) => e.rel), ['x']);
});
