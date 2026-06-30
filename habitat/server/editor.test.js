import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorSessionName, openInEditor } from './editor.js';

test('editorSessionName sufija -edit', () => {
  assert.equal(editorSessionName('proj-feat'), 'proj-feat-edit');
});

test('openInEditor crea la sesión con nvim si no existe', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('ls')) return ''; // ninguna sesión
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'src/a.js', exec });
  assert.equal(r.ok, true);
  assert.equal(r.tmux, 'api-edit');
  const created = calls.find((c) => c.includes('new-session'));
  assert.ok(created, 'debe crear la sesión');
  // tmux ejecuta nvim directamente: ... new-session -d -s api-edit -c /wt/api nvim -- src/a.js
  assert.deepEqual(created.slice(-7, -1), ['-s','api-edit','-c','/wt/api','nvim','--']);
  assert.equal(created.at(-1), 'src/a.js');
});

test('openInEditor reusa con Escape + :e si la sesión existe', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('ls')) return 'api-edit\nother\n';
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'src/a.js', exec });
  assert.equal(r.ok, true);
  assert.ok(calls.some((c) => c.includes('send-keys') && c.includes('Escape')), 'manda Escape');
  assert.ok(calls.some((c) => c.includes('send-keys') && c.includes('-l') && c.includes(':e src/a.js')), 'manda :e');
  assert.ok(!calls.some((c) => c.includes('new-session')), 'no crea sesión');
});

test('openInEditor rechaza path con prefijo - sin tocar tmux', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: '-rf', exec });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
