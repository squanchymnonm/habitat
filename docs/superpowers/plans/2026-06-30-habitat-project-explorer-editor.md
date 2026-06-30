# Explorador + editor de proyecto por sesión (F2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a Hábitat un explorador de proyecto por sesión que liste todo el árbol del worktree, permita previsualizar archivos read-only y abrirlos en nvim, corriendo nvim en una terminal tmux de editor dedicada por worktree (aislada de la del agente), reusando la infra de PTY/tmux existente.

**Architecture:** Backend Node dependency-light (http nativo). Endpoints nuevos en `index.js` (`GET /tree`, `GET /file`, `POST /editor/open`) con el patrón `/files`: `authorize` → `store.get(id)` → root `s.cwd`, guardas `resolveWithinRoot` + `realpath`. Un módulo nuevo `editor.js` (puro, `exec` inyectable) orquesta la sesión tmux `${tmux}-edit` (crea con `nvim -- <file>` o reusa con `:e`). `term.js` acepta `role=edit` para atachear esa sesión. Frontend Vue 3 + TS: `useProjectTree` (composable), `ProjectExplorer.vue` (árbol + preview), `EditorTerminal.vue` (xterm sobre `/term?role=edit`), wireados en `DetailPanel.vue`.

**Tech Stack:** Node (node:test, http nativo, execFile, node-pty/tmux), Vue 3 + TypeScript, Vite, Vitest, xterm.js.

## Global Constraints

- **Server dependency-light:** sin dependencias nuevas; `node:child_process` (`execFile`), `http` nativo, tmux/node-pty ya presentes.
- **`exec` inyectable:** `editor.js` recibe `exec = defaultExec` como último parámetro/opción (patrón de `git.js`/`tmux.js`).
- **Scope estricto por sesión:** todo endpoint resuelve la sesión con `store.get(id)` y usa `s.cwd` como root; `409` si no hay sesión/`cwd`.
- **Guardas de path:** `resolveWithinRoot(s.cwd, path)` (≠ null) en endpoints; rechazo de paths con prefijo `-`; el path a nvim va como argv tras `--` (vía `tmux new-session ... nvim -- <file>`, sin shell).
- **Target de editor derivado:** la terminal de editor es siempre `${s.tmux || s.name}-edit`, derivado del store, nunca de input del cliente.
- **Alcance del árbol:** `/tree` lista TODO, incluidos dotfiles y `.git/` (sin filtro). Lazy por carpeta.
- **Cap de lectura:** `/file` capea a `HABITAT_FILE_MAX_BYTES` (default 1 MB) y detecta binario (byte NUL).
- **Sin gate nuevo:** lectura y apertura del editor van con la auth de terminal existente (token + bind loopback); NO se agrega flag.
- **Comandos de test:** server `cd habitat && node --test server/<archivo>`; client `cd habitat/client && npx vitest run <archivo>`, typecheck `npm run typecheck`, build `npm run build` (`vue-tsc --noEmit && vite build`).

---

## File Structure

**Backend (`habitat/server/`):**
- Create `editor.js` — `editorSessionName(base)`, `openInEditor({ base, dir, file, exec })`.
- Create `editor.test.js` — tests con `exec`/`listSessions` fake.
- Modify `term.js` — export `editTarget(base)`; usar `role=edit` para elegir el target.
- Modify `term.test.js` — test de `role=edit` (target `-edit`).
- Modify `config.js` — agregar `FILE_MAX_BYTES`.
- Modify `index.js` — endpoints `GET /tree`, `GET /file`, `POST /editor/open`; inyección de `editor`; teardown de `${tmux}-edit` en `/kill`; import de `readFile`.
- Modify `index.test.js` — tests de los tres endpoints + teardown.

**Frontend (`habitat/client/src/`):**
- Create `composables/useProjectTree.ts` — `loadTree`, `loadFile`, `openInNvim`.
- Modify `composables/useTerminal.ts` — opción `role` que se anexa a la URL `/term`.
- Create `components/EditorTerminal.vue` — overlay xterm sobre `/term?role=edit`.
- Create `components/ProjectExplorer.vue` — overlay árbol + preview.
- Modify `components/DetailPanel.vue` — botón "🗂 Proyecto", render de ambos overlays, coordinación.

---

## Task 1: `editor.js` — orquestación de la terminal de editor

**Files:**
- Create: `habitat/server/editor.js`
- Test: `habitat/server/editor.test.js`

**Interfaces:**
- Consumes: `tmuxArgs`, `sendKeys`, `listSessions` de `./tmux.js`.
- Produces:
  - `editorSessionName(base: string) → string` (`` `${base}-edit` ``)
  - `openInEditor({ base, dir, file, exec=defaultExec }) → Promise<{ ok: boolean, tmux?: string, message?: string }>`

- [ ] **Step 1: Write the failing test**

Crear `habitat/server/editor.test.js`:

```js
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
    if (args.includes('list-sessions')) return ''; // ninguna sesión
    return '';
  };
  const r = await openInEditor({ base: 'api', dir: '/wt/api', file: 'src/a.js', exec });
  assert.equal(r.ok, true);
  assert.equal(r.tmux, 'api-edit');
  const created = calls.find((c) => c.includes('new-session'));
  assert.ok(created, 'debe crear la sesión');
  // tmux ejecuta nvim directamente: ... new-session -d -s api-edit -c /wt/api nvim -- src/a.js
  assert.deepEqual(created.slice(-6), ['-s', 'api-edit', '-c', '/wt/api', 'nvim', 'src/a.js'].slice(0, 4).concat(['nvim', '--', 'src/a.js']).slice(0)); // ver aserción explícita abajo
});

test('openInEditor reusa con Escape + :e si la sesión existe', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    if (args.includes('list-sessions')) return 'api-edit\nother\n';
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
```

> Nota sobre la aserción del create: reemplazá la línea marcada por una aserción
> explícita y clara:
> `assert.deepEqual(created.slice(-6), ['-s','api-edit','-c','/wt/api','nvim','--']);`
> seguida de `assert.equal(created.at(-1), 'src/a.js');` — es decir, la sesión se
> crea con `new-session -d -s api-edit -c /wt/api nvim -- src/a.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/editor.test.js`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

Crear `habitat/server/editor.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmuxArgs, sendKeys, listSessions } from './tmux.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export function editorSessionName(base) {
  return `${base}-edit`;
}

// Escapa para la cmdline de nvim (:e): espacios y caracteres especiales con backslash.
function nvimEscape(p) {
  return String(p).replace(/([ %#\\])/g, '\\$1');
}

// Abre `file` (relativo a `dir`) en la sesión de editor de `base`. Si la sesión
// `${base}-edit` no existe, la crea con tmux ejecutando nvim directamente (sin
// shell, así el path no sufre word-splitting). Si existe, fuerza normal mode
// (Escape) y abre el archivo con :e. `file` no puede empezar con '-'.
export async function openInEditor({ base, dir, file, exec = defaultExec }) {
  if (typeof file !== 'string' || !file || file.startsWith('-')) {
    return { ok: false, message: 'path inválido' };
  }
  const name = editorSessionName(base);
  let sessions = [];
  try { sessions = await listSessions(exec); } catch { /* asumimos que no existe */ }
  try {
    if (sessions.includes(name)) {
      await exec('tmux', tmuxArgs('send-keys', '-t', name, 'Escape'));
      await sendKeys(name, `:e ${nvimEscape(file)}`, exec);
    } else {
      await exec('tmux', tmuxArgs('new-session', '-d', '-s', name, '-c', dir, 'nvim', '--', file));
    }
    return { ok: true, tmux: name };
  } catch (e) {
    return { ok: false, message: String((e && (e.stderr || e.message)) || '').slice(0, 300) };
  }
}

export { defaultExec };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/editor.js habitat/server/editor.test.js
git commit -m "feat(habitat): editor.js — sesión tmux de editor (nvim)"
```

---

## Task 2: `term.js` — atachar la terminal de editor con `role=edit`

**Files:**
- Modify: `habitat/server/term.js` (export `editTarget`; usar `role` en la conexión, ~línea 44-47)
- Test: `habitat/server/term.test.js`

**Interfaces:**
- Produces: `editTarget(base: string) → string` (`` `${base}-edit` ``); `/term?id=&role=edit` atachea a `${s.tmux||s.name}-edit`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/term.test.js` (reusa `fakePtyFactory`/`listen` ya definidos en el archivo):

```js
import { editTarget } from './term.js';

test('editTarget sufija -edit', () => {
  assert.equal(editTarget('api'), 'api-edit');
});

test('attachTerm con role=edit atachea a <tmux>-edit', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const log = { writes: [], resizes: [] };
  const hub = attachTerm(server, store, { token: '', spawnPty: fakePtyFactory(log) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1&role=edit`);
  await new Promise((r) => ws.once('open', r));
  assert.equal(log.target, 'api-edit');

  ws.close(); hub.close(); server.close();
});
```

> El import de `editTarget` se agrega a la línea de import existente
> `import { attachTerm, attachArgs } from './term.js';` → agregar `, editTarget`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/term.test.js`
Expected: FAIL (`editTarget` no existe / target sigue siendo `api`).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/term.js`, agregar el helper exportado (cerca de `attachArgs`):

```js
// Sesión tmux dedicada a editar (nvim) para una sesión dada. Derivada del store,
// nunca de input del cliente.
export function editTarget(base) {
  return `${base}-edit`;
}
```

Y en `attachTerm`, donde hoy dice `const target = s.tmux || s.name;` (≈ línea 47), reemplazar por:

```js
    const base = s.tmux || s.name;
    const role = url.searchParams.get('role');
    const target = role === 'edit' ? editTarget(base) : base;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/term.test.js`
Expected: PASS (todos, viejos + nuevos).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/term.js habitat/server/term.test.js
git commit -m "feat(habitat): /term role=edit atachea la terminal de editor"
```

---

## Task 3: `GET /tree` — listado completo del árbol

**Files:**
- Modify: `habitat/server/index.js` (bloque de endpoint junto a `GET /files`)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `resolveWithinRoot` (ya importado), `readdir`/`stat`/`realpath`/`join`/`relative`/`basename`/`sep` (ya importados por `/files`), `authorize`, `store.get`.
- Produces: `GET /tree?id=&path=` → `200 { root, rel, breadcrumbs, entries: {name,rel,isDir,size}[] }` (incluye dotfiles y `.git/`) | `401` | `409` | `400`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js` (usa `mkdtempSync`/`mkdirSync` ya importados; sembrá la sesión con `newSession` + `cwd` como en los tests de `/git/*`):

```js
test('GET /tree lista todo incluyendo dotfiles y .git', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, '.env'), 'X=1');
  writeFileSync(join(dir, 'README.md'), 'hi');
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/tree?id=s1`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const names = body.entries.map((e) => e.name);
  assert.ok(names.includes('.git'));
  assert.ok(names.includes('.env'));
  assert.ok(names.includes('src'));
  assert.ok(names.includes('README.md'));
  // carpetas primero
  assert.equal(body.entries[0].isDir, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /tree sin sesión -> 409; path fuera de root -> 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r409 = await fetch(`http://127.0.0.1:${port}/tree?id=nope`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(r409.status, 409);
  const r400 = await fetch(`http://127.0.0.1:${port}/tree?id=s1&path=../../etc`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(r400.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

> Si `writeFileSync` no está importado en `index.test.js`, agregalo al import de
> `node:fs` junto a `mkdtempSync`/`mkdirSync`/`rmSync`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (404 / endpoint inexistente).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/index.js`, justo después del bloque `GET /files` agregar:

```js
    if (req.method === 'GET' && url.pathname === '/tree') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolveWithinRoot(root, rel);
      if (!target) { res.writeHead(400).end(); return; }
      let realTarget, realRoot;
      try { realTarget = await realpath(target); realRoot = await realpath(root); }
      catch { res.writeHead(404).end(); return; }
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = [];
      for (const d of dirents) {
        // Sin filtro: mostramos TODO (incluidos dotfiles y .git/).
        const abs = join(realTarget, d.name);
        let size = 0;
        if (!d.isDirectory()) { try { size = (await stat(abs)).size; } catch { size = 0; } }
        entries.push({ name: d.name, rel: relative(realRoot, abs), isDir: d.isDirectory(), size });
      }
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint GET /tree (árbol completo)"
```

---

## Task 4: `GET /file` — contenido para preview (con cap y detección de binario)

**Files:**
- Modify: `habitat/server/config.js` (agregar `FILE_MAX_BYTES`)
- Modify: `habitat/server/index.js` (import `readFile`; endpoint `GET /file`)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `config.FILE_MAX_BYTES`, `readFile` (fs/promises), `resolveWithinRoot`, `realpath`, `stat`, `sep`.
- Produces: `GET /file?id=&path=` → `200` con uno de `{ text, size }` | `{ binary: true, size }` | `{ tooLarge: true, size }` | `401` | `409` | `400`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js`:

```js
test('GET /file devuelve texto, binario y tooLarge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-'));
  writeFileSync(join(dir, 'a.txt'), 'hola mundo');
  writeFileSync(join(dir, 'bin'), Buffer.from([0x00, 0x01, 0x02]));
  writeFileSync(join(dir, 'big'), Buffer.alloc(20));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  // cap chico para forzar tooLarge en 'big'
  const { server } = createApp({ config: { ...config, FILE_MAX_BYTES: 10 }, store });
  const port = await listen(server);
  const h = { authorization: 'Bearer secret' };

  const txt = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=a.txt`, { headers: h })).json();
  assert.equal(txt.text, 'hola mundo');

  const bin = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=bin`, { headers: h })).json();
  assert.equal(bin.binary, true);

  const big = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=big`, { headers: h })).json();
  assert.equal(big.tooLarge, true);

  const bad = await fetch(`http://127.0.0.1:${port}/file?id=s1&path=../x`, { headers: h });
  assert.equal(bad.status, 400);

  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (endpoint inexistente / `FILE_MAX_BYTES` undefined).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/config.js`, junto a `UPLOAD_MAX_BYTES` agregar:

```js
  FILE_MAX_BYTES: num(process.env.HABITAT_FILE_MAX_BYTES, 1024 * 1024),
```

En `habitat/server/index.js`, asegurar que `readFile` esté en el import de
`node:fs/promises` (agregarlo si falta junto a `readdir, stat, realpath, …`).
Luego, después del bloque `GET /tree`, agregar:

```js
    if (req.method === 'GET' && url.pathname === '/file') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolveWithinRoot(root, rel);
      if (!target) { res.writeHead(400).end(); return; }
      let realTarget, realRoot, st;
      try { realTarget = await realpath(target); realRoot = await realpath(root); st = await stat(realTarget); }
      catch { res.writeHead(404).end(); return; }
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      if (!st.isFile()) { res.writeHead(400).end(); return; }
      const send = (obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      if (st.size > config.FILE_MAX_BYTES) { send({ tooLarge: true, size: st.size }); return; }
      let buf;
      try { buf = await readFile(realTarget); } catch { res.writeHead(404).end(); return; }
      if (buf.includes(0)) { send({ binary: true, size: st.size }); return; }
      send({ text: buf.toString('utf8'), size: st.size });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/index.test.js server/config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint GET /file (preview con cap + binario)"
```

---

## Task 5: `POST /editor/open` + teardown de `${tmux}-edit` en `/kill`

**Files:**
- Modify: `habitat/server/index.js` (inyección `editor`; endpoint `POST /editor/open`; teardown en `/kill` ≈ línea 481)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `editor.openInEditor({ base, dir, file })` (Task 1), `readBody`, `resolveWithinRoot`, `tmux.killTmuxSession`.
- Produces: `POST /editor/open?id=` body `{ path }` → `200 <resultado de openInEditor>` | `401` | `409` | `400`. `/kill` además mata `${s.tmux||s.name}-edit`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js`:

```js
test('POST /editor/open llama openInEditor con base/dir/file y valida path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ed-'));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir, tmux: 'p-feat' }));
  const calls = [];
  const editor = { openInEditor: async (a) => { calls.push(a); return { ok: true, tmux: 'p-feat-edit' }; } };
  const { server } = createApp({ config, store, editor });
  const port = await listen(server);
  const h = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  const ok = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, { method: 'POST', headers: h, body: JSON.stringify({ path: 'src/a.js' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], { base: 'p-feat', dir, file: 'src/a.js' });

  const bad = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, { method: 'POST', headers: h, body: JSON.stringify({ path: '../../etc/passwd' }) });
  assert.equal(bad.status, 400);

  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('/kill también mata la sesión de editor -edit', async () => {
  const killed = [];
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: '/wt/p', tmux: 'p-feat', project: 'p', branch: 'feat' }));
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async (n) => { killed.push(n); return true; },
  };
  const { server } = createApp({ config: { ...config, ALLOW_SPAWN: true, WORKTREES_DIR: '' }, store, tmux });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's1' }),
  });
  assert.equal(res.status, 200);
  assert.ok(killed.includes('p-feat'), 'mata la sesión del agente');
  assert.ok(killed.includes('p-feat-edit'), 'mata la sesión de editor');
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (endpoint inexistente; `-edit` no se mata).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/index.js`:

1. Import del módulo editor (cerca de los otros imports de servidor):

```js
import { openInEditor } from './editor.js';
```

2. Inyección en `createApp` — en la firma agregar el parámetro `editor` con default:
   en la línea de `createApp({ ..., git: gitOverrides = {} })` agregar `, editor = { openInEditor }`.

3. Endpoint, junto a los otros endpoints POST:

```js
    if (req.method === 'POST' && url.pathname === '/editor/open') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const path = body && body.path;
      if (typeof path !== 'string' || !path || resolveWithinRoot(s.cwd, path) === null) { res.writeHead(400).end(); return; }
      const base = s.tmux || s.name;
      const r = await editor.openInEditor({ base, dir: s.cwd, file: path });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      return;
    }
```

4. Teardown en `/kill`: justo después de
   `await tmux.killTmuxSession(s.tmux || s.name);` agregar:

```js
      await tmux.killTmuxSession(`${s.tmux || s.name}-edit`); // best-effort: terminal de editor
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): POST /editor/open + teardown de sesión de editor"
```

---

## Task 6: Composable `useProjectTree`

**Files:**
- Create: `habitat/client/src/composables/useProjectTree.ts`

**Interfaces:**
- Produces: tipos `TreeEntry`, `TreeListing`, `FileContent`; `useProjectTree()` → `{ listing, loading, error, loadTree(id,path?), loadFile(id,path), openInNvim(id,path) }`.

- [ ] **Step 1: Write the implementation**

> Composable de I/O sobre `fetch` (como `useFiles`/`useGitChanges`); se verifica por typecheck.

Crear `habitat/client/src/composables/useProjectTree.ts`:

```ts
import { ref } from 'vue'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface TreeEntry { name: string; rel: string; isDir: boolean; size: number }
export interface TreeListing {
  root: string
  rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: TreeEntry[]
}
export type FileContent =
  | { text: string; size: number }
  | { binary: true; size: number }
  | { tooLarge: true; size: number }

export function useProjectTree() {
  const listing = ref<TreeListing | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadTree(id: string, path = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(
        `/tree?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      listing.value = (await res.json()) as TreeListing
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  async function loadFile(id: string, path: string): Promise<FileContent> {
    const res = await fetch(
      `/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
      { headers: authHeaders() },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FileContent
  }

  async function openInNvim(id: string, path: string): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch(`/editor/open?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as { ok: boolean; message?: string }
  }

  return { listing, loading, error, loadTree, loadFile, openInNvim }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/composables/useProjectTree.ts
git commit -m "feat(habitat): composable useProjectTree"
```

---

## Task 7: `useTerminal` opción `role` + `EditorTerminal.vue`

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (signatura `opts` + URL `/term`, ≈ línea 101 y 286)
- Create: `habitat/client/src/components/EditorTerminal.vue`
- Test: `habitat/client/src/composables/useTerminal.test.ts` (debe seguir verde)

**Interfaces:**
- Consumes: `useTerminal(container, id, { role?: 'edit' })`.
- Produces: `EditorTerminal.vue` props `{ id: string }`, emits `close`.

- [ ] **Step 1: Modificar `useTerminal` (no romper lo existente)**

En `habitat/client/src/composables/useTerminal.ts`:

1. Extender el tipo de `opts` (≈ línea 101) de `{ onCopied?: () => void }` a:

```ts
  opts: { onCopied?: () => void; role?: string } = {},
```

2. En la construcción de la URL del WS (≈ línea 286), agregar el `role`:

```ts
    ws = new WebSocket(`${proto}://${location.host}/term?id=${encodeURIComponent(sessionId)}${opts.role ? `&role=${encodeURIComponent(opts.role)}` : ''}${tok ? `&token=${tok}` : ''}`)
```

> Sin `role`, la URL queda idéntica a la actual — el uso en `DetailPanel` no cambia.

- [ ] **Step 2: Verificar que los tests existentes de useTerminal siguen verdes**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: PASS (sin cambios de comportamiento para el caso sin `role`).

- [ ] **Step 3: Crear `EditorTerminal.vue`**

> **Importante:** NO atar `Escape` para cerrar — Escape es de vim. El overlay se
> cierra solo con el botón `✕`.

Crear `habitat/client/src/components/EditorTerminal.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useTerminal } from '../composables/useTerminal'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const termEl = ref<HTMLElement | null>(null)
const idRef = ref<string>(props.id)
useTerminal(termEl, idRef, { role: 'edit' })
</script>

<template>
  <div class="ed-overlay">
    <header class="ed-head">
      <span class="ed-title">✎ Editor — nvim</span>
      <button class="ed-x" @click="emit('close')" title="Cerrar (nvim sigue vivo)">✕</button>
    </header>
    <div ref="termEl" class="ed-term"></div>
  </div>
</template>

<style scoped>
.ed-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); display: flex; flex-direction: column; z-index: 7; }
.ed-head { display: flex; align-items: center; justify-content: space-between; padding: .4rem .7rem; border-bottom: 1px solid var(--color-line, #3a2e22); color: var(--color-ink, #e8dcc0); }
.ed-title { font-weight: 700; }
.ed-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.ed-term { flex: 1; min-height: 0; padding: 4px; }
</style>
```

- [ ] **Step 4: Verify build**

Run: `cd habitat/client && npm run build`
Expected: PASS (vue-tsc + vite, sin errores TS).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/components/EditorTerminal.vue
git commit -m "feat(habitat): useTerminal role=edit + EditorTerminal.vue"
```

---

## Task 8: `ProjectExplorer.vue` + wiring en `DetailPanel.vue`

**Files:**
- Create: `habitat/client/src/components/ProjectExplorer.vue`
- Modify: `habitat/client/src/components/DetailPanel.vue` (import, refs, botón header, render overlays, Escape, watch selectedId)

**Interfaces:**
- Consumes: `useProjectTree` (Task 6), `EditorTerminal` (Task 7).
- Props: `id: string`. Emits: `close`, `opened` (cuando se abrió un archivo en nvim, para que el padre muestre la terminal de editor).

- [ ] **Step 1: Crear `ProjectExplorer.vue`**

Crear `habitat/client/src/components/ProjectExplorer.vue`:

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useProjectTree, type TreeEntry, type FileContent } from '../composables/useProjectTree'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const { listing, loading, error, loadTree, loadFile, openInNvim } = useProjectTree()
const cwd = ref('')
const preview = ref<{ path: string; content: FileContent } | null>(null)
const busy = ref('')
const actionErr = ref('')

watch(() => props.id, (id) => { if (id) { cwd.value = ''; preview.value = null; loadTree(id) } }, { immediate: true })

function openEntry(e: TreeEntry) {
  if (e.isDir) { cwd.value = e.rel; preview.value = null; loadTree(props.id, e.rel) }
  else showPreview(e.rel)
}
async function showPreview(rel: string) {
  actionErr.value = ''
  try { preview.value = { path: rel, content: await loadFile(props.id, rel) } }
  catch { actionErr.value = 'no se pudo leer el archivo' }
}
async function editInNvim(rel: string) {
  busy.value = rel; actionErr.value = ''
  const r = await openInNvim(props.id, rel)
  busy.value = ''
  if (r.ok) emit('opened')
  else actionErr.value = r.message || 'no se pudo abrir nvim'
}
function goCrumb(rel: string) { cwd.value = rel; preview.value = null; loadTree(props.id, rel) }
function goRoot() { cwd.value = ''; preview.value = null; loadTree(props.id, '') }

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (preview.value) preview.value = null; else emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pe-overlay">
    <header class="pe-head">
      <span class="pe-title">🗂 Proyecto</span>
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="goRoot">{{ listing?.root || '~' }}</button>
        <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="goCrumb(c.rel)">{{ c.name }}</button>
        </template>
      </nav>
      <button class="pe-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <p v-if="actionErr" class="pe-err">{{ actionErr }}</p>

    <div class="pe-body">
      <ul class="pe-list">
        <li v-if="loading" class="pe-muted">cargando…</li>
        <li v-else-if="error === 'sin-dir'" class="pe-muted">sesión sin working dir</li>
        <li v-else-if="error" class="pe-muted">no se pudo listar ({{ error }})</li>
        <li v-for="e in listing?.entries || []" :key="e.rel"
            @click="openEntry(e)" @dblclick="!e.isDir && editInNvim(e.rel)">
          <span class="ico">{{ e.isDir ? '📁' : '📄' }}</span>
          <span class="nm">{{ e.name }}</span>
        </li>
      </ul>

      <div class="pe-preview" v-if="preview">
        <header>
          <b>{{ preview.path }}</b>
          <button class="pe-edit" :disabled="busy === preview.path" @click="editInNvim(preview.path)">✎ editar en nvim</button>
        </header>
        <pre v-if="'text' in preview.content" class="pe-code">{{ preview.content.text }}</pre>
        <p v-else-if="'binary' in preview.content" class="pe-muted">archivo binario ({{ preview.content.size }} bytes)</p>
        <p v-else class="pe-muted">archivo muy grande ({{ preview.content.size }} bytes) — <button class="pe-edit" @click="editInNvim(preview.path)">abrir en nvim</button></p>
      </div>
      <div class="pe-preview pe-empty" v-else><p class="pe-muted">Elegí un archivo para previsualizar. Doble-click o "editar en nvim" para editarlo.</p></div>
    </div>
  </div>
</template>

<style scoped>
.pe-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; }
.pe-head { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-title { font-weight: 700; }
.pe-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; flex: 1; overflow: hidden; }
.pe-crumb { background: none; border: none; color: var(--color-brass, #c79a4b); cursor: pointer; font-family: ui-monospace, monospace; }
.pe-sep { color: var(--color-line, #3a2e22); }
.pe-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.pe-err { color: #d2553f; padding: 0 .75rem; font-size: .82rem; }
.pe-body { flex: 1; display: flex; min-height: 0; }
.pe-list { list-style: none; margin: 0; padding: .3rem 0; overflow: auto; width: 38%; border-right: 1px solid var(--color-line, #3a2e22); }
.pe-list li { display: flex; align-items: center; gap: .5rem; padding: .2rem .7rem; cursor: pointer; font-family: ui-monospace, monospace; font-size: .85rem; }
.pe-list li:hover { background: rgba(255,255,255,.05); }
.pe-list .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-preview { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pe-preview header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .4rem .7rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-edit { cursor: pointer; background: var(--color-brass, #c79a4b); color: #1a1410; border: none; border-radius: var(--radius-sm, 4px); padding: .25rem .6rem; font-weight: 700; }
.pe-edit:disabled { opacity: .5; cursor: default; }
.pe-code { flex: 1; overflow: auto; margin: 0; padding: .6rem .7rem; font-family: ui-monospace, monospace; font-size: .8rem; white-space: pre; }
.pe-muted { opacity: .65; padding: .7rem; font-size: .85rem; }
.pe-empty { align-items: center; justify-content: center; }

@media (max-width: 640px) {
  .pe-body { flex-direction: column; }
  .pe-list { width: auto; border-right: none; border-bottom: 1px solid var(--color-line, #3a2e22); max-height: 40%; }
}
</style>
```

- [ ] **Step 2: Wirear en `DetailPanel.vue`**

READ `habitat/client/src/components/DetailPanel.vue` y ubicá los anchors reales
(import block; `onKey`; refs `filesOpen`/`changesOpen` y sus `watch(selectedId, …)`;
botones `.tool` del header; render de `<ChangesPanel>`/`<FileBrowser>`). Insertá
junto a ellos:

1. Imports (junto a `ChangesPanel`/`FileBrowser`):
```ts
import ProjectExplorer from './ProjectExplorer.vue'
import EditorTerminal from './EditorTerminal.vue'
```
2. Refs (junto a `changesOpen`):
```ts
const explorerOpen = ref(false)
const editorOpen = ref(false)
```
3. `onKey` Escape — extender para cerrar el explorador (NO el editor, su Escape es de vim):
```ts
// agregar dentro del if (e.key === 'Escape'):  explorerOpen.value = false
```
4. Cerrar al cambiar de sesión (junto a los otros `watch(selectedId, …)`):
```ts
watch(selectedId, () => { explorerOpen.value = false; editorOpen.value = false })
```
5. Botón en el header (junto al de "Cambios"/"Archivos"):
```html
<button class="tool" @click="explorerOpen = !explorerOpen" title="Explorador de proyecto">🗂 Proyecto</button>
```
6. Render de los overlays (junto a `<ChangesPanel>`/`<FileBrowser>`):
```html
<ProjectExplorer v-if="explorerOpen" :id="store.selected.id" @close="explorerOpen = false" @opened="editorOpen = true" />
<EditorTerminal v-if="editorOpen" :id="store.selected.id" @close="editorOpen = false" />
```

> El flujo: "🗂 Proyecto" abre el explorador; al abrir un archivo en nvim
> (`@opened`) se monta `EditorTerminal` (atachado a `/term?role=edit`). El
> explorador puede quedar abierto detrás; cerrar el editor deja nvim vivo.

- [ ] **Step 3: Verify build**

Run: `cd habitat/client && npm run build`
Expected: PASS (vue-tsc + vite, sin errores).

- [ ] **Step 4: Verificación manual (smoke)**

Con server (`cd habitat && HABITAT_TOKEN=x npm start`) y front, en una sesión con worktree:
- "🗂 Proyecto" abre el explorador; se ven dotfiles y `.git/`.
- Single-click en un archivo de texto → preview; binario → "binario"; grande → aviso.
- "✎ editar en nvim" (o doble-click) → aparece la terminal de editor con nvim sobre el archivo, en sesión `<tmux>-edit` separada de la del agente.
- Abrir un segundo archivo → mismo nvim hace `:e`.
- Cerrar el editor (`✕`) deja nvim vivo; cerrar la sesión (kill) mata `<tmux>-edit`.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/ProjectExplorer.vue habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): ProjectExplorer + wiring en DetailPanel"
```

---

## Self-Review (completado por el autor del plan)

**Spec coverage:**
- `/tree` árbol completo (dotfiles + `.git/`) → Task 3. ✅
- Preview read-only con cap + binario (`/file`) → Task 4 + Task 8 (panel preview). ✅
- Abrir en nvim, sesión `${tmux}-edit` dedicada, crear vs `:e` → Task 1 + Task 5. ✅
- `/term?role=edit` atachea la terminal de editor → Task 2 + Task 7 (`EditorTerminal`). ✅
- Click = preview, doble-click / botón = nvim → Task 8. ✅
- Cleanup de `${tmux}-edit` al cerrar sesión → Task 5. ✅
- Sin gate nuevo (auth de terminal) → no se agrega flag; endpoints solo `authorize`. ✅
- Seguridad (scope `s.cwd`, `resolveWithinRoot`, target derivado, `--`, rechazo `-`, cap) → Tasks 1,3,4,5. ✅
- Testing server (deps inyectables) + client (typecheck/build) → Tasks 1-8. ✅

**Placeholder scan:** sin TBD/TODO; cada step de código trae el código completo. La única "nota" (aserción explícita del create en Task 1) da el valor exacto a usar, no es un placeholder.

**Type consistency:** `TreeEntry`/`TreeListing`/`FileContent` consistentes entre `useProjectTree.ts`, el JSON de `/tree`·`/file`, y `ProjectExplorer.vue`. `editorSessionName`/`editTarget` ambos producen `${base}-edit` (server) y el cliente nunca arma ese nombre. `useTerminal(container, id, { role })` coincide entre el cambio (Task 7) y `EditorTerminal`. Nombres de eventos (`opened`/`close`) coinciden entre `ProjectExplorer` y el wiring de `DetailPanel`.
