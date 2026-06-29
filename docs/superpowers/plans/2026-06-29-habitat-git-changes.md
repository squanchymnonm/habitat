# Vista de cambios Git por sesión (F1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a Hábitat un panel por sesión que muestre el estado git del worktree (sin commitear, overview de rama, commits pushed/unpushed), permita ver diffs lado a lado contra la default, y ejecute acciones git (stage/unstage/discard/commit/push/pull/merge-default) detrás de un gate de entorno.

**Architecture:** Backend Node dependency-light (http nativo, no Express). Dos módulos puros nuevos en `server/` (`git-read.js` de solo-lectura, `git-write.js` de acciones), con `exec` inyectable para testear sin git real (patrón ya usado en `git.js`). Tres endpoints (`GET /git/status`, `GET /git/diff`, `POST /git/action`) montados en `index.js` con el patrón existente: `authorize()` → `store.get(id)` → root = `s.cwd`, guardas anti-traversal (`resolveWithinRoot`). Frontend Vue 3 + TS: composable `useGitChanges` (espejo de `useFiles`), parser de diff propio (`parseDiff`), y un overlay `ChangesPanel.vue` abierto desde `DetailPanel.vue` como Quest Book / File Browser. El refresh live reusa los broadcasts WS existentes (cada hook hace `store.upsert`), debounced.

**Tech Stack:** Node (node:test, http nativo, execFile), Vue 3 + TypeScript, Vite, Vitest, Pinia.

## Global Constraints

- **Server dependency-light:** sin dependencias nuevas; usar `node:child_process` (`execFile`) y `http` nativo. (verbatim: "El server es deliberadamente dependency-light (usa `http` nativo, no Express)".)
- **`exec` inyectable:** toda función que corre git recibe `exec = defaultExec` como último parámetro para tests con fake (patrón de `server/git.js`).
- **Scope estricto por sesión:** todo endpoint resuelve la sesión con `store.get(id)` y usa `s.cwd` como root; `409` si no hay sesión/`cwd`.
- **Guardas de seguridad:** paths validados con `resolveWithinRoot(s.cwd, rel)` (≠ null) en endpoints; en `git-write.js` rechazar paths que empiecen con `-`; branches por `validBranch`; paths siempre tras `--` en argv.
- **Gate de escritura:** las acciones de escritura van detrás de `config.ALLOW_GIT_WRITE` (env `HABITAT_ALLOW_GIT_WRITE`, default off) → `403` si off. Lectura siempre disponible.
- **Diff "de rama" = tres puntos:** `git diff <defaultRef>...HEAD` (desde el merge-base).
- **Default branch:** se resuelve con `remoteDefaultBranch(cwd)` de `server/git.js` (devuelve ej. `origin/main`).
- **Sin libs de diff en el cliente:** parser de diff unificado propio.
- **Comandos de test:** server `cd habitat/server-dir && node --test <archivo>` (desde `habitat/`: `node --test server/<archivo>`); client `cd habitat/client && npx vitest run <archivo>`; build/typecheck client `npm run build` (corre `vue-tsc --noEmit && vite build`).

---

## File Structure

**Backend (`habitat/server/`):**
- Create `git-read.js` — funciones puras de lectura: `parsePorcelain`, `parseNameStatus`, `workingStatus`, `branchOverview`, `commits`, `filePatch`.
- Create `git-read.test.js` — tests con `exec` fake.
- Create `git-write.js` — acciones: `stage`, `unstage`, `discard`, `commit`, `push`, `pull`, `mergeDefault`, `abort` (+ helpers `safePaths`, `trimErr`, `conflictResult`).
- Create `git-write.test.js` — tests con `exec` fake.
- Modify `config.js` — agregar `ALLOW_GIT_WRITE`.
- Modify `config.test.js` — cubrir el flag.
- Modify `index.js` — endpoints `GET /git/status`, `GET /git/diff`, `POST /git/action`.
- Modify `index.test.js` — tests de endpoints (authorize, 409, 400, gate 403).

**Frontend (`habitat/client/src/`):**
- Create `composables/parseDiff.ts` — parser de diff unificado → hunks.
- Create `composables/parseDiff.test.ts` — Vitest.
- Create `composables/useGitChanges.ts` — fetch de estado/diff/acciones.
- Create `components/ChangesPanel.vue` — overlay del panel de cambios.
- Modify `components/DetailPanel.vue` — botón en el header + render del overlay + cierre en Escape/cambio de sesión.

---

## Task 1: Config flag `ALLOW_GIT_WRITE`

**Files:**
- Modify: `habitat/server/config.js:16`
- Test: `habitat/server/config.test.js`

**Interfaces:**
- Produces: `config.ALLOW_GIT_WRITE: boolean` (env `HABITAT_ALLOW_GIT_WRITE`, `'1'`/`'true'` → true, default false).

- [ ] **Step 1: Write the failing test**

En `habitat/server/config.test.js`, agregar:

```js
test('ALLOW_GIT_WRITE: off por default, on con HABITAT_ALLOW_GIT_WRITE=1', async () => {
  delete process.env.HABITAT_ALLOW_GIT_WRITE;
  const a = (await import('./config.js?case=off')).loadConfig();
  assert.equal(a.ALLOW_GIT_WRITE, false);
  process.env.HABITAT_ALLOW_GIT_WRITE = '1';
  const b = (await import('./config.js?case=on')).loadConfig();
  assert.equal(b.ALLOW_GIT_WRITE, true);
  delete process.env.HABITAT_ALLOW_GIT_WRITE;
});
```

> Nota: si `config.js` exporta un objeto ya evaluado en vez de `loadConfig()`, adaptar el test al patrón existente del archivo (mirar cómo `config.test.js` arma su config) — la aserción a mantener es: default `false`, `'1'` → `true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/config.test.js`
Expected: FAIL (`ALLOW_GIT_WRITE` undefined).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/config.js`, junto a `ALLOW_SPAWN` (línea 16) agregar:

```js
  ALLOW_GIT_WRITE: bool(process.env.HABITAT_ALLOW_GIT_WRITE),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/config.test.js
git commit -m "feat(habitat): flag ALLOW_GIT_WRITE para acciones git"
```

---

## Task 2: `git-read.js` — parseo de estado de trabajo

**Files:**
- Create: `habitat/server/git-read.js`
- Test: `habitat/server/git-read.test.js`

**Interfaces:**
- Produces:
  - `parsePorcelain(z: string) → { staged: {rel,status,old?}[], unstaged: {rel,status}[], untracked: {rel,status}[], conflicted: {rel,status}[] }`
  - `workingStatus(cwd, exec=defaultExec) → Promise<same shape>`
  - `defaultExec(file, args) → Promise<string stdout>` (interno, no exportado).

- [ ] **Step 1: Write the failing test**

Crear `habitat/server/git-read.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePorcelain, workingStatus } from './git-read.js';

test('parsePorcelain separa staged/unstaged/untracked/conflicted', () => {
  // formato porcelain v1 -z: "XY path\0", rename agrega token de origen
  const z = 'M  a.js\0 M b.js\0MM c.js\0?? new.txt\0UU conf.js\0R  old.js\0renamed.js\0';
  const r = parsePorcelain(z);
  assert.deepEqual(r.staged.map((e) => e.rel).sort(), ['a.js', 'c.js', 'renamed.js'].sort());
  assert.deepEqual(r.unstaged.map((e) => e.rel).sort(), ['b.js', 'c.js'].sort());
  assert.deepEqual(r.untracked.map((e) => e.rel), ['new.txt']);
  assert.deepEqual(r.conflicted.map((e) => e.rel), ['conf.js']);
  const rn = r.staged.find((e) => e.rel === 'renamed.js');
  assert.equal(rn.old, 'old.js');
});

test('workingStatus llama a git status --porcelain=v1 -z', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return '?? x\0'; };
  const r = await workingStatus('/proj', exec);
  assert.deepEqual(got, ['git', '-C', '/proj', 'status', '--porcelain=v1', '-z']);
  assert.deepEqual(r.untracked.map((e) => e.rel), ['x']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

Crear `habitat/server/git-read.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { remoteDefaultBranch, currentBranch } from './git.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

// Parsea `git status --porcelain=v1 -z`. Entradas separadas por NUL; cada una es
// "XY path"; en rename/copy la ruta de origen viene en el token siguiente.
export function parsePorcelain(z) {
  const out = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  const toks = String(z).split('\0');
  for (let i = 0; i < toks.length; i++) {
    const entry = toks[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const rel = entry.slice(3);
    const x = xy[0], y = xy[1];
    if (xy === '??') { out.untracked.push({ rel, status: '?' }); continue; }
    let old;
    if (x === 'R' || x === 'C') { old = toks[++i]; }
    const unmerged = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (unmerged) { out.conflicted.push({ rel, status: xy }); continue; }
    if (x !== ' ') out.staged.push({ rel, status: x, old });
    if (y !== ' ') out.unstaged.push({ rel, status: y });
  }
  return out;
}

export async function workingStatus(cwd, exec = defaultExec) {
  const z = await exec('git', ['-C', cwd, 'status', '--porcelain=v1', '-z']);
  return parsePorcelain(z);
}

export { defaultExec, remoteDefaultBranch, currentBranch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-read.js habitat/server/git-read.test.js
git commit -m "feat(habitat): git-read workingStatus + parsePorcelain"
```

---

## Task 3: `git-read.js` — overview de rama

**Files:**
- Modify: `habitat/server/git-read.js`
- Test: `habitat/server/git-read.test.js`

**Interfaces:**
- Consumes: `currentBranch`, `remoteDefaultBranch` de `git.js`.
- Produces:
  - `parseNameStatus(out: string) → { status, rel, old? }[]`
  - `branchOverview(cwd, exec=defaultExec) → Promise<{ branch, default, ahead: number, behind: number, files: {status,rel,old?}[] }>`

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/git-read.test.js`:

```js
import { parseNameStatus, branchOverview } from './git-read.js';

test('parseNameStatus parsea M/A/D y renames', () => {
  const out = 'M\tsrc/a.js\nA\tnew.js\nR100\told.js\tnew.js\n';
  const r = parseNameStatus(out);
  assert.deepEqual(r[0], { status: 'M', rel: 'src/a.js' });
  assert.deepEqual(r[1], { status: 'A', rel: 'new.js' });
  assert.deepEqual(r[2], { status: 'R', old: 'old.js', rel: 'new.js' });
});

test('branchOverview arma ahead/behind y files vs default (tres puntos)', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('rev-list --left-right --count')) {
      assert.ok(a.includes('origin/main...HEAD'));
      return '2\t5\n'; // behind=2 ahead=5
    }
    if (a.includes('diff --name-status')) {
      assert.ok(a.includes('origin/main...HEAD'));
      return 'M\tsrc/a.js\n';
    }
    return '';
  };
  const r = await branchOverview('/proj', exec);
  assert.equal(r.branch, 'feature/x');
  assert.equal(r.default, 'origin/main');
  assert.equal(r.behind, 2);
  assert.equal(r.ahead, 5);
  assert.deepEqual(r.files, [{ status: 'M', rel: 'src/a.js' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: FAIL (`parseNameStatus`/`branchOverview` no existen).

- [ ] **Step 3: Write minimal implementation**

Agregar a `habitat/server/git-read.js`:

```js
export function parseNameStatus(out) {
  const files = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if (code === 'R' || code === 'C') files.push({ status: code, old: parts[1], rel: parts[2] });
    else files.push({ status: code, rel: parts[1] });
  }
  return files;
}

export async function branchOverview(cwd, exec = defaultExec) {
  const branch = await currentBranch(cwd, exec);
  const def = await remoteDefaultBranch(cwd, exec); // ej. 'origin/main'
  let ahead = 0, behind = 0, files = [];
  try {
    const counts = String(
      await exec('git', ['-C', cwd, 'rev-list', '--left-right', '--count', `${def}...HEAD`]),
    ).trim();
    const [b, a] = counts.split(/\s+/);
    behind = Number(b) || 0; ahead = Number(a) || 0;
    files = parseNameStatus(
      await exec('git', ['-C', cwd, 'diff', '--name-status', `${def}...HEAD`]),
    );
  } catch { /* sin remoto comparable: 0 y [] */ }
  return { branch, default: def, ahead, behind, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-read.js habitat/server/git-read.test.js
git commit -m "feat(habitat): git-read branchOverview + parseNameStatus"
```

---

## Task 4: `git-read.js` — commits pushed/unpushed

**Files:**
- Modify: `habitat/server/git-read.js`
- Test: `habitat/server/git-read.test.js`

**Interfaces:**
- Produces: `commits(cwd, exec=defaultExec) → Promise<{ sha, shortSha, subject, pushed: boolean, files: {status,rel,old?}[] }[]>`

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/git-read.test.js`:

```js
import { commits } from './git-read.js';

test('commits marca pushed según rev-list --not origin/<branch>', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('log --format')) return 'sha2\x1fs2\x1fsubject 2\nsha1\x1fs1\x1fsubject 1\n';
    if (a.includes('rev-list') && a.includes('--not')) {
      assert.ok(a.includes('origin/main..HEAD'));
      assert.ok(a.includes('--not origin/feature/x'));
      return 'sha2\n'; // sha2 no está en origin/feature/x -> unpushed
    }
    if (a.includes('show --name-status')) {
      return args.includes('sha2') ? 'A\tnew.js\n' : 'M\told.js\n';
    }
    return '';
  };
  const r = await commits('/proj', exec);
  assert.equal(r.length, 2);
  assert.equal(r[0].sha, 'sha2');
  assert.equal(r[0].pushed, false);
  assert.deepEqual(r[0].files, [{ status: 'A', rel: 'new.js' }]);
  assert.equal(r[1].sha, 'sha1');
  assert.equal(r[1].pushed, true);
});

test('commits: sin origin/<branch> todo queda unpushed', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('log --format')) return 'sha1\x1fs1\x1fsolo\n';
    if (a.includes('rev-list') && a.includes('--not')) throw new Error('unknown revision origin/feature/x');
    if (a.includes('show --name-status')) return 'M\ta.js\n';
    return '';
  };
  const r = await commits('/proj', exec);
  assert.equal(r[0].pushed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: FAIL (`commits` no existe).

- [ ] **Step 3: Write minimal implementation**

Agregar a `habitat/server/git-read.js`:

```js
export async function commits(cwd, exec = defaultExec) {
  const branch = await currentBranch(cwd, exec);
  const def = await remoteDefaultBranch(cwd, exec);
  let log = '';
  try { log = await exec('git', ['-C', cwd, 'log', '--format=%H%x1f%h%x1f%s', `${def}..HEAD`]); }
  catch { return []; }
  const rows = String(log).split('\n').filter(Boolean).map((l) => {
    const [sha, shortSha, subject] = l.split('\x1f');
    return { sha, shortSha, subject };
  });
  let unpushed;
  try {
    const out = await exec('git', ['-C', cwd, 'rev-list', `${def}..HEAD`, '--not', `origin/${branch}`]);
    unpushed = new Set(String(out).split('\n').filter(Boolean));
  } catch {
    unpushed = new Set(rows.map((r) => r.sha)); // sin origin/<branch>: todo unpushed
  }
  const result = [];
  for (const r of rows) {
    let files = [];
    try { files = parseNameStatus(await exec('git', ['-C', cwd, 'show', '--name-status', '--format=', r.sha])); }
    catch { /* dejar [] */ }
    result.push({ ...r, pushed: !unpushed.has(r.sha), files });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-read.js habitat/server/git-read.test.js
git commit -m "feat(habitat): git-read commits con pushed/unpushed"
```

---

## Task 5: `git-read.js` — patch por archivo

**Files:**
- Modify: `habitat/server/git-read.js`
- Test: `habitat/server/git-read.test.js`

**Interfaces:**
- Produces: `filePatch(cwd, rel, base, exec=defaultExec) → Promise<{ binary: boolean, patch: string }>`. `base` ∈ `'working'` (worktree vs index), `'staged'` (index vs HEAD), `'branch'` (vs default, tres puntos), `'commit:<sha>'`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/git-read.test.js`:

```js
import { filePatch } from './git-read.js';

test('filePatch elige argv según base', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push(args.join(' ')); return 'diff --git a/x b/x\n@@\n+a\n'; };
  await filePatch('/proj', 'src/x.js', 'working', exec);
  assert.ok(calls.at(-1).includes('diff -- src/x.js'));
  await filePatch('/proj', 'src/x.js', 'staged', exec);
  assert.ok(calls.at(-1).includes('diff --cached -- src/x.js'));
});

test('filePatch base branch usa tres puntos contra default', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    return 'patch';
  };
  const r = await filePatch('/proj', 'x.js', 'branch', exec);
  assert.equal(r.patch, 'patch');
});

test('filePatch detecta binario', async () => {
  const exec = async () => 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n';
  const r = await filePatch('/proj', 'i.png', 'working', exec);
  assert.equal(r.binary, true);
  assert.equal(r.patch, '');
});

test('filePatch rechaza rel con prefijo -', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  const r = await filePatch('/proj', '-rf', 'working', exec);
  assert.equal(called, false);
  assert.equal(r.patch, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: FAIL (`filePatch` no existe).

- [ ] **Step 3: Write minimal implementation**

Agregar a `habitat/server/git-read.js`:

```js
export async function filePatch(cwd, rel, base, exec = defaultExec) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('-')) return { binary: false, patch: '' };
  const args = ['-C', cwd];
  if (base === 'staged') args.push('diff', '--cached', '--', rel);
  else if (base === 'branch') {
    const def = await remoteDefaultBranch(cwd, exec);
    args.push('diff', `${def}...HEAD`, '--', rel);
  } else if (typeof base === 'string' && base.startsWith('commit:')) {
    const sha = base.slice('commit:'.length);
    if (sha.startsWith('-')) return { binary: false, patch: '' };
    args.push('show', '--format=', sha, '--', rel);
  } else {
    args.push('diff', '--', rel); // working: worktree vs index
  }
  let patch;
  try { patch = String(await exec('git', args)); }
  catch (e) { patch = e && e.stdout ? String(e.stdout) : ''; }
  // untracked en working: git diff no muestra nada -> diff contra /dev/null
  if (!patch && (base === 'working' || base == null)) {
    try { await exec('git', ['-C', cwd, 'diff', '--no-index', '--', '/dev/null', rel]); }
    catch (e) { patch = e && e.stdout ? String(e.stdout) : ''; }
  }
  const binary = /Binary files /.test(patch);
  return { binary, patch: binary ? '' : patch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-read.js habitat/server/git-read.test.js
git commit -m "feat(habitat): git-read filePatch por base"
```

---

## Task 6: `git-write.js` — acciones por path (stage/unstage/discard)

**Files:**
- Create: `habitat/server/git-write.js`
- Test: `habitat/server/git-write.test.js`

**Interfaces:**
- Consumes: `validBranch`, `remoteDefaultBranch` de `git.js`.
- Produces:
  - `stage(cwd, rels, exec) / unstage(cwd, rels, exec) / discard(cwd, rels, exec) → Promise<{ ok, code?, message? }>`
  - helpers internos `safePaths(rels)`, `trimErr(e)`, `gitOk(cwd, args, exec)`.

- [ ] **Step 1: Write the failing test**

Crear `habitat/server/git-write.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stage, unstage, discard } from './git-write.js';

test('stage usa git add -- <paths>', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return ''; };
  const r = await stage('/proj', ['a.js', 'b.js'], exec);
  assert.equal(r.ok, true);
  assert.deepEqual(got, ['git', '-C', '/proj', 'add', '--', 'a.js', 'b.js']);
});

test('unstage usa restore --staged', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await unstage('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore --staged -- a.js'));
});

test('discard usa restore --', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await discard('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore -- a.js'));
});

test('rechaza paths con prefijo - y arrays vacíos (flag smuggling)', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await stage('/proj', ['-rf'], exec)).ok, false);
  assert.equal((await stage('/proj', [], exec)).ok, false);
  assert.equal(called, false);
});

test('devuelve ok:false con stderr recortado ante fallo', async () => {
  const exec = async () => { const e = new Error('boom'); e.stderr = 'fatal: pathspec\nlinea2'; e.code = 1; throw e; };
  const r = await stage('/proj', ['a.js'], exec);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('fatal: pathspec'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-write.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

Crear `habitat/server/git-write.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validBranch, remoteDefaultBranch } from './git.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

function safePaths(rels) {
  if (!Array.isArray(rels) || rels.length === 0) return null;
  for (const r of rels) { if (typeof r !== 'string' || !r || r.startsWith('-')) return null; }
  return rels;
}

function trimErr(e) {
  const s = (e && (e.stderr || e.message)) || '';
  return String(s).split('\n').slice(0, 6).join('\n').slice(0, 800);
}

async function gitOk(cwd, args, exec) {
  try { await exec('git', ['-C', cwd, ...args]); return { ok: true }; }
  catch (e) { return { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function stage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['add', '--', ...p], exec);
}

export async function unstage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--staged', '--', ...p], exec);
}

export async function discard(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--', ...p], exec);
}

export { defaultExec, validBranch, remoteDefaultBranch, trimErr, gitOk };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-write.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-write.js habitat/server/git-write.test.js
git commit -m "feat(habitat): git-write stage/unstage/discard"
```

---

## Task 7: `git-write.js` — commit/push/pull/merge-default/abort

**Files:**
- Modify: `habitat/server/git-write.js`
- Test: `habitat/server/git-write.test.js`

**Interfaces:**
- Produces:
  - `commit(cwd, message, exec) → Promise<{ ok, code?, message? }>`
  - `push(cwd, branch, exec) → Promise<{ ok, code?, message? }>`
  - `pull(cwd, exec) → Promise<{ ok, conflict?: true, files?: string[], code?, message? }>`
  - `mergeDefault(cwd, exec) → Promise<{ ok, conflict?: true, files?: string[], code?, message? }>`
  - `abort(cwd, exec) → Promise<{ ok, code?, message? }>`

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/git-write.test.js`:

```js
import { commit, push, pull, mergeDefault, abort } from './git-write.js';

test('commit rechaza mensaje vacío y usa -m', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await commit('/proj', '   ', exec)).ok, false);
  await commit('/proj', 'mi mensaje', exec);
  assert.deepEqual(got, '-C /proj commit -m mi mensaje');
});

test('push intenta git push y cae a -u origin <branch> si falla', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (calls.length === 1) { const e = new Error('no upstream'); e.stderr = 'has no upstream branch'; throw e; }
    return '';
  };
  const r = await push('/proj', 'feature/x', exec);
  assert.equal(r.ok, true);
  assert.ok(calls[0].includes('push'));
  assert.ok(calls[1].includes('push -u origin feature/x'));
});

test('mergeDefault hace fetch + merge y reporta conflicto', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('fetch')) { assert.ok(a.includes('fetch origin main')); return ''; }
    if (a.startsWith('-C /proj merge')) { const e = new Error('m'); e.stdout = 'CONFLICT (content): Merge conflict in a.js'; throw e; }
    if (a.includes('diff --name-only --diff-filter=U')) return 'a.js\0';
    return '';
  };
  const r = await mergeDefault('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.files, ['a.js']);
});

test('pull --no-edit y abort --abort', async () => {
  let pullArgs, abortArgs;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('pull')) pullArgs = a;
    if (a.includes('merge --abort')) abortArgs = a;
    return '';
  };
  assert.equal((await pull('/proj', exec)).ok, true);
  assert.ok(pullArgs.includes('pull --no-edit'));
  assert.equal((await abort('/proj', exec)).ok, true);
  assert.ok(abortArgs.includes('merge --abort'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git-write.test.js`
Expected: FAIL (funciones no existen).

- [ ] **Step 3: Write minimal implementation**

Agregar a `habitat/server/git-write.js`:

```js
export async function commit(cwd, message, exec = defaultExec) {
  if (typeof message !== 'string' || !message.trim()) return { ok: false, message: 'mensaje vacío' };
  return gitOk(cwd, ['commit', '-m', message], exec);
}

export async function push(cwd, branch, exec = defaultExec) {
  const first = await gitOk(cwd, ['push'], exec);
  if (first.ok || !validBranch(branch)) return first;
  return gitOk(cwd, ['push', '-u', 'origin', branch], exec);
}

async function conflictResult(cwd, exec) {
  let files = [];
  try {
    const z = await exec('git', ['-C', cwd, 'diff', '--name-only', '--diff-filter=U', '-z']);
    files = String(z).split('\0').filter(Boolean);
  } catch { /* dejar [] */ }
  return { ok: false, conflict: true, files };
}

function isConflict(e) {
  const out = (e && ((e.stdout || '') + (e.stderr || ''))) || '';
  return /CONFLICT|Automatic merge failed|Merge conflict/i.test(out);
}

export async function pull(cwd, exec = defaultExec) {
  try { await exec('git', ['-C', cwd, 'pull', '--no-edit']); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function mergeDefault(cwd, exec = defaultExec) {
  const def = await remoteDefaultBranch(cwd, exec); // 'origin/main'
  const slash = String(def).indexOf('/');
  const remote = slash > 0 ? def.slice(0, slash) : 'origin';
  const name = slash > 0 ? def.slice(slash + 1) : def;
  if (!validBranch(name) || remote.startsWith('-')) return { ok: false, message: 'rama default inválida' };
  try { await exec('git', ['-C', cwd, 'fetch', remote, name]); }
  catch (e) { return { ok: false, code: e && e.code, message: trimErr(e) }; }
  try { await exec('git', ['-C', cwd, 'merge', '--no-edit', def]); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function abort(cwd, exec = defaultExec) {
  return gitOk(cwd, ['merge', '--abort'], exec);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git-write.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-write.js habitat/server/git-write.test.js
git commit -m "feat(habitat): git-write commit/push/pull/merge-default/abort"
```

---

## Task 8: Endpoints de lectura (`GET /git/status`, `GET /git/diff`)

**Files:**
- Modify: `habitat/server/index.js` (imports al tope + bloque de endpoints junto a `/files`, ~línea 262)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `workingStatus`, `branchOverview`, `commits`, `filePatch` (git-read.js); `resolveWithinRoot` (ya importado de files.js); `authorize`, `store.get`, `config.ALLOW_GIT_WRITE`.
- Produces:
  - `GET /git/status?id=` → `200 { working, overview, commits, canWrite }` | `401` | `409`.
  - `GET /git/diff?id=&file=&base=` → `200 { binary, patch }` | `401` | `409` | `400` (path fuera de root).

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js`. Para inyectar git fake, los endpoints deben aceptar overrides vía `git-read`/`git-write` inyectables en `createApp`; si `createApp` aún no los acepta, este test usa un `store` con `cwd` real apuntando a un repo temporal **o** valida solo los códigos de status sin git real. Versión que valida status sin git (no requiere repo):

```js
test('GET /git/status sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1`);
  assert.equal(res.status, 401);
  server.close();
});

test('GET /git/status sin sesión -> 409', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=nope`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409);
  server.close();
});

test('GET /git/diff rechaza path fuera del root -> 400', async () => {
  const store = createStore();
  store.upsert({ id: 's1', cwd: '/home/u/proj', name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/diff?id=s1&file=../../etc/passwd`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 400);
  server.close();
});
```

> Si `store.upsert` requiere un objeto sesión completo, usar el helper `newSession` ya importado en el test (mirar cómo otros tests crean sesiones) y setearle `cwd`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (endpoints inexistentes → 404 en vez de 401/409/400).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/index.js`, agregar imports al tope (junto a los de git):

```js
import { workingStatus, branchOverview, commits as gitCommits, filePatch } from './git-read.js';
```

Agregar el bloque de endpoints después del bloque `GET /files` (antes de `/files/upload` o junto a ellos):

```js
    if (req.method === 'GET' && url.pathname === '/git/status') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      try {
        const [working, overview, log] = await Promise.all([
          workingStatus(s.cwd), branchOverview(s.cwd), gitCommits(s.cwd),
        ]);
        res.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ working, overview, commits: log, canWrite: !!config.ALLOW_GIT_WRITE }));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/diff') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const file = url.searchParams.get('file') || '';
      const base = url.searchParams.get('base') || 'working';
      if (!file || resolveWithinRoot(s.cwd, file) === null) { res.writeHead(400).end(); return; }
      try {
        const out = await filePatch(s.cwd, file, base);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoints GET /git/status y /git/diff"
```

---

## Task 9: Endpoint de acciones (`POST /git/action`) con gate

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `git-write.js` (namespace import), `readBody`, `resolveWithinRoot`, `config.ALLOW_GIT_WRITE`.
- Produces: `POST /git/action?id=` body `{ action, paths?, message? }` → `200 <result del git-write>` | `401` | `403` (gate off) | `409` | `400`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js`:

```js
test('POST /git/action con gate off -> 403', async () => {
  const store = createStore();
  store.upsert({ id: 's1', cwd: '/home/u/proj', name: 'proj', status: 'working' });
  const { server } = createApp({ config, store }); // config sin ALLOW_GIT_WRITE
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths: ['a.js'] }),
  });
  assert.equal(res.status, 403);
  server.close();
});

test('POST /git/action con gate on rechaza path fuera de root -> 400', async () => {
  const store = createStore();
  store.upsert({ id: 's1', cwd: '/home/u/proj', name: 'proj', status: 'working' });
  const { server } = createApp({ config: { ...config, ALLOW_GIT_WRITE: true }, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths: ['../../etc/passwd'] }),
  });
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (404 en vez de 403/400).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/index.js`, agregar import al tope:

```js
import * as gitWrite from './git-write.js';
```

Agregar el endpoint (junto a los otros `/git/*`):

```js
    if (req.method === 'POST' && url.pathname === '/git/action') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_GIT_WRITE) { res.writeHead(403).end(); return; }
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const { action, paths, message } = body || {};
      if (paths !== undefined) {
        if (!Array.isArray(paths)) { res.writeHead(400).end(); return; }
        for (const p of paths) {
          if (typeof p !== 'string' || resolveWithinRoot(s.cwd, p) === null) { res.writeHead(400).end(); return; }
        }
      }
      let r;
      switch (action) {
        case 'stage': r = await gitWrite.stage(s.cwd, paths); break;
        case 'unstage': r = await gitWrite.unstage(s.cwd, paths); break;
        case 'discard': r = await gitWrite.discard(s.cwd, paths); break;
        case 'commit': r = await gitWrite.commit(s.cwd, message); break;
        case 'push': r = await gitWrite.push(s.cwd, s.branch); break;
        case 'pull': r = await gitWrite.pull(s.cwd); break;
        case 'merge-default': r = await gitWrite.mergeDefault(s.cwd); break;
        case 'abort': r = await gitWrite.abort(s.cwd); break;
        default: res.writeHead(400).end(); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint POST /git/action con gate"
```

---

## Task 10: Parser de diff unificado (cliente)

**Files:**
- Create: `habitat/client/src/composables/parseDiff.ts`
- Test: `habitat/client/src/composables/parseDiff.test.ts`

**Interfaces:**
- Produces:
  - `interface DiffLine { type: 'ctx'|'add'|'del'; oldNo: number|null; newNo: number|null; text: string }`
  - `interface DiffHunk { header: string; lines: DiffLine[] }`
  - `parseDiff(patch: string): DiffHunk[]`

- [ ] **Step 1: Write the failing test**

Crear `habitat/client/src/composables/parseDiff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseDiff } from './parseDiff'

describe('parseDiff', () => {
  it('parsea hunks con add/del/ctx y numera líneas', () => {
    const patch = [
      'diff --git a/x.js b/x.js',
      'index 111..222 100644',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -1,3 +1,3 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      ' const c = 4',
    ].join('\n')
    const hunks = parseDiff(patch)
    expect(hunks.length).toBe(1)
    const types = hunks[0].lines.map((l) => l.type)
    expect(types).toEqual(['ctx', 'del', 'add', 'ctx'])
    expect(hunks[0].lines[0]).toMatchObject({ oldNo: 1, newNo: 1, text: 'const a = 1' })
    expect(hunks[0].lines[1]).toMatchObject({ type: 'del', oldNo: 2, newNo: null })
    expect(hunks[0].lines[2]).toMatchObject({ type: 'add', oldNo: null, newNo: 2 })
  })

  it('devuelve [] para patch vacío', () => {
    expect(parseDiff('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/client && npx vitest run src/composables/parseDiff.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

Crear `habitat/client/src/composables/parseDiff.ts`:

```ts
export interface DiffLine { type: 'ctx' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string }
export interface DiffHunk { header: string; lines: DiffLine[] }

// Parser chico de diff unificado de git. Ignora las cabeceras de archivo
// (diff/index/---/+++) y arma hunks numerando líneas viejas/nuevas.
export function parseDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      cur = { header: line, lines: [] }
      hunks.push(cur)
      continue
    }
    if (!cur) continue // cabeceras previas al primer hunk
    if (line.startsWith('+')) {
      cur.lines.push({ type: 'add', oldNo: null, newNo, text: line.slice(1) }); newNo++
    } else if (line.startsWith('-')) {
      cur.lines.push({ type: 'del', oldNo, newNo: null, text: line.slice(1) }); oldNo++
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignorar
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      cur.lines.push({ type: 'ctx', oldNo, newNo, text }); oldNo++; newNo++
    }
  }
  return hunks
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/client && npx vitest run src/composables/parseDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/parseDiff.ts habitat/client/src/composables/parseDiff.test.ts
git commit -m "feat(habitat): parser de diff unificado (cliente)"
```

---

## Task 11: Composable `useGitChanges`

**Files:**
- Create: `habitat/client/src/composables/useGitChanges.ts`

**Interfaces:**
- Consumes: patrón de auth de `useFiles.ts` (`token()` de `?token=`, `authHeaders()`).
- Produces:
  - tipos `GitFile { rel, status, old? }`, `GitStatus { working, overview, commits, canWrite }`, `GitOverview`, `GitCommit`.
  - `useGitChanges()` → `{ status, loading, error, loadStatus(id), loadDiff(id, file, base), action(id, action, payload) }`.

- [ ] **Step 1: Write the implementation**

> Este composable es I/O sobre `fetch`; sigue el patrón de `useFiles.ts` (que se testea solo en su parte pura). La verificación es por typecheck/build (Step 2) y por uso en el componente (Task 12).

Crear `habitat/client/src/composables/useGitChanges.ts`:

```ts
import { ref } from 'vue'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface GitFile { rel: string; status: string; old?: string }
export interface GitOverview { branch: string; default: string; ahead: number; behind: number; files: GitFile[] }
export interface GitCommit { sha: string; shortSha: string; subject: string; pushed: boolean; files: GitFile[] }
export interface GitWorking { staged: GitFile[]; unstaged: GitFile[]; untracked: GitFile[]; conflicted: GitFile[] }
export interface GitStatus { working: GitWorking; overview: GitOverview; commits: GitCommit[]; canWrite: boolean }
export interface GitActionResult { ok: boolean; conflict?: boolean; files?: string[]; code?: number; message?: string }
export type DiffBase = 'working' | 'staged' | 'branch' | `commit:${string}`

export function useGitChanges() {
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadStatus(id: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(`/git/status?id=${encodeURIComponent(id)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      status.value = (await res.json()) as GitStatus
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  async function loadDiff(id: string, file: string, base: DiffBase): Promise<{ binary: boolean; patch: string }> {
    const res = await fetch(
      `/git/diff?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}&base=${encodeURIComponent(base)}`,
      { headers: authHeaders() },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { binary: boolean; patch: string }
  }

  async function action(
    id: string,
    actionName: string,
    payload: { paths?: string[]; message?: string } = {},
  ): Promise<GitActionResult> {
    const res = await fetch(`/git/action?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...payload }),
    })
    if (res.status === 403) return { ok: false, message: 'acciones git deshabilitadas (HABITAT_ALLOW_GIT_WRITE)' }
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as GitActionResult
  }

  return { status, loading, error, loadStatus, loadDiff, action }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS (sin errores TS).

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/composables/useGitChanges.ts
git commit -m "feat(habitat): composable useGitChanges"
```

---

## Task 12: `ChangesPanel.vue` + wiring en `DetailPanel.vue`

**Files:**
- Create: `habitat/client/src/components/ChangesPanel.vue`
- Modify: `habitat/client/src/components/DetailPanel.vue` (import, ref `changesOpen`, botón en header ~línea 88, render ~línea 109, Escape ~línea 42, watch selectedId ~línea 47)

**Interfaces:**
- Consumes: `useGitChanges` (Task 11), `parseDiff` (Task 10), store `useSessions` (broadcast WS → `store.upsert` dispara refresh).
- Props: `id: string`. Emits: `close`.

- [ ] **Step 1: Crear el componente**

Crear `habitat/client/src/components/ChangesPanel.vue`:

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useGitChanges, type DiffBase, type GitFile } from '../composables/useGitChanges'
import { parseDiff, type DiffHunk } from '../composables/parseDiff'
import { useSessions } from '../stores/sessions'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, action } = useGitChanges()

const tab = ref<'work' | 'branch' | 'commits'>('work')
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')

async function refresh() { await loadStatus(props.id) }

async function openDiff(file: string, base: DiffBase) {
  diff.value = null
  try {
    const r = await loadDiff(props.id, file, base)
    diff.value = { file, hunks: r.binary ? [] : parseDiff(r.patch), binary: r.binary }
  } catch { actionErr.value = 'no se pudo cargar el diff' }
}

async function run(name: string, payload: { paths?: string[]; message?: string } = {}, confirmMsg?: string) {
  if (confirmMsg && !confirm(confirmMsg)) return
  busy.value = name; actionErr.value = ''
  const r = await action(props.id, name, payload)
  busy.value = ''
  if (!r.ok) actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
  await refresh()
}

const commitMsg = ref('')
function doCommit() {
  if (!commitMsg.value.trim()) return
  run('commit', { message: commitMsg.value }).then(() => { commitMsg.value = '' })
}

// Refresh live: cada broadcast WS hace store.upsert -> la sesión seleccionada
// cambia de identidad; debounced para no spamear git.
let t: ReturnType<typeof setTimeout> | null = null
function schedule() { if (t) clearTimeout(t); t = setTimeout(refresh, 800) }
watch(() => store.list.find((s) => s.id === props.id), schedule)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (diff.value) diff.value = null; else emit('close') } }
onMounted(() => { refresh(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { if (t) clearTimeout(t); window.removeEventListener('keydown', onKey) })

function fileBase(group: 'staged' | 'unstaged' | 'untracked'): DiffBase {
  return group === 'staged' ? 'staged' : 'working'
}
function canWrite() { return !!status.value?.canWrite }
function paths(list: GitFile[]) { return list.map((f) => f.rel) }
</script>

<template>
  <div class="changes-overlay">
    <header class="ch-head">
      <span class="ch-title">⌥ Cambios git</span>
      <span v-if="status" class="ch-branch">
        {{ status.overview.branch }} → {{ status.overview.default }}
        <b>↑{{ status.overview.ahead }} ↓{{ status.overview.behind }}</b>
      </span>
      <button class="ch-x" @click="refresh" title="Refrescar">⟳</button>
      <button class="ch-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <nav class="ch-tabs">
      <button :class="{ on: tab === 'work' }" @click="tab = 'work'">Trabajo</button>
      <button :class="{ on: tab === 'branch' }" @click="tab = 'branch'">Rama</button>
      <button :class="{ on: tab === 'commits' }" @click="tab = 'commits'">Commits</button>
    </nav>

    <p v-if="error" class="ch-err">{{ error === 'sin-dir' ? 'sesión sin working dir' : error }}</p>
    <p v-if="actionErr" class="ch-err">{{ actionErr }}</p>
    <p v-if="loading" class="ch-muted">cargando…</p>

    <div v-if="status" class="ch-body">
      <!-- TRABAJO -->
      <section v-show="tab === 'work'">
        <div v-if="status.working.conflicted.length" class="ch-group">
          <h4>En conflicto</h4>
          <ul>
            <li v-for="f in status.working.conflicted" :key="f.rel">
              <span class="st conf">{{ f.status }}</span> {{ f.rel }}
            </li>
          </ul>
          <button v-if="canWrite()" class="act danger" :disabled="busy === 'abort'"
            @click="run('abort', {}, 'Abortar el merge en curso?')">Abortar merge</button>
        </div>

        <div class="ch-group">
          <h4>Staged ({{ status.working.staged.length }})
            <button v-if="canWrite() && status.working.staged.length" class="mini"
              @click="run('unstage', { paths: paths(status.working.staged) })">unstage all</button>
          </h4>
          <ul>
            <li v-for="f in status.working.staged" :key="f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, 'staged')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('unstage', { paths: [f.rel] })">−</button>
            </li>
          </ul>
        </div>

        <div class="ch-group">
          <h4>Sin stagear ({{ status.working.unstaged.length + status.working.untracked.length }})</h4>
          <ul>
            <li v-for="f in status.working.unstaged" :key="'u' + f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, 'working')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('stage', { paths: [f.rel] })">+</button>
              <button v-if="canWrite()" class="mini danger"
                @click="run('discard', { paths: [f.rel] }, `Descartar cambios de ${f.rel}? No se puede deshacer.`)">⌦</button>
            </li>
            <li v-for="f in status.working.untracked" :key="'n' + f.rel">
              <span class="st new">?</span>
              <a @click="openDiff(f.rel, 'working')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('stage', { paths: [f.rel] })">+</button>
            </li>
          </ul>
        </div>

        <div v-if="canWrite()" class="ch-commit">
          <input v-model="commitMsg" placeholder="mensaje de commit" @keyup.enter="doCommit" />
          <button :disabled="busy === 'commit' || !commitMsg.trim()" @click="doCommit">Commit</button>
        </div>
      </section>

      <!-- RAMA -->
      <section v-show="tab === 'branch'">
        <ul class="ch-group">
          <li v-for="f in status.overview.files" :key="f.rel">
            <span class="st">{{ f.status }}</span>
            <a @click="openDiff(f.rel, 'branch')">{{ f.rel }}</a>
          </li>
          <li v-if="!status.overview.files.length" class="ch-muted">sin diferencias con {{ status.overview.default }}</li>
        </ul>
        <div v-if="canWrite()" class="ch-actions">
          <button :disabled="busy === 'push'" @click="run('push')">Push</button>
          <button :disabled="busy === 'pull'" @click="run('pull')">Pull</button>
          <button :disabled="busy === 'merge-default'"
            @click="run('merge-default', {}, `Mergear ${status.overview.default} en la rama?`)">Merge default</button>
        </div>
      </section>

      <!-- COMMITS -->
      <section v-show="tab === 'commits'">
        <div v-for="c in status.commits" :key="c.sha" class="ch-commit-row">
          <span class="dot" :class="{ pushed: c.pushed }" :title="c.pushed ? 'pusheado' : 'sin pushear'">
            {{ c.pushed ? '✓' : '●' }}
          </span>
          <code>{{ c.shortSha }}</code> <span class="subj">{{ c.subject }}</span>
          <ul>
            <li v-for="f in c.files" :key="c.sha + f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, `commit:${c.sha}`)">{{ f.rel }}</a>
            </li>
          </ul>
        </div>
        <p v-if="!status.commits.length" class="ch-muted">sin commits sobre {{ status.overview.default }}</p>
      </section>
    </div>

    <!-- VISOR DIFF lado a lado (responsivo: split en ancho, inline en angosto) -->
    <div v-if="diff" class="ch-diff" @click.self="diff = null">
      <div class="ch-diff-box">
        <header><b>{{ diff.file }}</b><button class="ch-x" @click="diff = null">✕</button></header>
        <p v-if="diff.binary" class="ch-muted">archivo binario</p>
        <div v-else class="diff-scroll">
          <table v-for="(h, i) in diff.hunks" :key="i" class="diff-table">
            <tbody>
              <tr v-for="(l, j) in h.lines" :key="j" :class="l.type">
                <td class="ln">{{ l.oldNo ?? '' }}</td>
                <td class="ln">{{ l.newNo ?? '' }}</td>
                <td class="code">{{ l.text }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changes-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; overflow: hidden; }
.ch-head { display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.ch-title { font-weight: 700; }
.ch-branch { font-size: .8rem; opacity: .85; margin-left: auto; }
.ch-x, .mini, .act, .ch-actions button, .ch-commit button { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.ch-x { padding: .15rem .5rem; }
.ch-tabs { display: flex; gap: .25rem; padding: .4rem .75rem; }
.ch-tabs button { flex: 1; padding: .35rem; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.ch-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.ch-body { flex: 1; overflow: auto; padding: .5rem .75rem; }
.ch-group { margin-bottom: .9rem; }
.ch-group h4 { margin: .3rem 0; font-size: .85rem; display: flex; align-items: center; gap: .5rem; }
.ch-group ul { list-style: none; margin: 0; padding: 0; }
.ch-group li { display: flex; align-items: center; gap: .4rem; padding: .12rem 0; font-size: .85rem; }
.ch-group a { cursor: pointer; text-decoration: underline dotted; flex: 1; word-break: break-all; }
.st { display: inline-block; width: 1.4em; text-align: center; font-weight: 700; color: var(--color-brass, #c79a4b); }
.st.new { color: #5fb36b; } .st.conf { color: #d2553f; }
.mini { padding: 0 .4rem; font-weight: 700; }
.danger { color: #d2553f; }
.ch-commit { display: flex; gap: .4rem; margin-top: .5rem; }
.ch-commit input { flex: 1; padding: .35rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.ch-actions { display: flex; gap: .4rem; margin-top: .6rem; }
.ch-actions button, .ch-commit button, .act { padding: .35rem .6rem; }
.ch-commit-row { border-bottom: 1px dashed var(--color-line, #3a2e22); padding: .4rem 0; font-size: .85rem; }
.ch-commit-row code { color: var(--color-brass, #c79a4b); }
.ch-commit-row .subj { opacity: .9; }
.dot { display: inline-block; width: 1.2em; } .dot.pushed { color: #5fb36b; }
.ch-err { color: #d2553f; padding: 0 .75rem; font-size: .8rem; }
.ch-muted { opacity: .6; font-size: .82rem; }
.ch-diff { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 6; }
.ch-diff-box { width: 94%; height: 90%; background: var(--color-base, #1a1410); border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-md, 6px); display: flex; flex-direction: column; }
.ch-diff-box header { display: flex; align-items: center; justify-content: space-between; padding: .4rem .6rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.diff-scroll { flex: 1; overflow: auto; }
.diff-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: .8rem; }
.diff-table td { padding: 0 .4rem; white-space: pre; vertical-align: top; }
.diff-table .ln { color: #6b5d49; text-align: right; user-select: none; width: 1px; }
.diff-table tr.add .code { background: rgba(95,179,107,.16); }
.diff-table tr.del .code { background: rgba(210,85,63,.16); }
.diff-table tr.add .code::before { content: '+ '; color: #5fb36b; }
.diff-table tr.del .code::before { content: '- '; color: #d2553f; }
</style>
```

- [ ] **Step 2: Wirear en `DetailPanel.vue`**

En `habitat/client/src/components/DetailPanel.vue`:

1. Import (junto a los otros, ~línea 4):
```ts
import ChangesPanel from './ChangesPanel.vue'
```
2. Ref de apertura (junto a `filesOpen`, ~línea 46):
```ts
const changesOpen = ref(false)
```
3. Escape (modificar `onKey`, ~línea 42) para que también cierre el panel:
```ts
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { bookOpen.value = false; filesOpen.value = false; changesOpen.value = false; menu.value = null } }
```
4. Cerrar al cambiar de sesión (junto al watch de `filesOpen`, ~línea 47):
```ts
watch(selectedId, () => { changesOpen.value = false })
```
5. Botón en el header (junto al de Archivos, ~línea 88):
```html
<button class="tool" @click="changesOpen = !changesOpen" title="Cambios git">⌥ Cambios</button>
```
6. Render del overlay (junto a `<FileBrowser>`, ~línea 109):
```html
<ChangesPanel v-if="changesOpen" :id="store.selected.id" @close="changesOpen = false" />
```

- [ ] **Step 3: Verify build + typecheck**

Run: `cd habitat/client && npm run build`
Expected: PASS (`vue-tsc --noEmit && vite build` sin errores).

- [ ] **Step 4: Verificación manual (smoke)**

Con el server corriendo (`cd habitat && HABITAT_TOKEN=x HABITAT_ALLOW_GIT_WRITE=1 npm start`) y el front (dev o build), seleccionar una sesión que viva en un worktree con cambios:
- Abrir "⌥ Cambios": se ven Trabajo/Rama/Commits con datos reales.
- Click en un archivo → diff lado a lado; binarios muestran "archivo binario".
- Stage/unstage/commit reflejan cambios tras el refresh.
- Con `HABITAT_ALLOW_GIT_WRITE` sin setear, los botones de acción no aparecen (`canWrite=false`) y `POST /git/action` daría 403.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/ChangesPanel.vue habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): ChangesPanel por sesión + wiring en DetailPanel"
```

---

## Self-Review (completado por el autor del plan)

**Spec coverage:**
- Vista "Trabajo (sin commitear)" → Task 2 (`workingStatus`) + Task 12 (sección Trabajo). ✅
- "Rama de un vistazo" (tres puntos) → Task 3 (`branchOverview`) + Task 12 (sección Rama). ✅
- "Commits pushed/unpushed con archivos" → Task 4 (`commits`) + Task 12 (sección Commits). ✅
- "Diff lado a lado" → Task 5 (`filePatch`) + Task 10 (`parseDiff`) + Task 12 (visor). ✅
- Acciones (stage/unstage/discard/commit/push/pull/merge-default) + abort de conflicto → Tasks 6, 7, 9, 12. ✅
- Gate `HABITAT_ALLOW_GIT_WRITE` → Task 1 + Task 9 (403) + Task 12 (`canWrite`). ✅
- Actualización live (PostToolUse → WS) + manual → Task 12 (watch `store.list` + botón ⟳). ✅
- Seguridad (authorize, 409, `resolveWithinRoot`, `--`, rechazo `-`, `validBranch`) → Tasks 6–9. ✅
- Testing (server `node --test` con `exec` fake; client Vitest) → Tasks 2–10. ✅

**Placeholder scan:** sin TBD/TODO; todo step de código trae el código completo. Las dos notas (`config.test.js` y `store.upsert`/`newSession`) son instrucciones de adaptación al patrón existente, no placeholders de implementación.

**Type consistency:** `GitFile`/`GitWorking`/`GitStatus` consistentes entre `useGitChanges.ts` y el JSON del server (`{ working, overview, commits, canWrite }`); `DiffBase` (`working|staged|branch|commit:<sha>`) coincide entre `filePatch` (server) y `loadDiff`/`openDiff` (cliente); nombres de acción (`stage|unstage|discard|commit|push|pull|merge-default|abort`) idénticos entre `POST /git/action` y `run()`.
