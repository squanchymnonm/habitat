import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
  currentBranch, remoteDefaultBranch, ensureContainerRepo, containerWorktreeAdd,
} from './git.js';

test('validBranch acepta nombres seguros y rechaza inválidos', () => {
  assert.equal(validBranch('feature/x'), true);
  assert.equal(validBranch('fix-123_a.b'), true);
  assert.equal(validBranch(''), false);
  assert.equal(validBranch('a b'), false);
  assert.equal(validBranch('../evil'), false);
  assert.equal(validBranch('a;rm -rf'), false);
  assert.equal(validBranch('-b'), false);
  assert.equal(validBranch('--force'), false);
});

test('worktreeAdd rechaza base/path con prefijo - (flag smuggling)', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeAdd('/proj', 'feat', '--foo', '/wt/x', exec), false);
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '-rf', exec), false);
  assert.equal(called, false);
});

test('branchExists true cuando rev-parse no falla', async () => {
  const exec = async (file, args) => {
    assert.equal(file, 'git');
    assert.deepEqual(args, ['-C', '/proj', 'rev-parse', '--verify', '--quiet', 'refs/heads/feat']);
    return 'abc123\n';
  };
  assert.equal(await branchExists('/proj', 'feat', exec), true);
});

test('branchExists false cuando rev-parse falla', async () => {
  const exec = async () => { throw new Error('unknown revision'); };
  assert.equal(await branchExists('/proj', 'nope', exec), false);
});

test('worktreeAdd con rama nueva usa -b y la base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) throw new Error('no existe'); // rama nueva
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feature/x', 'main', '/wt/proj/feature-x', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '-b', 'feature/x', '/wt/proj/feature-x', 'main',
  ]);
});

test('worktreeAdd con rama existente no usa -b ni base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) return 'abc\n'; // rama existe
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '/wt/proj/feat', 'feat',
  ]);
});

test('worktreeAdd con branch inválida devuelve false sin ejecutar', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeAdd('/proj', '../evil', 'main', '/wt/x', exec), false);
  assert.equal(called, false);
});

test('worktreeAdd ante fallo de git devuelve false', async () => {
  const exec = async (file, args) => {
    if (args.includes('list')) return '';
    if (args.includes('rev-parse')) throw new Error('no existe');
    throw new Error('worktree add failed');
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/feat', exec), false);
});

test('worktreeAdd reutiliza el worktree existente de la rama (sesión cerrada sin limpiar)', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('list')) {
      return 'worktree /wt/proj/feat\nHEAD abc123\nbranch refs/heads/feat\n\n';
    }
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec);
  assert.equal(ok, true);
  assert.ok(!calls.some((c) => c.includes('worktree add')), 'no debe ejecutar worktree add');
});

test('worktreeAdd no secuestra una rama en uso en otra ruta -> false', async () => {
  const exec = async (file, args) => {
    if (args.includes('list')) return 'worktree /otro/lado\nHEAD abc123\nbranch refs/heads/feat\n\n';
    return '';
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec), false);
});

test('worktreeRemove ejecuta git worktree remove y devuelve true', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'remove', '/wt/proj/feat',
  ]);
});

test('worktreeRemove rechaza path con prefijo - (flag smuggling) sin ejecutar', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeRemove('/proj', '-rf', {}, exec), false);
  assert.equal(called, false);
});

test('worktreeRemove ante fallo de git (worktree sucio) devuelve false', async () => {
  const exec = async () => { throw new Error('contains modified or untracked files'); };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), false);
});

test('worktreeRemove con force:true agrega --force', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', { force: true }, exec), true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'remove', '--force', '/wt/proj/feat',
  ]);
});

test('findNestedRepos devuelve las subcarpetas con .git, ordenadas', async () => {
  const deps = {
    readdir: async () => ([
      { name: 'front', isDirectory: () => true },
      { name: 'back', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false },
      { name: 'docs', isDirectory: () => true },
    ]),
    stat: async (p) => {
      if (p.endsWith('/back/.git') || p.endsWith('/front/.git')) return {};
      throw new Error('ENOENT');
    },
  };
  assert.deepEqual(await findNestedRepos('/proj', deps), ['back', 'front']);
});

test('findNestedRepos devuelve [] si el dir no existe', async () => {
  const deps = { readdir: async () => { throw new Error('ENOENT'); }, stat: async () => ({}) };
  assert.deepEqual(await findNestedRepos('/nope', deps), []);
});

test('currentBranch devuelve la rama actual trimmeada', async () => {
  const exec = async (file, args) => {
    assert.deepEqual(args, ['-C', '/proj', 'rev-parse', '--abbrev-ref', 'HEAD']);
    return 'develop\n';
  };
  assert.equal(await currentBranch('/proj', exec), 'develop');
});

test('currentBranch devuelve "" ante error', async () => {
  const exec = async () => { throw new Error('not a repo'); };
  assert.equal(await currentBranch('/proj', exec), '');
});

test('remoteDefaultBranch lee origin/HEAD', async () => {
  const exec = async (file, args) => {
    if (args.includes('symbolic-ref')) return 'origin/main\n';
    throw new Error('inesperado');
  };
  assert.equal(await remoteDefaultBranch('/proj', exec), 'origin/main');
});

test('remoteDefaultBranch hace set-head y reintenta cuando origin/HEAD falta', async () => {
  const calls = [];
  let symbolicTries = 0;
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('symbolic-ref')) {
      symbolicTries += 1;
      if (symbolicTries === 1) throw new Error('no ref');
      return 'origin/develop\n';
    }
    if (args.includes('set-head')) return '';
    throw new Error('inesperado');
  };
  assert.equal(await remoteDefaultBranch('/proj', exec), 'origin/develop');
  assert.ok(calls.some((c) => c.includes('remote set-head origin -a')));
});

test('remoteDefaultBranch cae a currentBranch si no hay remoto', async () => {
  const exec = async (file, args) => {
    if (args.includes('symbolic-ref')) throw new Error('no ref');
    if (args.includes('set-head')) throw new Error('no origin');
    if (args.includes('rev-parse')) return 'main\n';
    throw new Error('inesperado');
  };
  assert.equal(await remoteDefaultBranch('/proj', exec), 'main');
});

test('ensureContainerRepo no toca un repo ya inicializado', async () => {
  let execCalled = false;
  const exec = async () => { execCalled = true; return ''; };
  const deps = { access: async () => ({}) }; // .git existe
  assert.equal(await ensureContainerRepo('/proj', ['back'], exec, deps), true);
  assert.equal(execCalled, false);
});

test('ensureContainerRepo inicializa: init + gitignore + add + commit', async () => {
  const calls = [];
  let written = null;
  const exec = async (file, args) => { calls.push(args.join(' ')); return ''; };
  const deps = {
    access: async () => { throw new Error('no .git'); }, // hay que inicializar
    readFile: async () => { throw new Error('no .gitignore'); },
    writeFile: async (p, body) => { written = { p, body }; },
  };
  assert.equal(await ensureContainerRepo('/proj', ['back', 'front'], exec, deps), true);
  assert.ok(calls.some((c) => c.endsWith('-C /proj init')));
  assert.ok(calls.some((c) => c.includes('add -A')));
  assert.ok(calls.some((c) => c.includes('commit')));
  assert.ok(written.p.endsWith('/proj/.gitignore'));
  assert.ok(written.body.includes('back/'));
  assert.ok(written.body.includes('front/'));
  assert.ok(written.body.includes('.env'), '.env debe estar en el .gitignore');
  assert.ok(written.body.includes('*.key'), '*.key debe estar en el .gitignore');
});

test('ensureContainerRepo no pisa entradas existentes del .gitignore', async () => {
  let written = null;
  const exec = async () => '';
  const deps = {
    access: async () => { throw new Error('no .git'); },
    readFile: async () => 'node_modules/\nback/\n', // back ya está
    writeFile: async (p, body) => { written = body; },
  };
  await ensureContainerRepo('/proj', ['back', 'front'], exec, deps);
  assert.ok(written.includes('node_modules/'));
  assert.ok(written.includes('front/'));
  // 'back/' aparece una sola vez
  assert.equal(written.split('\n').filter((l) => l.trim() === 'back/').length, 1);
  // patrones de secreto también presentes
  assert.ok(written.includes('.env'), '.env debe añadirse a líneas existentes');
  assert.ok(written.includes('*.key'), '*.key debe añadirse a líneas existentes');
});

test('ensureContainerRepo devuelve false ante error de exec', async () => {
  const exec = async () => { throw new Error('git init falló'); };
  const deps = {
    access: async () => { throw new Error('no .git'); },
    readFile: async () => { throw new Error('no .gitignore'); },
    writeFile: async () => {},
  };
  assert.equal(await ensureContainerRepo('/proj', ['back'], exec, deps), false);
});

// exec fake que simula un contenedor sano: padre ya es repo, hijos tienen origin/main.
function containerExec(record) {
  return async (file, args) => {
    record.push(args.join(' '));
    if (args.includes('rev-parse') && args.includes('--abbrev-ref')) return 'main\n'; // currentBranch
    if (args.includes('symbolic-ref')) return 'origin/main\n';                        // remoteDefault
    if (args.includes('rev-parse') && args.includes('--verify')) throw new Error('rama nueva'); // branchExists
    return ''; // init/add/commit/fetch/worktree add/list/remove
  };
}

test('containerWorktreeAdd crea worktree del padre y de cada hijo', async () => {
  const record = [];
  const deps = { access: async () => ({}) }; // padre ya es repo (ensureContainerRepo no inicializa)
  const ok = await containerWorktreeAdd(
    '/proj', 'feature/x', '/wt/proj/feature-x', ['back', 'front'], containerExec(record), deps,
  );
  assert.equal(ok, true);
  // worktree add del padre en wtPath
  assert.ok(record.some((c) => c === '-C /proj worktree add -b feature/x /wt/proj/feature-x main'));
  // worktree add de cada hijo en wtPath/<repo> con base origin/main
  assert.ok(record.some((c) => c === '-C /proj/back worktree add -b feature/x /wt/proj/feature-x/back origin/main'));
  assert.ok(record.some((c) => c === '-C /proj/front worktree add -b feature/x /wt/proj/feature-x/front origin/main'));
});

test('containerWorktreeAdd hace fetch best-effort (un fetch que falla no aborta)', async () => {
  const record = [];
  const exec = async (file, args) => {
    record.push(args.join(' '));
    if (args.includes('fetch')) throw new Error('offline');
    if (args.includes('rev-parse') && args.includes('--abbrev-ref')) return 'main\n';
    if (args.includes('symbolic-ref')) return 'origin/main\n';
    if (args.includes('rev-parse') && args.includes('--verify')) throw new Error('rama nueva');
    return '';
  };
  const ok = await containerWorktreeAdd('/proj', 'feat', '/wt/proj/feat', ['back'], exec, { access: async () => ({}) });
  assert.equal(ok, true);
  assert.ok(record.some((c) => c.includes('fetch origin')));
});

test('containerWorktreeAdd hace rollback (force) si un hijo falla', async () => {
  const record = [];
  const removes = [];
  const exec = async (file, args) => {
    record.push(args.join(' '));
    if (args.includes('worktree') && args.includes('remove')) { removes.push(args.join(' ')); return ''; }
    if (args.includes('rev-parse') && args.includes('--abbrev-ref')) return 'main\n';
    if (args.includes('symbolic-ref')) return 'origin/main\n';
    if (args.includes('rev-parse') && args.includes('--verify')) throw new Error('rama nueva');
    // el worktree add del segundo hijo falla
    if (args.includes('worktree') && args.includes('add') && args.includes('/wt/p/f/front')) {
      throw new Error('add falló');
    }
    return '';
  };
  const ok = await containerWorktreeAdd('/proj', 'f', '/wt/p/f', ['back', 'front'], exec, { access: async () => ({}) });
  assert.equal(ok, false);
  // rollback en orden inverso: primero el hijo creado (back), después el padre, ambos con --force
  assert.deepEqual(removes, [
    '-C /proj/back worktree remove --force /wt/p/f/back',
    '-C /proj worktree remove --force /wt/p/f',
  ]);
});

test('containerWorktreeAdd devuelve false si ensureContainerRepo falla', async () => {
  const exec = async (file, args) => {
    if (args.includes('init')) throw new Error('init falló');
    return '';
  };
  // access falla -> intenta init -> init tira -> ensureContainerRepo false
  const deps = { access: async () => { throw new Error('no .git'); }, readFile: async () => '', writeFile: async () => {} };
  const ok = await containerWorktreeAdd('/proj', 'f', '/wt/p/f', ['back'], exec, deps);
  assert.equal(ok, false);
});
