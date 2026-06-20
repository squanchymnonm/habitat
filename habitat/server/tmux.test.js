import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePane, listSessions } from './tmux.js';

test('capturePane devuelve las últimas N líneas', async () => {
  const exec = async () => 'l1\nl2\nl3\nl4\nl5\n';
  const out = await capturePane('sess', 2, exec);
  assert.equal(out, 'l4\nl5');
});

test('capturePane ante error devuelve cadena vacía', async () => {
  const exec = async () => { throw new Error('no tmux'); };
  assert.equal(await capturePane('sess', 5, exec), '');
});

test('listSessions parsea nombres', async () => {
  const exec = async () => 'api\nweb\ninfra\n';
  assert.deepEqual(await listSessions(exec), ['api', 'web', 'infra']);
});

test('listSessions ante error devuelve []', async () => {
  const exec = async () => { throw new Error('no server'); };
  assert.deepEqual(await listSessions(exec), []);
});
