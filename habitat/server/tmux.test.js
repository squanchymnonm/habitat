import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePane, listSessions, sendKeys, gitBranch, newTmuxSession } from './tmux.js';

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

test('sendKeys manda el texto literal y luego Enter', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  const ok = await sendKeys('api', 'npm test', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['tmux', 'send-keys', '-t', 'api', '-l', 'npm test']);
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'api', 'Enter']);
});

test('sendKeys ante error devuelve false', async () => {
  const exec = async () => { throw new Error('no tmux'); };
  assert.equal(await sendKeys('api', 'x', exec), false);
});

test('sendKeys ignora texto vacío', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await sendKeys('api', '   ', exec), false);
  assert.equal(called, false);
});

test('gitBranch parsea la rama del cwd (síncrono)', () => {
  const exec = (file, args) => {
    assert.equal(file, 'git');
    assert.deepEqual(args, ['-C', '/proj', 'rev-parse', '--abbrev-ref', 'HEAD']);
    return 'feat/x\n';
  };
  assert.equal(gitBranch('/proj', exec), 'feat/x');
});

test('gitBranch ante error devuelve cadena vacía', () => {
  const exec = () => { throw new Error('not a repo'); };
  assert.equal(gitBranch('/x', exec), '');
});

test('newTmuxSession crea sesión detached en dir y lanza claude', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  const ok = await newTmuxSession('proj', '/home/u/proj', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['tmux', 'new-session', '-d', '-s', 'proj', '-c', '/home/u/proj']);
  // luego send-keys del comando claude + Enter (vía sendKeys)
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'proj', '-l', 'claude']);
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'proj', 'Enter']);
});

test('newTmuxSession ante error de new-session devuelve false', async () => {
  const exec = async () => { throw new Error('duplicate session'); };
  assert.equal(await newTmuxSession('proj', '/x', exec), false);
});
