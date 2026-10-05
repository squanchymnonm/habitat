import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listStacks, stacksForDir, composeDown, downForDir, downOrphans, PS_FORMAT, containerStates, stateForDir, STATE_FORMAT } from './docker.js';

// Salida típica de `docker ps -a --format '<proyecto>\t<working_dir>'`.
const psOut = (rows) => rows.map(([p, d]) => `${p}\t${d}`).join('\n') + '\n';

const ROOT = '/home/u/habitat-worktrees';
const WT = `${ROOT}/Artisano/yoshi`;

test('listStacks parsea proyecto + working_dir y deduplica por proyecto', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    return psOut([['artisano-yoshi', WT], ['artisano-yoshi', WT], ['olympus', '/home/u/Olympus/infra']]);
  };
  assert.deepEqual(await listStacks(exec), [
    { project: 'artisano-yoshi', dir: WT },
    { project: 'olympus', dir: '/home/u/Olympus/infra' },
  ]);
  assert.deepEqual(calls[0], ['docker', 'ps', '-a', '--format', PS_FORMAT]);
});

test('listStacks ignora containers sin labels de compose', async () => {
  const exec = async () => `\t\nsolo-proyecto\t\n\t/algun/dir\n${psOut([['ok', WT]])}`;
  assert.deepEqual(await listStacks(exec), [{ project: 'ok', dir: WT }]);
});

test('listStacks sin docker instalado devuelve []', async () => {
  const exec = async () => { throw new Error('docker: not found'); };
  assert.deepEqual(await listStacks(exec), []);
});

test('stacksForDir toma el dir exacto y sus subdirectorios', async () => {
  const exec = async () => psOut([
    ['exacto', WT],
    ['anidado', `${WT}/infra`],
    ['otra-rama', `${ROOT}/Artisano/mario`],
    ['produccion', '/home/u/Olympus/infra'],
  ]);
  assert.deepEqual(await stacksForDir(WT, exec), ['exacto', 'anidado']);
});

test('stacksForDir no matchea un prefijo parcial de path', async () => {
  // /a/b no debe llevarse puesto /a/bc: el separador es obligatorio.
  const exec = async () => psOut([['vecino', '/a/bc'], ['hijo', '/a/b/x']]);
  assert.deepEqual(await stacksForDir('/a/b', exec), ['hijo']);
});

test('stacksForDir sin dir no consulta docker', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.deepEqual(await stacksForDir('', exec), []);
  assert.equal(called, false);
});

test('composeDown corre `docker compose -p <proj> down --remove-orphans` (sin -v)', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await composeDown('artisano-yoshi', exec), true);
  assert.deepEqual(calls[0], ['docker', 'compose', '-p', 'artisano-yoshi', 'down', '--remove-orphans']);
});

test('composeDown ante error devuelve false', async () => {
  const exec = async () => { throw new Error('daemon down'); };
  assert.equal(await composeDown('x', exec), false);
});

test('downForDir baja cada stack del worktree y devuelve los nombres', async () => {
  const downs = [];
  const exec = async (file, args) => {
    if (args[0] === 'ps') return psOut([['a', WT], ['b', `${WT}/infra`], ['produccion', '/home/u/Olympus/infra']]);
    downs.push(args[2]);
    return '';
  };
  assert.deepEqual(await downForDir(WT, { root: ROOT, exec }), ['a', 'b']);
  assert.deepEqual(downs, ['a', 'b']);
});

test('downForDir rechaza dirs fuera del root de worktrees', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  for (const dir of ['/home/u/Olympus', '/', '', ROOT, `${ROOT}x/p/b`, `${ROOT}/../Olympus`]) {
    assert.deepEqual(await downForDir(dir, { root: ROOT, exec }), [], `no debería tocar ${dir}`);
  }
  assert.equal(called, false);
});

test('downForDir sin root no hace nada', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.deepEqual(await downForDir(WT, { root: '', exec }), []);
  assert.equal(called, false);
});

test('downOrphans baja sólo los stacks cuyo worktree ya no existe', async () => {
  const downs = [];
  const exec = async (file, args) => {
    if (args[0] === 'ps') {
      return psOut([
        ['vivo', `${ROOT}/Artisano/yoshi`],
        ['huerfano', `${ROOT}/Artisano/mario`],
        ['produccion', '/home/u/Olympus/infra'],
      ]);
    }
    downs.push(args[2]);
    return '';
  };
  const exists = (p) => p === `${ROOT}/Artisano/yoshi`;
  assert.deepEqual(await downOrphans(ROOT, { exec, exists }), ['huerfano']);
  assert.deepEqual(downs, ['huerfano']);
});

test('downOrphans sin root no consulta docker', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.deepEqual(await downOrphans('', { exec, exists: () => false }), []);
  assert.equal(called, false);
});

test('downForDir con dryRun lista sin bajar nada', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args[0]);
    if (args[0] === 'ps') return psOut([['a', WT]]);
    return '';
  };
  assert.deepEqual(await downForDir(WT, { root: ROOT, exec, dryRun: true }), ['a']);
  assert.deepEqual(calls, ['ps']);
});

test('containerStates parsea working_dir y estado; sin docker devuelve []', async () => {
  let args;
  const exec = async (f, a) => { args = a; return '/wt/a/infra\trunning\n/wt/a/infra\texited\n\trunning\n/otro\trunning\n'; };
  const r = await containerStates(exec);
  assert.deepEqual(args, ['ps', '-a', '--format', STATE_FORMAT]);
  assert.deepEqual(r, [{ dir: '/wt/a/infra', state: 'running' }, { dir: '/wt/a/infra', state: 'exited' }, { dir: '/otro', state: 'running' }]);
  assert.deepEqual(await containerStates(async () => { throw new Error('no docker'); }), []);
});

test('stateForDir: up, partial u off según los containers dentro de dir', () => {
  const cs = [{ dir: '/wt/a/infra', state: 'running' }, { dir: '/wt/a/infra/sub', state: 'running' }, { dir: '/wt/b/infra', state: 'exited' }, { dir: '/wt/b/infra', state: 'running' }];
  assert.equal(stateForDir(cs, '/wt/a/infra'), 'up');
  assert.equal(stateForDir(cs, '/wt/b/infra'), 'partial');
  assert.equal(stateForDir(cs, '/wt/c'), 'off');
  assert.equal(stateForDir(cs, '/wt/a/inf'), 'off'); // contención por segmento
});
