import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorSessionName, openInEditor } from './editor.js';

test('editorSessionName sufija -edit', () => {
  assert.equal(editorSessionName('proj-feat'), 'proj-feat-edit');
});

test('openInEditor crea sesión persistente (sin nvim en new-session) y lanza editor con send-keys', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('ls')) return ''; // ninguna sesión
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'src/a.js', exec });
  assert.equal(r.ok, true);
  assert.equal(r.tmux, 'api-edit');

  // new-session NO debe tener nvim en el argv (sesión persistente, sin comando)
  const created = calls.find((c) => c.includes('new-session'));
  assert.ok(created, 'debe crear la sesión');
  assert.ok(!created.includes('nvim'), 'new-session no debe incluir nvim (sesión persistente)');
  // forma: tmux new-session -d -s api-edit -c /wt/api  (sin comando trailing)
  const nsIdx = created.indexOf('new-session');
  const afterNs = created.slice(nsIdx + 1);
  assert.ok(afterNs.includes('-d'), 'debe tener -d');
  assert.ok(afterNs.includes('-s'), 'debe tener -s');
  assert.ok(afterNs.includes('api-edit'), 'debe tener nombre api-edit');
  assert.ok(afterNs.includes('-c'), 'debe tener -c');
  assert.ok(afterNs.includes('/wt/api'), 'debe tener el directorio');

  // send-keys debe llevar el comando del editor con el path shell-quoted
  const sk = calls.find((c) => c.includes('send-keys') && c.some((a) => a.includes('nvim')));
  assert.ok(sk, 'debe haber send-keys con nvim');
  const cmd = sk.find((a) => a.includes('nvim'));
  assert.ok(cmd.includes("'src/a.js'"), "el path debe estar entre comillas simples");
});

test('openInEditor shell-quoting: espacio y comilla simple en el nombre de archivo', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('ls')) return '';
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: "a b'c.js", exec });
  assert.equal(r.ok, true);
  const sk = calls.find((c) => c.includes('send-keys') && c.some((a) => a.includes('nvim')));
  assert.ok(sk, 'debe haber send-keys con nvim');
  const cmd = sk.find((a) => a.includes('nvim'));
  // shellQuote("a b'c.js") → 'a b'\''c.js'
  assert.ok(cmd.includes("'a b'\\''c.js'"), "comilla simple debe escaparse como '\\''");
});

test('openInEditor cmd override: vim en vez de nvim', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('ls')) return '';
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'src/a.js', cmd: 'vim', exec });
  assert.equal(r.ok, true);
  const sk = calls.find((c) => c.includes('send-keys') && c.some((a) => a.includes('vim')));
  assert.ok(sk, 'debe haber send-keys con vim');
  const cmd = sk.find((a) => a.includes('vim'));
  assert.ok(cmd.startsWith('vim -- '), "el comando debe empezar con 'vim -- '");
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

test('openInEditor reuse escapa | en el nombre de archivo', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('ls')) return 'api-edit\n';
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'a|b.js', exec });
  assert.equal(r.ok, true);
  assert.ok(
    calls.some((c) => c.includes('send-keys') && c.includes('-l') && c.includes(':e a\\|b.js')),
    'el | debe estar escapado como \\| en el comando :e'
  );
});

test('openInEditor rechaza path con caracter de control sin llamar a exec', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'a\nb.js', exec });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'exec no debe ser llamado con rutas de control');
});
