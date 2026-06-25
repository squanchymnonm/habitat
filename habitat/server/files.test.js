import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, resolveWithinRoot, uniqueName, maxUploadBytes } from './files.js';

test('sanitizeFilename deja solo el basename y descarta traversal', () => {
  assert.equal(sanitizeFilename('logo.png'), 'logo.png');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a/b/c.txt'), 'c.txt');
  assert.equal(sanitizeFilename('..'), 'archivo');
  assert.equal(sanitizeFilename(''), 'archivo');
  assert.equal(sanitizeFilename('  spaced name.jpg  '), 'spaced name.jpg');
});

test('resolveWithinRoot resuelve dentro y rechaza lo que escapa', () => {
  const root = '/home/u/proj';
  assert.equal(resolveWithinRoot(root, 'src'), '/home/u/proj/src');
  assert.equal(resolveWithinRoot(root, ''), root);
  assert.equal(resolveWithinRoot(root, '/abs'), '/home/u/proj/abs'); // se le quita el / inicial
  assert.equal(resolveWithinRoot(root, '../otro'), null);
  assert.equal(resolveWithinRoot(root, 'a/../../x'), null);
});

test('uniqueName sufija ante colisión, respetando la extensión', () => {
  assert.equal(uniqueName('logo.png', new Set()), 'logo.png');
  assert.equal(uniqueName('logo.png', new Set(['logo.png'])), 'logo (1).png');
  assert.equal(uniqueName('logo.png', new Set(['logo.png', 'logo (1).png'])), 'logo (2).png');
  assert.equal(uniqueName('README', new Set(['README'])), 'README (1)');
});

test('maxUploadBytes: cap salvo password configurada y correcta', () => {
  const cap = 25 * 1024 * 1024;
  assert.equal(maxUploadBytes({ cap, configuredPassword: '', providedPassword: '' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: '', providedPassword: 'x' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: 'sec', providedPassword: 'nope' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: 'sec', providedPassword: 'sec' }), Infinity);
});
