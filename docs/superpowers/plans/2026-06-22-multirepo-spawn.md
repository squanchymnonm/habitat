# Spawn multi-repo para proyectos contenedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `POST /spawn` con rama funcione sobre proyectos que son contenedores de varios repos git (caso Artisano: `back/front/ceo/server`), creando un worktree de la rama en el repo padre y en cada hijo, con rollback total; y que `/kill` limpie todos los worktrees.

**Architecture:** Toda la lógica nueva vive en `habitat/server/git.js` (detección de contenedor, auto-init del repo padre, resolución de base por repo, orquestación con rollback) y se cablea en `habitat/server/index.js` (`/spawn` y `/kill`). Las funciones reciben `exec`/`fs` inyectables para testear sin tocar git/disco reales, igual que el resto del server. `createApp` mergea el `git` inyectado sobre los defaults reales para no romper tests existentes.

**Tech Stack:** Node.js (ESM, `node:test`), `node:child_process` (`execFile`), `node:fs/promises`. Sin dependencias nuevas.

## Global Constraints

- ESM (`"type": "module"`); imports con extensión `.js`.
- Tests con `node --test` (script `test` en `habitat/package.json`). Se corren desde `habitat/`.
- Patrón de inyección: cada función de `git.js` recibe `exec = defaultExec` (y `fs`/`deps` cuando toca disco) como último(s) parámetro(s); el default es la implementación real.
- Toda función que invoca git va envuelta en try/catch y devuelve `boolean`/`''`/`[]` ante fallo (nunca tira). Patrón ya establecido en `git.js`.
- `validBranch` ya rechaza flag-smuggling (prefijo `-`, `..`, espacios). Reusarla, no reimplementar.
- Naming de rutas: `worktreePaths(WORKTREES_DIR, project, branch)` da `{ path, tmux }` con la rama sanitizada (`/`→`-`). No reimplementar.
- El modelo single-repo (proyecto que es un repo git sin sub-repos) NO debe cambiar de comportamiento.

---

## File Structure

- `habitat/server/git.js` — **modificar**: agregar `findNestedRepos`, `currentBranch`, `remoteDefaultBranch`, `ensureContainerRepo`, `containerWorktreeAdd`; cambiar firma de `worktreeRemove` (opción `force`).
- `habitat/server/git.test.js` — **modificar**: actualizar 3 tests de `worktreeRemove` a la nueva firma; agregar tests de las funciones nuevas.
- `habitat/server/index.js` — **modificar**: `createApp` mergea `git`; `/spawn` ramifica a modo contenedor; `/kill` limpia worktrees hijos + padre.
- `habitat/server/index.test.js` — **modificar**: agregar tests de `/spawn` y `/kill` en modo contenedor (los existentes quedan intactos).

---

## Task 1: `worktreeRemove` con opción `force`

**Files:**
- Modify: `habitat/server/git.js` (función `worktreeRemove`)
- Test: `habitat/server/git.test.js` (3 tests existentes + 1 nuevo)

**Interfaces:**
- Produces: `worktreeRemove(projectDir, path, { force = false } = {}, exec = defaultExec) → Promise<boolean>`. Con `force:true` agrega `--force` a `git worktree remove`. Sin opciones, comportamiento idéntico al actual.

- [ ] **Step 1: Escribir el test nuevo (falla)**

En `habitat/server/git.test.js`, agregar:

```js
test('worktreeRemove con force:true agrega --force', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', { force: true }, exec), true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'remove', '--force', '/wt/proj/feat',
  ]);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='worktreeRemove con force' 2>&1 | tail -20`
Expected: FAIL — con la firma actual `{ force: true }` cae en el parámetro `exec`, `await exec(...)` tira ("exec is not a function"), se captura y devuelve `false` (esperaba `true`).

- [ ] **Step 3: Cambiar la firma de `worktreeRemove`**

En `habitat/server/git.js`, reemplazar la función `worktreeRemove` por:

```js
// Quita el worktree al cerrar la sesión. Sin --force a propósito (default): si el worktree
// tiene cambios sin commitear git rechaza el remove y lo dejamos en disco (no destruimos
// trabajo); worktreeAdd lo reutilizará en el próximo spawn de esa rama. El rollback del
// spawn (worktrees recién creados, sin trabajo) sí pasa { force: true }.
export async function worktreeRemove(projectDir, path, { force = false } = {}, exec = defaultExec) {
  if (String(path).startsWith('-')) return false;
  try {
    const args = ['-C', projectDir, 'worktree', 'remove'];
    if (force) args.push('--force');
    args.push(path);
    await exec('git', args);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Actualizar los 3 tests existentes de `worktreeRemove` a la nueva firma**

En `habitat/server/git.test.js`, cambiar las llamadas que pasaban `exec` como 3er argumento para que pasen `{}` antes de `exec`:

```js
// test 'worktreeRemove ejecuta git worktree remove y devuelve true'
assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), true);

// test 'worktreeRemove rechaza path con prefijo - (flag smuggling) sin ejecutar'
assert.equal(await worktreeRemove('/proj', '-rf', {}, exec), false);

// test 'worktreeRemove ante fallo de git (worktree sucio) devuelve false'
assert.equal(await worktreeRemove('/proj', '/wt/proj/feat', {}, exec), false);
```

- [ ] **Step 5: Correr todos los tests de git y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js 2>&1 | tail -20`
Expected: PASS (todos, incluyendo el nuevo y los 3 actualizados).

- [ ] **Step 6: Commit**

```bash
cd habitat && git add server/git.js server/git.test.js
git commit -m "feat(habitat): worktreeRemove acepta opción force"
```

---

## Task 2: `findNestedRepos` — detección de contenedor

**Files:**
- Modify: `habitat/server/git.js` (nueva función + import de fs)
- Test: `habitat/server/git.test.js`

**Interfaces:**
- Produces: `findNestedRepos(dir, deps = {}) → Promise<string[]>`. Nombres (ordenados alfabéticamente) de las subcarpetas inmediatas de `dir` que contienen una entrada `.git`. `deps` permite inyectar `{ readdir, stat }`. Devuelve `[]` si `dir` no existe o no tiene sub-repos.

- [ ] **Step 1: Escribir los tests (fallan)**

En `habitat/server/git.test.js`, actualizar el import y agregar tests:

```js
// arriba, ampliar el import:
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
} from './git.js';

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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='findNestedRepos' 2>&1 | tail -20`
Expected: FAIL — `findNestedRepos is not a function` / no exportada.

- [ ] **Step 3: Implementar `findNestedRepos`**

En `habitat/server/git.js`, agregar el import de fs arriba (junto a los imports existentes):

```js
import { readdir as fsReaddir, stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';
```

Y agregar la función:

```js
// Subcarpetas inmediatas de `dir` que son repos git (tienen una entrada `.git`).
// Vacío si `dir` no existe o no tiene sub-repos. Define si un proyecto es "contenedor".
export async function findNestedRepos(dir, deps = {}) {
  const readdir = deps.readdir || fsReaddir;
  const stat = deps.stat || fsStat;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await stat(join(dir, e.name, '.git'));
      repos.push(e.name);
    } catch {
      // no es repo git
    }
  }
  return repos.sort();
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd habitat && git add server/git.js server/git.test.js
git commit -m "feat(habitat): findNestedRepos detecta proyectos contenedor"
```

---

## Task 3: `currentBranch` y `remoteDefaultBranch`

**Files:**
- Modify: `habitat/server/git.js`
- Test: `habitat/server/git.test.js`

**Interfaces:**
- Produces:
  - `currentBranch(repoDir, exec = defaultExec) → Promise<string>`: rama actual (`rev-parse --abbrev-ref HEAD`), `''` ante error.
  - `remoteDefaultBranch(repoDir, exec = defaultExec) → Promise<string>`: rama default del remoto como ref usable de start-point (ej. `origin/main`). Si `origin/HEAD` no está seteado, intenta `remote set-head origin -a` y reintenta. Último fallback: `currentBranch`.

- [ ] **Step 1: Escribir los tests (fallan)**

En `habitat/server/git.test.js`, ampliar el import y agregar:

```js
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
  currentBranch, remoteDefaultBranch,
} from './git.js';

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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='currentBranch|remoteDefaultBranch' 2>&1 | tail -20`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Implementar ambas funciones**

En `habitat/server/git.js`, agregar:

```js
// Rama actual de un repo (async). '' ante error. (gitBranch en tmux.js es la versión síncrona.)
export async function currentBranch(repoDir, exec = defaultExec) {
  try {
    return String(await exec('git', ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return '';
  }
}

// Rama default del remoto como ref de start-point (ej. 'origin/main'). Si origin/HEAD no está
// seteado, intenta resolverlo (remote set-head -a) y reintenta; último fallback: rama actual.
export async function remoteDefaultBranch(repoDir, exec = defaultExec) {
  const read = async () => String(
    await exec('git', ['-C', repoDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ).trim();
  try {
    const d = await read();
    if (d) return d;
  } catch { /* sin origin/HEAD: intentamos resolverlo abajo */ }
  try {
    await exec('git', ['-C', repoDir, 'remote', 'set-head', 'origin', '-a']);
    const d = await read();
    if (d) return d;
  } catch { /* sin remoto utilizable */ }
  return currentBranch(repoDir, exec);
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd habitat && git add server/git.js server/git.test.js
git commit -m "feat(habitat): currentBranch y remoteDefaultBranch"
```

---

## Task 4: `ensureContainerRepo` — auto-init del repo padre

**Files:**
- Modify: `habitat/server/git.js`
- Test: `habitat/server/git.test.js`

**Interfaces:**
- Produces: `ensureContainerRepo(dir, nested, exec = defaultExec, deps = {}) → Promise<boolean>`. Idempotente: si `dir/.git` existe, no hace nada y devuelve `true`. Si no, `git init` + asegura `.gitignore` con una línea `<repo>/` por cada hijo (sin pisar entradas existentes) + `git add -A` + commit con identidad explícita. `deps` inyecta `{ access, readFile, writeFile }`. `false` ante error de exec.

- [ ] **Step 1: Escribir los tests (fallan)**

En `habitat/server/git.test.js`, ampliar el import y agregar:

```js
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
  currentBranch, remoteDefaultBranch, ensureContainerRepo,
} from './git.js';

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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='ensureContainerRepo' 2>&1 | tail -20`
Expected: FAIL — función no exportada.

- [ ] **Step 3: Implementar `ensureContainerRepo`**

En `habitat/server/git.js`, ampliar el import de fs y agregar la función:

```js
// import de fs (ampliar el de Task 2):
import {
  readdir as fsReaddir, stat as fsStat,
  access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile,
} from 'node:fs/promises';
```

```js
// Asegura que el contenedor sea un repo git que versiona lo no-git de la raíz (.claude, docs, …).
// Idempotente. El .gitignore excluye cada sub-repo para que el worktree del padre no intente
// materializarlos (ahí van los worktrees de los hijos). Commit con identidad explícita para no
// depender de la config global de git.
export async function ensureContainerRepo(dir, nested, exec = defaultExec, deps = {}) {
  const access = deps.access || fsAccess;
  const readFile = deps.readFile || fsReadFile;
  const writeFile = deps.writeFile || fsWriteFile;
  try {
    await access(join(dir, '.git'));
    return true; // ya es repo
  } catch { /* falta .git: inicializar */ }
  try {
    await exec('git', ['-C', dir, 'init']);
    const giPath = join(dir, '.gitignore');
    let current = '';
    try { current = String(await readFile(giPath, 'utf8')); } catch { /* sin .gitignore previo */ }
    const lines = current.split('\n').map((l) => l.trim()).filter(Boolean);
    const has = new Set(lines);
    for (const name of nested) {
      if (!has.has(`${name}/`) && !has.has(name)) { lines.push(`${name}/`); has.add(`${name}/`); }
    }
    await writeFile(giPath, lines.join('\n') + '\n');
    await exec('git', ['-C', dir, 'add', '-A']);
    await exec('git', [
      '-C', dir,
      '-c', 'user.name=habitat', '-c', 'user.email=habitat@local',
      'commit', '--allow-empty', '-m', 'habitat: init container repo',
    ]);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd habitat && git add server/git.js server/git.test.js
git commit -m "feat(habitat): ensureContainerRepo auto-inicializa el repo padre"
```

---

## Task 5: `containerWorktreeAdd` — orquestación con rollback

**Files:**
- Modify: `habitat/server/git.js`
- Test: `habitat/server/git.test.js`

**Interfaces:**
- Consumes: `worktreeAdd`, `worktreeRemove({force})`, `currentBranch`, `remoteDefaultBranch`, `ensureContainerRepo` (de tasks 1, 3, 4).
- Produces: `containerWorktreeAdd(projectDir, branch, wtPath, nested, exec = defaultExec, deps = {}) → Promise<boolean>`. Crea worktree del padre (base = su rama actual) y de cada hijo en `join(wtPath, repo)` (base = `origin/HEAD`, con `git fetch origin` best-effort previo). Todo o nada: ante cualquier fallo, remueve los worktrees creados en orden inverso con `{ force: true }` y devuelve `false`.

- [ ] **Step 1: Escribir los tests (fallan)**

En `habitat/server/git.test.js`, ampliar el import y agregar:

```js
import {
  validBranch, branchExists, worktreeAdd, worktreeRemove, findNestedRepos,
  currentBranch, remoteDefaultBranch, ensureContainerRepo, containerWorktreeAdd,
} from './git.js';

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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='containerWorktreeAdd' 2>&1 | tail -20`
Expected: FAIL — función no exportada.

- [ ] **Step 3: Implementar `containerWorktreeAdd`**

En `habitat/server/git.js`, agregar:

```js
// Orquesta el worktree de un proyecto contenedor: padre + cada repo hijo, en la misma rama.
// Todo o nada: ante cualquier fallo, rollback de lo ya creado (en orden inverso, con --force
// porque son worktrees recién creados sin trabajo del usuario) y devuelve false.
export async function containerWorktreeAdd(projectDir, branch, wtPath, nested, exec = defaultExec, deps = {}) {
  if (!validBranch(branch)) return false;
  if (!(await ensureContainerRepo(projectDir, nested, exec, deps))) return false;
  const created = []; // [{ repoDir, path }] en orden de creación
  const rollback = async () => {
    for (const c of [...created].reverse()) {
      await worktreeRemove(c.repoDir, c.path, { force: true }, exec);
    }
  };
  // 1) padre primero: trae .claude/docs/.sdd; los hijos quedan ausentes (gitignored)
  const parentBase = (await currentBranch(projectDir, exec)) || 'HEAD';
  if (!(await worktreeAdd(projectDir, branch, parentBase, wtPath, exec))) {
    await rollback();
    return false;
  }
  created.push({ repoDir: projectDir, path: wtPath });
  // 2) cada hijo dentro del worktree del padre
  for (const name of nested) {
    const repoDir = join(projectDir, name);
    const childPath = join(wtPath, name);
    try { await exec('git', ['-C', repoDir, 'fetch', 'origin']); } catch { /* best-effort */ }
    const base = await remoteDefaultBranch(repoDir, exec);
    if (!(await worktreeAdd(repoDir, branch, base, childPath, exec))) {
      await rollback();
      return false;
    }
    created.push({ repoDir, path: childPath });
  }
  return true;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js 2>&1 | tail -20`
Expected: PASS (toda la suite de git).

- [ ] **Step 5: Commit**

```bash
cd habitat && git add server/git.js server/git.test.js
git commit -m "feat(habitat): containerWorktreeAdd con rollback total"
```

---

## Task 6: Cablear `/spawn` en modo contenedor

**Files:**
- Modify: `habitat/server/index.js` (`createApp` merge de `git`; bloque de rama en `/spawn`)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `git.findNestedRepos`, `git.containerWorktreeAdd`, `git.worktreeAdd` (inyectables vía `createApp`).
- Produces: `/spawn` con `dir` contenedor + `branch` → `200 { name: '<proj>-<rama>' }` tras `containerWorktreeAdd` + `newTmuxSession(tmux, wtPath)`.

- [ ] **Step 1: Escribir los tests (fallan)**

En `habitat/server/index.test.js`, agregar (después de los tests de `/spawn` con branch existentes):

```js
test('POST /spawn de proyecto contenedor llama containerWorktreeAdd y abre tmux en wtPath', async () => {
  const seenTmux = [];
  const seenContainer = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async (n, d) => { seenTmux.push([n, d]); return true; } };
  const git = {
    findNestedRepos: async () => ['back', 'front'],
    containerWorktreeAdd: async (...a) => { seenContainer.push(a); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api-feature-x');
  assert.deepEqual(seenContainer, [[
    '/home/u/proj-api', 'feature/x', '/home/u/habitat-worktrees/proj-api/feature-x', ['back', 'front'],
  ]]);
  assert.deepEqual(seenTmux, [['proj-api-feature-x', '/home/u/habitat-worktrees/proj-api/feature-x']]);
  server.close();
});

test('POST /spawn de contenedor: fallo de containerWorktreeAdd -> 500', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { findNestedRepos: async () => ['back'], containerWorktreeAdd: async () => false };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feat' }),
  });
  assert.equal(r.status, 500);
  server.close();
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='contenedor' 2>&1 | tail -30`
Expected: FAIL — hoy `git` inyectado no tiene `findNestedRepos`/`containerWorktreeAdd` y el handler no ramifica; probablemente 500 por `git.findNestedRepos is not a function` o 200 single-repo con assert de `seenContainer` fallando.

- [ ] **Step 3: Merge de `git` en `createApp` + import**

En `habitat/server/index.js`, ampliar el import de `git.js`:

```js
import {
  worktreeAdd, worktreeRemove, validBranch, findNestedRepos, containerWorktreeAdd,
} from './git.js';
```

Y cambiar la firma de `createApp` para mergear el `git` inyectado sobre los defaults reales:

```js
export function createApp({
  config, store,
  tmux = { listSessions, newTmuxSession, killTmuxSession },
  git: gitOverrides = {},
}) {
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, ...gitOverrides };
```

(El resto del cuerpo de `createApp` no cambia: sigue usando `git.worktreeAdd`, etc.)

- [ ] **Step 4: Ramificar el bloque de rama en `/spawn`**

En `habitat/server/index.js`, reemplazar el cuerpo del `if (branch != null && branch !== '')` por:

```js
      if (branch != null && branch !== '') {
        if (typeof branch !== 'string' || !validBranch(branch)) {
          res.writeHead(400).end(); return;
        }
        const base = (typeof body.base === 'string' && body.base) ? body.base : 'main';
        const nested = await git.findNestedRepos(dir);
        const { path, tmux: tmuxName } = worktreePaths(config.WORKTREES_DIR, basename(dir), branch);
        const existing = await tmux.listSessions();
        if (existing.includes(tmuxName)) { res.writeHead(409).end(); return; }
        if (char) store.setPendingChar(tmuxName, char);
        const ok = nested.length
          ? await git.containerWorktreeAdd(dir, branch, path, nested) // base por repo (origin/HEAD); se ignora `base`
          : await git.worktreeAdd(dir, branch, base, path);
        if (!ok) { res.writeHead(500).end(); return; }
        if (!(await tmux.newTmuxSession(tmuxName, path))) { res.writeHead(500).end(); return; }
        announcePending(tmuxName, { name: basename(dir), project: basename(dir), branch, char });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: tmuxName }));
        return;
      }
```

- [ ] **Step 5: Correr toda la suite de index y verificar que pasa**

Run: `cd habitat && node --test server/index.test.js 2>&1 | tail -30`
Expected: PASS — los nuevos tests de contenedor y TODOS los existentes (single-repo `findNestedRepos` real devuelve `[]` para `/home/u/proj-api` inexistente → camino single-repo intacto).

- [ ] **Step 6: Commit**

```bash
cd habitat && git add server/index.js server/index.test.js
git commit -m "feat(habitat): /spawn soporta proyectos contenedor (worktree multi-repo)"
```

---

## Task 7: Cablear `/kill` para limpiar todos los worktrees

**Files:**
- Modify: `habitat/server/index.js` (bloque de limpieza de worktree en `/kill`)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `git.findNestedRepos`, `git.worktreeRemove` (inyectables).
- Produces: `/kill` de una sesión de contenedor remueve cada worktree hijo (`join(projectDir, repo)` → `join(path, repo)`) y luego el padre. Single-repo y sesión plana sin cambios.

- [ ] **Step 1: Escribir el test (falla)**

En `habitat/server/index.test.js`, agregar:

```js
test('POST /kill de sesión contenedor remueve worktrees hijos y luego el padre', async () => {
  const seenRemove = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = {
    findNestedRepos: async () => ['back', 'front'],
    worktreeRemove: async (projectDir, path) => { seenRemove.push([projectDir, path]); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', PROJECTS: ['/home/u/Artisano'] });
  const store = createStore();
  store.upsert(newSession('sid1', {
    name: 'Artisano', project: 'Artisano', tmux: 'Artisano-feature-x', branch: 'feature/x',
  }));
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid1' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seenRemove, [
    ['/home/u/Artisano/back', '/home/u/habitat-worktrees/Artisano/feature-x/back'],
    ['/home/u/Artisano/front', '/home/u/habitat-worktrees/Artisano/feature-x/front'],
    ['/home/u/Artisano', '/home/u/habitat-worktrees/Artisano/feature-x'],
  ]);
  server.close();
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test --test-name-pattern='sesión contenedor' 2>&1 | tail -20`
Expected: FAIL — el `/kill` actual solo remueve el padre; `seenRemove` no incluye los hijos.

- [ ] **Step 3: Ramificar la limpieza en `/kill`**

En `habitat/server/index.js`, reemplazar el bloque de limpieza de worktree dentro de `/kill` por:

```js
      if (config.WORKTREES_DIR && s.project && s.branch && s.tmux && s.tmux !== s.project) {
        const projectDir = (config.PROJECTS || []).find((d) => basename(d) === s.project);
        if (projectDir) {
          const { path } = worktreePaths(config.WORKTREES_DIR, s.project, s.branch);
          const nested = await git.findNestedRepos(projectDir);
          // Contenedor: remover primero los hijos (sin force: si hay cambios sin commitear git
          // rechaza y se deja en disco), luego el padre. Si un hijo queda, el padre tampoco se
          // borra (su carpeta no queda vacía) -> el conjunto sobrevive y un re-spawn lo reutiliza.
          for (const name of nested) {
            await git.worktreeRemove(join(projectDir, name), join(path, name));
          }
          await git.worktreeRemove(projectDir, path);
        }
      }
```

(`join` ya está importado de `node:path` en `index.js`.)

- [ ] **Step 4: Correr toda la suite de index y verificar que pasa**

Run: `cd habitat && node --test server/index.test.js 2>&1 | tail -30`
Expected: PASS — el nuevo test de contenedor y los dos existentes de `/kill` (single-repo: `findNestedRepos` real de `/home/u/proj-api` → `[]` → solo se remueve el padre, `seenRemove` con 2 args; sesión plana: no entra al bloque).

- [ ] **Step 5: Correr la suite completa del server**

Run: `cd habitat && npm test 2>&1 | tail -30`
Expected: PASS — toda la suite.

- [ ] **Step 6: Commit**

```bash
cd habitat && git add server/index.js server/index.test.js
git commit -m "feat(habitat): /kill limpia los worktrees de proyectos contenedor"
```

---

## Verificación end-to-end (manual, fuera de los tasks)

Tras implementar y mergear a `main` (auto-deploy del runner):

1. En la instancia: crear sesión de Artisano con una rama nueva (ej. `feature/probe`).
2. Verificar `200` y que aparezca el pod en ~1-2s.
3. Verificar en disco: `ls /home/mnonm/habitat-worktrees/Artisano/feature-probe/` muestra `back/ front/ ceo/ server/` + `.claude/ docs/ .sdd/`, y `git -C .../back rev-parse --abbrev-ref HEAD` = `feature/probe`.
4. Cerrar la sesión desde la GUI y verificar que los worktrees se remueven (salvo los que tengan cambios sin commitear).

(El primer spawn auto-inicializa el repo padre de Artisano: aparece `/home/mnonm/proyectos/Artisano/.git` y un `.gitignore` con `back/ ceo/ front/ server/`.)

## Fuera de alcance (YAGNI)

- Override manual de base por repo.
- Ocultar el campo `base` en la UI para contenedores.
- Worktrees anidados de más de un nivel.
