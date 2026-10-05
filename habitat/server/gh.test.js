import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prCreate, parseRepo, repoList, repoClone, CLONE_TIMEOUT_MS } from './gh.js';

const gitStub = (a) => {
  if (a.includes('symbolic-ref')) return 'origin/main\n';
  if (a.includes('--abbrev-ref HEAD')) return 'feature/x\n';
  return null;
};

test('prCreate llama gh con --base y --head y devuelve la url', async () => {
  let ghArgs;
  const exec = async (file, args) => {
    const a = args.join(' ');
    const g = gitStub(a);
    if (g !== null) return g;
    if (file === 'gh') { ghArgs = args; return 'https://github.com/o/r/pull/7\n'; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://github.com/o/r/pull/7');
  assert.deepEqual(ghArgs, [
    'pr', 'create', '--base', 'main', '--head', 'feature/x', '--fill',
  ]);
});

test('prCreate avisa si gh no está instalado', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return ''; // sólo el llamado a gh debe fallar
    ghCalled = true;
    const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(ghCalled, true);
  assert.equal(r.ok, false);
  assert.ok(/no está instalado/.test(r.message));
});

test('prCreate avisa si gh no está autenticado', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return '';
    ghCalled = true;
    const e = new Error('x'); e.code = 4;
    e.stderr = 'gh: To get started with GitHub CLI, please run: gh auth login';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(ghCalled, true);
  assert.equal(r.ok, false);
  assert.ok(/gh auth login/.test(r.message));
});

test('prCreate devuelve la url si el PR ya existe', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return '';
    ghCalled = true;
    const e = new Error('x'); e.code = 1;
    e.stderr = 'a pull request for branch "feature/x" already exists:\nhttps://github.com/o/r/pull/3';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(ghCalled, true);
  assert.equal(r.ok, false);
  assert.equal(r.url, 'https://github.com/o/r/pull/3');
  assert.ok(/ya existe/.test(r.message));
});

test('prCreate rechaza branch actual inválida sin llamar gh', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'HEAD\n'; // detached
    if (file === 'gh') { ghCalled = true; return ''; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(ghCalled, false);
});

// --- Hallazgo 1: base mal derivada cuando origin/HEAD no está seteado ---

test('prCreate no mutila una rama con "/" cuando falta origin/HEAD (fallback a la rama actual)', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) throw new Error('no hay origin/HEAD');
    if (a.includes('remote set-head')) throw new Error('sin remoto utilizable (offline)');
    if (a.includes('--abbrev-ref HEAD')) return 'feature/x\n'; // currentBranch, también usado como fallback
    if (file === 'gh') { ghCalled = true; return ''; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(ghCalled, false, 'no debe invocar gh con una base inventada/mutilada');
  assert.ok(r.message && r.message.length > 0);
});

test('prCreate rechaza base===head cuando falta origin/HEAD y la rama no tiene "/"', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) throw new Error('no hay origin/HEAD');
    if (a.includes('remote set-head')) throw new Error('sin remoto utilizable (offline)');
    if (a.includes('--abbrev-ref HEAD')) return 'main\n';
    if (file === 'gh') { ghCalled = true; return ''; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(ghCalled, false);
});

// --- Hallazgo 2: fallback genérico con stderr vacío ---

test('prCreate no deja el mensaje vacío cuando el error no trae stderr (EACCES, ENOTFOUND, etc.)', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return '';
    const e = new Error('EACCES'); e.code = 'EACCES'; // sin stderr ni stdout
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.ok(r.message && r.message.trim().length > 0, 'el mensaje no debe quedar vacío');
  assert.ok(/EACCES/.test(r.message));
});

// --- Hallazgo 3: firstUrl toma cualquier URL, no la del PR ---

test('prCreate ignora URLs ajenas al PR (banner/manual de gh) antes de la url real', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file === 'gh') return 'https://cli.github.com/manual\nhttps://github.com/o/r/pull/7\n';
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://github.com/o/r/pull/7');
});

test('prCreate no arrastra puntuación pegada ni URLs ajenas cuando el PR ya existe', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return '';
    const e = new Error('x'); e.code = 1;
    e.stderr = 'gh: A new release of gh is available: https://github.com/cli/cli/releases/tag/v2.0\n'
      + 'a pull request for branch "feature/x" already exists:\n(https://github.com/o/r/pull/3).';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(r.url, 'https://github.com/o/r/pull/3');
  assert.ok(/ya existe/.test(r.message));
});

// --- I4/I6: opts del exec de gh ---
// prCreate corre `gh` directamente (sin -C): necesita el cwd real en los opts, y sin
// timeout se cuelga con el lock del repo tomado. Con el defaultExec de aridad 2 que
// tenían git-read/git-write ese tercer argumento se descartaba en silencio y el PR se
// habría abierto en el repo del proceso del server.
test('prCreate pasa cwd y timeout en los opts del exec de gh', async () => {
  let ghOpts;
  const exec = async (file, args, opts) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file === 'gh') { ghOpts = opts; return 'https://github.com/o/r/pull/7\n'; }
    return '';
  };
  await prCreate('/proj', exec);
  assert.equal(ghOpts.cwd, '/proj');
  assert.ok(typeof ghOpts.timeout === 'number' && ghOpts.timeout > 0);
});

test('prCreate traduce el timeout a un mensaje en español', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    if (file !== 'gh') return '';
    const e = new Error('Command failed: gh pr create');
    e.killed = true; e.signal = 'SIGTERM';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.ok(/tardó demasiado/.test(r.message), r.message);
});

test('parseRepo acepta owner/name y rechaza formatos raros', () => {
  assert.deepEqual(parseRepo('MNONM-SOFTWARE/habitat.v2'), { owner: 'MNONM-SOFTWARE', name: 'habitat.v2' });
  for (const bad of ['', 'x', 'a/b/c', '../x', 'a/..', 'a/.', '-a/b', 'a/b c', 'a/-b', null, 7]) {
    assert.equal(parseRepo(bad), null, String(bad));
  }
});

test('repoList llama gh repo list con --json y parsea', async () => {
  let call;
  const exec = async (file, args, opts) => {
    call = { file, args, opts };
    return JSON.stringify([{ name: 'r', nameWithOwner: 'o/r', description: null, isPrivate: true, updatedAt: '2026-01-01T00:00:00Z' }]);
  };
  const r = await repoList('o', exec);
  assert.equal(r.ok, true);
  assert.deepEqual(r.repos, [{ name: 'r', nameWithOwner: 'o/r', description: '', isPrivate: true, updatedAt: '2026-01-01T00:00:00Z' }]);
  assert.equal(call.file, 'gh');
  assert.deepEqual(call.args, ['repo', 'list', 'o', '--limit', '200', '--json', 'name,nameWithOwner,description,isPrivate,updatedAt']);
  assert.ok(call.opts.timeout > 0);
});

test('repoList traduce gh no autenticado', async () => {
  const exec = async () => { const e = new Error('x'); e.stderr = 'please run: gh auth login'; throw e; };
  const r = await repoList('o', exec);
  assert.equal(r.ok, false);
  assert.ok(/gh auth login/.test(r.message));
});

test('repoClone llama gh repo clone por https al destino con timeout largo', async () => {
  let call;
  const exec = async (file, args, opts) => { call = { file, args, opts }; return ''; };
  const r = await repoClone('o/r', '/root/r', exec);
  assert.equal(r.ok, true);
  assert.equal(call.file, 'gh');
  assert.deepEqual(call.args, ['repo', 'clone', 'https://github.com/o/r.git', '/root/r']);
  assert.equal(call.opts.timeout, CLONE_TIMEOUT_MS);
});

test('repoClone avisa si gh no está instalado', async () => {
  const exec = async () => { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; };
  const r = await repoClone('o/r', '/root/r', exec);
  assert.equal(r.ok, false);
  assert.ok(/no está instalado/.test(r.message));
});
