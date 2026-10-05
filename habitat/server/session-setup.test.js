import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as realGit from './git.js';
import { createEnvStore } from './env-store.js';
import { prepareSession, teardownRelated, claudeLocal, RELATED_DIR } from './session-setup.js';

const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' }).toString();
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-b', 'main');
  gitIn(dir, 'config', 'user.email', 't@l'); gitIn(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-m', 'init');
}
const git = {
  worktreeAdd: realGit.worktreeAdd, worktreeRemove: realGit.worktreeRemove,
  remoteDefaultBranch: realGit.remoteDefaultBranch, exec: realGit.defaultExec,
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'habitat-setup-'));
  const back = join(root, 'back');
  const infraRepo = join(root, 'docker');
  initRepo(back); initRepo(infraRepo);
  const wtPath = join(root, 'wt', 'back', 'bob');
  gitIn(back, 'worktree', 'add', '-b', 'bob', wtPath, 'main'); // el worktree principal lo crea el caller
  const project = {
    dir: back, related: [{ dir: infraRepo, name: 'infra' }],
    infra: { repo: 'infra', path: '', up: 'make up', down: '' },
    envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: 'cfg/.env' }],
  };
  const envStore = createEnvStore();
  envStore.set('back', 'self', '.env', 'DB_PORT={{port:db}}\n');
  envStore.set('back', 'infra', 'cfg/.env', 'COMPOSE_PROJECT_NAME={{stack}}\nAPP={{path:self}}\nDB={{port:db}}\nWEB={{port:web}}\n');
  return { root, back, infraRepo, wtPath, project, envStore };
}
const allocate = async (names) => ({ ok: true, ports: Object.fromEntries(names.map((n, i) => [n, 21000 + i])) });

test('prepareSession arma relacionados, .env, CLAUDE.local.md y exclude', async () => {
  const f = fixture();
  try {
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.equal(r.ok, true, r.error);
    const infraWt = join(f.wtPath, RELATED_DIR, 'infra');
    assert.deepEqual(r.infra, { stack: 'back-bob', ports: { db: 21000, web: 21001 }, dir: infraWt, branch: 'bob' });
    assert.equal(gitIn(infraWt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'bob');
    assert.equal(readFileSync(join(f.wtPath, '.env'), 'utf8'), 'DB_PORT=21000\n');
    assert.equal(readFileSync(join(infraWt, 'cfg/.env'), 'utf8'),
      `COMPOSE_PROJECT_NAME=back-bob\nAPP=${f.wtPath}\nDB=21000\nWEB=21001\n`);
    assert.equal(statSync(join(infraWt, 'cfg/.env')).mode & 0o777, 0o600);
    const md = readFileSync(join(f.wtPath, 'CLAUDE.local.md'), 'utf8');
    assert.match(md, /make up/);
    assert.match(md, /db → localhost:21000/);
    assert.match(md, /\.habitat-related\/infra/);
    // nada de lo generado ensucia git status
    assert.equal(gitIn(f.wtPath, 'status', '--porcelain'), '');
    assert.equal(gitIn(infraWt, 'status', '--porcelain'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('prepareSession con relacionado inexistente hace rollback y explica', async () => {
  const f = fixture();
  try {
    f.project.related.push({ dir: join(f.root, 'no-existe'), name: 'front' });
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.deepEqual(r, { ok: false, error: 'el repo relacionado front no existe' });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false); // rollback del ya creado
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('prepareSession falla con variable desconocida o sin puertos, con rollback', async () => {
  const f = fixture();
  try {
    f.envStore.set('back', 'self', '.env', 'X={{path:front}}');
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.deepEqual(r, { ok: false, error: 'plantilla self/.env: variables desconocidas: {{path:front}}' });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false);
    f.envStore.set('back', 'self', '.env', 'X={{port:db}}');
    const r2 = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore,
      allocate: async () => ({ ok: false, error: 'no hay puertos libres en 1-1' }), git });
    assert.deepEqual(r2, { ok: false, error: 'no hay puertos libres en 1-1' });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('teardownRelated remueve worktrees limpios y borra su rama; conserva los sucios', async () => {
  const f = fixture();
  try {
    const front = join(f.root, 'front'); initRepo(front);
    f.project.related.push({ dir: front, name: 'front' });
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.equal(r.ok, true, r.error);
    writeFileSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt'), 'wip'); // front queda sucio
    await teardownRelated({ related: f.project.related, branch: 'bob', wtPath: f.wtPath, git });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false);
    assert.equal(gitIn(f.infraRepo, 'branch', '--list', 'bob').trim(), ''); // rama sin commits: borrada
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt')), true);
    assert.match(gitIn(front, 'branch', '--list', 'bob'), /bob/);
    // con los relacionados limpios fuera, el principal se puede remover sin --force
    rmSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt'));
    await teardownRelated({ related: f.project.related, branch: 'bob', wtPath: f.wtPath, git });
    assert.equal(await realGit.worktreeRemove(f.back, f.wtPath), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('prepareSession rechaza un symlink que escape del worktree (ruta inválida)', async () => {
  const f = fixture();
  try {
    const outside = join(f.root, 'outside');
    mkdirSync(outside, { recursive: true });
    // 'cfg' es un symlink hacia afuera del repo, commiteado para que aparezca igual en
    // el worktree relacionado; el envFile 'cfg/.env' debería resolver ahí adentro.
    symlinkSync(outside, join(f.infraRepo, 'cfg'), 'dir');
    gitIn(f.infraRepo, 'add', '-A');
    gitIn(f.infraRepo, 'commit', '-m', 'symlink cfg -> outside');
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.deepEqual(r, { ok: false, error: 'plantilla infra/cfg/.env: ruta inválida' });
    assert.equal(existsSync(join(outside, '.env')), false); // no escribió afuera
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false); // rollback del relacionado
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('claudeLocal sin infra ni puertos sólo lista relacionados', () => {
  const md = claudeLocal({ branch: 'b', stack: 's', ports: {}, infra: null, infraDirRel: null, related: [{ name: 'front' }] });
  assert.doesNotMatch(md, /Infra/);
  assert.match(md, /front: `\.habitat-related\/front`/);
});
