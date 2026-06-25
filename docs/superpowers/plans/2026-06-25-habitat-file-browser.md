# File Browser + Upload en el pod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir mandarle archivos (especialmente imágenes) a Claude desde el habitat: un file browser por pod, con upload desde la máquina local y "tipeo" del path en la terminal.

**Architecture:** El server (Node `http` nativo, sin Express) expone `GET /files` y `POST /files/upload` rooteados en el `cwd` del pod, con la lógica testeable extraída a `files.js` (puro). El cliente (Vue 3 + xterm) suma un overlay `FileBrowser.vue` (espeja `QuestBook.vue`) que lista/sube archivos y, al elegir uno, escribe su path en la terminal vía el WS `/term` ya existente.

**Tech Stack:** Node.js (`node:http`, `node:fs/promises`), `node:test`; Vue 3 `<script setup>` + TypeScript, Vite, Vitest; `@xterm/xterm`.

## Global Constraints

- **Sin dependencias nuevas** en el server (es deliberadamente dependency-light: `http` nativo, no Express). Upload por **body crudo**, no multipart.
- **Todos los endpoints detrás de `authorize()`** (header `Authorization: Bearer <TOKEN>`; el cliente lo arma con `token()` desde `?token=`).
- **Guards de seguridad** en todo acceso a fs: `resolve` + guard sintáctico de root + `realpath` + guard anti-symlink (patrón de `/projects/browse` en `index.js`).
- **Root del browser = `cwd` del pod** (`store.get(id).cwd`). Pod sin `cwd` → `409`.
- **Uploads van a `<cwd>/.habitat-uploads/`** (subcarpeta fija en la raíz del working dir).
- **Cap por defecto 25 MB** (`HABITAT_UPLOAD_MAX_BYTES`), destrabable solo con `HABITAT_UPLOAD_PASSWORD` (env var dedicada; si está vacía, no hay escape).
- **Idioma:** comentarios y textos de UI en español, como el resto del repo.
- **`habitat/server/index.test.js` NO corre en el worktree** (falla pre-existente al importar `ws`). Por eso la lógica testeable vive en `files.js` (`node:test`) y los tests de cliente en Vitest. Las rutas se verifican con la app corriendo.

---

## File Structure

**Server (`habitat/server/`):**
- `config.js` — *modificar*: agregar `UPLOAD_PASSWORD`, `UPLOAD_MAX_BYTES`.
- `state.js` — *modificar*: agregar `cwd: ''` a `newSession`.
- `hooks-logic.js` — *modificar*: setear `s.cwd = payload.cwd` en `SessionStart`.
- `files.js` — *crear*: helpers puros (`sanitizeFilename`, `resolveWithinRoot`, `uniqueName`, `maxUploadBytes`).
- `files.test.js` — *crear*: tests `node:test` de los helpers.
- `index.js` — *modificar*: rutas `GET /files` y `POST /files/upload` + `readBodyCapped`.

**Client (`habitat/client/src/`):**
- `composables/useTerminal.ts` — *modificar*: agregar y retornar `insert(text)`.
- `composables/useFiles.ts` — *crear*: `useFiles()` (list/upload) + `quotePath()` puro.
- `composables/useFiles.test.ts` — *crear*: test Vitest de `quotePath`.
- `composables/useTerminal.test.ts` — *modificar*: test de `insert`… (ver Task 5; usa helper puro).
- `components/FileBrowser.vue` — *crear*: overlay del browser (espeja `QuestBook.vue`).
- `components/DetailPanel.vue` — *modificar*: botón `📁`, estado `filesOpen`, montar `FileBrowser`, conectar `pick → insert`.

---

## Task 1: Persistir `cwd` en el pod

**Files:**
- Modify: `habitat/server/state.js` (función `newSession`, ~línea 11-25)
- Modify: `habitat/server/hooks-logic.js` (case `SessionStart`, ~línea 126-138)
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Produces: el objeto sesión ahora tiene campo público `cwd: string` (viaja en snapshot y se persiste). Lo consumen las rutas de Task 3 y Task 4 vía `store.get(id).cwd`.

- [ ] **Step 1: Escribir el test que falla**

En `habitat/server/hooks-logic.test.js`, agregar después del test `'SessionStart setea branch desde deps.gitBranch(cwd)'`:

```js
test('SessionStart persiste el cwd en la sesión', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.cwd, '/home/u/proj-api');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: FAIL — `session.cwd` es `undefined` (no existe el campo ni la asignación).

- [ ] **Step 3: Agregar el campo `cwd` a `newSession`**

En `habitat/server/state.js`, dentro del objeto que devuelve `newSession`, agregar `cwd: ''` justo después de `branch: '',`:

```js
    name: '',
    project: '',
    branch: '',
    cwd: '',
    status: 'idle',
```

- [ ] **Step 4: Setear `s.cwd` en el `SessionStart`**

En `habitat/server/hooks-logic.js`, dentro de `case 'SessionStart':`, en el bloque `if (payload.cwd) { ... }`, agregar `s.cwd = payload.cwd;` al principio del bloque (antes de derivar `s.name`):

```js
    case 'SessionStart': {
      if (payload.cwd) {
        s.cwd = payload.cwd;
        // El nombre del pod es el personaje (leaf del worktree). El proyecto real sale
        // del worktree (su carpeta padre); fuera de un worktree, proyecto = name.
        s.name = basename(payload.cwd);
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: PASS — todos los tests (incluido el nuevo) en verde.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/state.js habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): persistir cwd del pod en la sesión"
```

---

## Task 2: Helpers puros de archivos (`files.js`)

**Files:**
- Create: `habitat/server/files.js`
- Test: `habitat/server/files.test.js`

**Interfaces:**
- Produces:
  - `sanitizeFilename(name: string): string` — devuelve solo el basename, sin separadores ni `..`; vacío → `'archivo'`.
  - `resolveWithinRoot(root: string, rel: string): string | null` — path absoluto de `root/rel`, o `null` si escapa de `root` (traversal sintáctico).
  - `uniqueName(name: string, taken: Set<string>): string` — sufija `" (1)"`, `" (2)"`… antes de la extensión si `name` ya está en `taken`.
  - `maxUploadBytes({ cap, configuredPassword, providedPassword }): number` — `Infinity` si hay password configurada y la provista matchea; si no, `cap`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `habitat/server/files.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, resolveWithinRoot, uniqueName, maxUploadBytes } from './files.js';

test('sanitizeFilename deja solo el basename y descarta traversal', () => {
  assert.equal(sanitizeFilename('logo.png'), 'logo.png');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a/b/c.txt'), 'c.txt');
  assert.equal(sanitizeFilename('..'), 'archivo');
  assert.equal(sanitizeFilename(''), 'archivo');
  assert.equal(sanitizeFilename('  spaced name.jpg  '), 'spaced name.jpg');
});

test('resolveWithinRoot resuelve dentro y rechaza lo que escapa', () => {
  const root = '/home/u/proj';
  assert.equal(resolveWithinRoot(root, 'src'), '/home/u/proj/src');
  assert.equal(resolveWithinRoot(root, ''), root);
  assert.equal(resolveWithinRoot(root, '/abs'), '/home/u/proj/abs'); // se le quita el / inicial
  assert.equal(resolveWithinRoot(root, '../otro'), null);
  assert.equal(resolveWithinRoot(root, 'a/../../x'), null);
});

test('uniqueName sufija ante colisión, respetando la extensión', () => {
  assert.equal(uniqueName('logo.png', new Set()), 'logo.png');
  assert.equal(uniqueName('logo.png', new Set(['logo.png'])), 'logo (1).png');
  assert.equal(uniqueName('logo.png', new Set(['logo.png', 'logo (1).png'])), 'logo (2).png');
  assert.equal(uniqueName('README', new Set(['README'])), 'README (1)');
});

test('maxUploadBytes: cap salvo password configurada y correcta', () => {
  const cap = 25 * 1024 * 1024;
  assert.equal(maxUploadBytes({ cap, configuredPassword: '', providedPassword: '' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: '', providedPassword: 'x' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: 'sec', providedPassword: 'nope' }), cap);
  assert.equal(maxUploadBytes({ cap, configuredPassword: 'sec', providedPassword: 'sec' }), Infinity);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat && node --test server/files.test.js`
Expected: FAIL — `Cannot find module './files.js'`.

- [ ] **Step 3: Implementar `files.js`**

Crear `habitat/server/files.js`:

```js
import { resolve, sep } from 'node:path';

// Nombre seguro: solo el basename, sin separadores ni '..'. Vacío -> 'archivo'.
export function sanitizeFilename(name) {
  const norm = String(name || '').replace(/\\/g, '/');
  let base = norm.slice(norm.lastIndexOf('/') + 1).trim();
  if (!base || base === '.' || base === '..') return 'archivo';
  return base;
}

// Resuelve `rel` dentro de `root`; null si el resultado escapa de `root`
// (guard sintáctico de path-traversal). El guard anti-symlink va aparte (realpath).
export function resolveWithinRoot(root, rel) {
  const clean = String(rel || '').replace(/^\/+/, '');
  const target = resolve(root, clean);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

// Sufija " (1)", " (2)"… antes de la extensión si `name` ya existe en `taken`.
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate;
  do { candidate = `${stem} (${i})${ext}`; i++; } while (taken.has(candidate));
  return candidate;
}

// Máximo de bytes permitido: el cap normal, o Infinity si hay password
// configurada y la provista matchea. Sin password configurada, siempre el cap.
export function maxUploadBytes({ cap, configuredPassword, providedPassword }) {
  if (configuredPassword && providedPassword === configuredPassword) return Infinity;
  return cap;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd habitat && node --test server/files.test.js`
Expected: PASS — 4 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/files.js habitat/server/files.test.js
git commit -m "feat(habitat): helpers puros de archivos (sanitize, root guard, cap)"
```

---

## Task 3: Endpoint `GET /files` (listar working dir)

**Files:**
- Modify: `habitat/server/index.js` (imports ~línea 2-4; nueva ruta tras el bloque `/projects/browse`, ~línea 184)

**Interfaces:**
- Consumes: `store.get(id).cwd` (Task 1); `resolveWithinRoot` (Task 2).
- Produces: `GET /files?id=<pod>&path=<rel>` → `200` JSON `{ root, rel, breadcrumbs: [{name, rel}], entries: [{name, rel, isDir, size}] }`; `409` si el pod no tiene `cwd`; `400`/`404` por guards.

- [ ] **Step 1: Sumar imports de fs**

En `habitat/server/index.js`, ampliar el import de `node:fs/promises` (línea 2) para incluir `stat`, y sumar el import de `files.js`:

```js
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
```

Y debajo del import de `worktree.js` (línea 16) agregar (solo lo que usa esta task; Task 4 extiende este import):

```js
import { resolveWithinRoot } from './files.js';
```

- [ ] **Step 2: Agregar la ruta `GET /files`**

En `habitat/server/index.js`, inmediatamente después del bloque que cierra `GET /projects/browse` (la línea `return;` y `}` de ~línea 183-184) y antes de `async function dirWithinRoot(dir)`, insertar:

```js
    if (req.method === 'GET' && url.pathname === '/files') {
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
      // Guard anti-symlink: el target real no puede salir del root real.
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = [];
      for (const d of dirents) {
        // Ocultar dotfiles, salvo la carpeta de uploads (para ver lo subido).
        if (d.name.startsWith('.') && d.name !== '.habitat-uploads') continue;
        const abs = join(realTarget, d.name);
        let size = 0;
        if (!d.isDirectory()) { try { size = (await stat(abs)).size; } catch { size = 0; } }
        entries.push({ name: d.name, rel: relative(realRoot, abs), isDir: d.isDirectory(), size });
      }
      // Carpetas primero, después archivos; alfabético dentro de cada grupo.
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }
```

- [ ] **Step 3: Verificar sintaxis / arranque del módulo**

Run: `cd habitat && node --check server/index.js`
Expected: sin salida (sintaxis OK). *(No corremos `index.test.js`: falla pre-existente al importar `ws`.)*

- [ ] **Step 4: Verificación manual rápida (opcional pero recomendada)**

Con el server corriendo y un pod activo con `cwd`, en el navegador/curl:
Run: `curl -s "http://127.0.0.1:8377/files?id=<POD_ID>&path=" -H "Authorization: Bearer $HABITAT_TOKEN" | head`
Expected: JSON con `root`, `entries` (carpetas y archivos del working dir).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js
git commit -m "feat(habitat): GET /files lista el working dir del pod"
```

---

## Task 4: Config + endpoint `POST /files/upload`

**Files:**
- Modify: `habitat/server/config.js` (objeto export, ~línea 11-23)
- Modify: `habitat/server/index.js` (helper `readBodyCapped` cerca de `readBody` ~línea 29; nueva ruta tras `GET /files`)

**Interfaces:**
- Consumes: `store.get(id).cwd` (Task 1); `sanitizeFilename`, `uniqueName`, `maxUploadBytes` (Task 2); `config.UPLOAD_PASSWORD`, `config.UPLOAD_MAX_BYTES`.
- Produces: `POST /files/upload?id=<pod>` con body crudo + headers `X-Filename` (URI-encoded), `X-Upload-Password` → `200` JSON `{ rel }` (path relativo guardado, ej. `.habitat-uploads/logo.png`); `409` sin cwd; `413` si excede el cap sin password válida; `400` por guards.

- [ ] **Step 1: Agregar las claves de config**

En `habitat/server/config.js`, dentro del objeto `export default`, agregar tras `SETTINGS_PATH`:

```js
  SETTINGS_PATH: process.env.HABITAT_SETTINGS || join(HERE, '..', '.settings.json'),
  UPLOAD_PASSWORD: process.env.HABITAT_UPLOAD_PASSWORD || '',
  UPLOAD_MAX_BYTES: num(process.env.HABITAT_UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
};
```

- [ ] **Step 2: Agregar el helper `readBodyCapped`**

En `habitat/server/index.js`, justo después de la función `readBody` (~línea 36), agregar:

```js
// Lee el body como Buffer, abortando si supera `maxBytes` (cap real de upload,
// no solo el header Content-Length). Rechaza con 'too large' si se pasa.
function readBodyCapped(req, maxBytes) {
  return new Promise((resolveP, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { tooBig = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveP(Buffer.concat(chunks)));
    req.on('error', () => reject(new Error('body error')));
    req.on('close', () => { if (tooBig) reject(new Error('too large')); });
  });
}
```

- [ ] **Step 3: Sumar imports de fs y de files.js**

Ampliar el import de `node:fs/promises` (que en Task 3 quedó `readFile, readdir, realpath, stat`) para incluir `mkdir` y `writeFile`:

```js
import { readFile, readdir, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
```

Y extender el import de `./files.js` (que en Task 3 quedó `{ resolveWithinRoot }`) para sumar los helpers que usa el upload:

```js
import { resolveWithinRoot, sanitizeFilename, uniqueName, maxUploadBytes } from './files.js';
```

- [ ] **Step 4: Agregar la ruta `POST /files/upload`**

En `habitat/server/index.js`, inmediatamente después del bloque `GET /files` (Task 3), insertar:

```js
    if (req.method === 'POST' && url.pathname === '/files/upload') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      let rawName = req.headers['x-filename'] || '';
      try { rawName = decodeURIComponent(rawName); } catch { /* dejar tal cual */ }
      const name = sanitizeFilename(rawName);
      const max = maxUploadBytes({
        cap: config.UPLOAD_MAX_BYTES,
        configuredPassword: config.UPLOAD_PASSWORD,
        providedPassword: req.headers['x-upload-password'] || '',
      });
      let body;
      try { body = await readBodyCapped(req, max); }
      catch (e) { res.writeHead(e.message === 'too large' ? 413 : 400).end(); return; }
      const dir = resolveWithinRoot(root, '.habitat-uploads');
      if (!dir) { res.writeHead(400).end(); return; }
      await mkdir(dir, { recursive: true });
      let taken;
      try { taken = new Set(await readdir(dir)); } catch { taken = new Set(); }
      const finalName = uniqueName(name, taken);
      await writeFile(join(dir, finalName), body);
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ rel: join('.habitat-uploads', finalName) }));
      return;
    }
```

- [ ] **Step 5: Verificar sintaxis**

Run: `cd habitat && node --check server/index.js && node --check server/config.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 6: Verificación manual (recomendada)**

Con server + pod activo:
Run:
```bash
echo "hola" > /tmp/test.txt
curl -s -X POST "http://127.0.0.1:8377/files/upload?id=<POD_ID>" \
  -H "Authorization: Bearer $HABITAT_TOKEN" -H "X-Filename: test.txt" \
  --data-binary @/tmp/test.txt
```
Expected: `{"rel":".habitat-uploads/test.txt"}` y el archivo aparece en `<cwd>/.habitat-uploads/test.txt`.

- [ ] **Step 7: Commit**

```bash
git add habitat/server/config.js habitat/server/index.js
git commit -m "feat(habitat): POST /files/upload con cap y escape por password"
```

---

## Task 5: `useTerminal.insert()` — escribir en la terminal

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (función `setup`/retorno, ~línea 24-95)

**Interfaces:**
- Produces: `useTerminal(...)` ahora retorna `{ fit, insert }`, donde `insert(text: string): void` escribe `text` al PTY (igual que tipear) si el WS está abierto; no-op si está cerrado.

- [ ] **Step 1: Implementar `insert` y retornarlo**

En `habitat/client/src/composables/useTerminal.ts`, agregar la función `insert` junto a `fit`/`sendResize` (después de `sendResize`, ~línea 28) y retornarla. La closure usa las variables `ws` y `enc` del scope del composable:

```ts
  function sendResize() {
    if (ws && ws.readyState === 1 && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }

  // Escribe texto al PTY como si se tipeara (lo usa el file browser para insertar
  // el path de un archivo en el prompt de Claude). No-op si el WS no está abierto.
  function insert(text: string) {
    if (ws && ws.readyState === 1) ws.send(enc.encode(text))
  }
```

Y cambiar el retorno final (`return { fit }`, ~línea 94):

```ts
  return { fit, insert }
```

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npx vue-tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificar que los tests existentes siguen pasando**

Run: `cd habitat/client && npx vitest run`
Expected: PASS — la suite completa (incluye `useTerminal.test.ts`) sigue verde.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts
git commit -m "feat(habitat): useTerminal expone insert() para escribir en el PTY"
```

---

## Task 6: Composable `useFiles` + `quotePath`

**Files:**
- Create: `habitat/client/src/composables/useFiles.ts`
- Test: `habitat/client/src/composables/useFiles.test.ts`

**Interfaces:**
- Produces:
  - `quotePath(p: string): string` — envuelve en comillas dobles si `p` contiene espacios; si no, lo deja igual.
  - `useFiles()` → `{ listing, loading, error, list(id, path?), upload(id, file, password?) }`.
    - `list(id: string, path?: string): Promise<void>` — puebla `listing` (o `error='sin-dir'` ante 409).
    - `upload(id: string, file: File, password?: string): Promise<{ rel: string }>` — `POST /files/upload`; lanza `{ tooLarge: true }` ante `413`.
  - Tipos: `FileEntry { name; rel; isDir; size }`, `FileListing { root; rel; breadcrumbs: {name; rel}[]; entries: FileEntry[] }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/composables/useFiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { quotePath } from './useFiles'

describe('quotePath', () => {
  it('deja el path tal cual si no tiene espacios', () => {
    expect(quotePath('.habitat-uploads/logo.png')).toBe('.habitat-uploads/logo.png')
    expect(quotePath('src/main.ts')).toBe('src/main.ts')
  })
  it('envuelve en comillas si tiene espacios', () => {
    expect(quotePath('.habitat-uploads/mi captura.png')).toBe('".habitat-uploads/mi captura.png"')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useFiles.test.ts`
Expected: FAIL — no existe el módulo `./useFiles`.

- [ ] **Step 3: Implementar `useFiles.ts`**

Crear `habitat/client/src/composables/useFiles.ts`:

```ts
import { ref } from 'vue'

// Token de la query, igual que useQuestBook/useProjects.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface FileEntry { name: string; rel: string; isDir: boolean; size: number }
export interface FileListing {
  root: string
  rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: FileEntry[]
}

// Cita el path con comillas dobles si tiene espacios, para que Claude lo lea como
// un solo token al insertarlo en el prompt.
export function quotePath(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p
}

export function useFiles() {
  const listing = ref<FileListing | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function list(id: string, path = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(
        `/files?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      listing.value = (await res.json()) as FileListing
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  // Sube `file` por body crudo. Ante 413 lanza { tooLarge: true } para que la UI
  // pida la contraseña y reintente con `password`.
  async function upload(id: string, file: File, password?: string): Promise<{ rel: string }> {
    const headers: Record<string, string> = {
      ...authHeaders(),
      'x-filename': encodeURIComponent(file.name),
    }
    if (password) headers['x-upload-password'] = password
    const res = await fetch(`/files/upload?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers, body: file,
    })
    if (res.status === 413) throw { tooLarge: true }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { rel: string }
  }

  return { listing, loading, error, list, upload }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd habitat/client && npx vitest run src/composables/useFiles.test.ts`
Expected: PASS — 2 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useFiles.ts habitat/client/src/composables/useFiles.test.ts
git commit -m "feat(habitat): composable useFiles (list/upload) + quotePath"
```

---

## Task 7: Componente `FileBrowser.vue`

**Files:**
- Create: `habitat/client/src/components/FileBrowser.vue`

**Interfaces:**
- Consumes: `useFiles()` (Task 6).
- Produces: componente con prop `id: string` y eventos `(e: 'close')` y `(e: 'pick', rel: string)`. El padre (Task 8) traduce `pick` a escribir en la terminal.

- [ ] **Step 1: Implementar el componente**

Crear `habitat/client/src/components/FileBrowser.vue` (espeja el shell overlay de `QuestBook.vue`):

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFiles, type FileEntry } from '../composables/useFiles'
import { fmt } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'pick', rel: string): void }>()

const { listing, loading, error, list, upload } = useFiles()
const cwd = ref('') // rel actual dentro del working dir
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadErr = ref('')

watch(() => props.id, (id) => { if (id) { cwd.value = ''; list(id) } }, { immediate: true })

function open(entry: FileEntry) {
  if (entry.isDir) { cwd.value = entry.rel; list(props.id, entry.rel) }
  else emit('pick', entry.rel)
}
function goCrumb(rel: string) { cwd.value = rel; list(props.id, rel) }
function goRoot() { cwd.value = ''; list(props.id, '') }

function triggerUpload() { fileInput.value?.click() }

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // permitir re-subir el mismo archivo
  if (!file) return
  uploadErr.value = ''
  uploading.value = true
  try {
    await doUpload(file)
  } catch (err) {
    uploadErr.value = err instanceof Error ? err.message : 'falló la subida'
  } finally {
    uploading.value = false
  }
}

// Sube; si el server pide password (413), la pide y reintenta una vez.
async function doUpload(file: File) {
  try {
    const { rel } = await upload(props.id, file)
    afterUpload(rel)
  } catch (err) {
    if (err && (err as { tooLarge?: boolean }).tooLarge) {
      const pw = window.prompt(`"${file.name}" supera el límite. Contraseña para subirlo igual:`)
      if (!pw) { uploadErr.value = 'subida cancelada'; return }
      const { rel } = await upload(props.id, file, pw)
      afterUpload(rel)
    } else {
      throw err
    }
  }
}

function afterUpload(rel: string) {
  list(props.id, cwd.value) // refrescar para ver el archivo nuevo
  emit('pick', rel) // y ya insertarlo en la terminal
}
</script>

<template>
  <div class="fb-overlay" @click.self="emit('close')">
    <div class="fb-panel" role="dialog" aria-label="Archivos">
      <button class="fb-close" @click="emit('close')" aria-label="cerrar">✕</button>
      <header class="fb-head">
        <div class="fb-kicker">Archivos</div>
        <nav class="fb-crumbs">
          <button class="fb-crumb" @click="goRoot">{{ listing?.root || '~' }}</button>
          <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
            <span class="fb-sep">/</span>
            <button class="fb-crumb" @click="goCrumb(c.rel)">{{ c.name }}</button>
          </template>
        </nav>
      </header>

      <div v-if="loading" class="fb-state">Cargando…</div>
      <div v-else-if="error === 'sin-dir'" class="fb-state">Este pod no tiene un directorio asociado.</div>
      <div v-else-if="error" class="fb-state">No se pudo listar ({{ error }})</div>
      <ul v-else class="fb-list">
        <li v-for="entry in listing?.entries || []" :key="entry.rel">
          <button class="fb-item" @click="open(entry)">
            <span class="fb-ico">{{ entry.isDir ? '📁' : '📄' }}</span>
            <span class="fb-name">{{ entry.name }}</span>
            <span v-if="!entry.isDir" class="fb-size">{{ fmt(entry.size) }}</span>
          </button>
        </li>
        <li v-if="(listing?.entries || []).length === 0" class="fb-empty">Carpeta vacía</li>
      </ul>

      <footer class="fb-foot">
        <button class="fb-upload" :disabled="uploading" @click="triggerUpload">
          {{ uploading ? 'Subiendo…' : '⬆ Subir archivo' }}
        </button>
        <span v-if="uploadErr" class="fb-uperr">{{ uploadErr }}</span>
        <input ref="fileInput" type="file" hidden @change="onFile" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.5); z-index: 20; }
.fb-panel { position: relative; width: min(440px, 92%); max-height: 80%; display: flex; flex-direction: column; background: var(--surface, #1c1208); border: 1px solid #3a2a18; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.5); color: #e8dcc8; font-size: 13px; }
.fb-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #b9a888; cursor: pointer; font-size: 14px; }
.fb-head { padding: 12px 14px 8px; border-bottom: 1px solid #3a2a18; }
.fb-kicker { text-transform: uppercase; letter-spacing: .1em; font-size: 10px; color: #b9a888; }
.fb-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 4px; }
.fb-crumb { background: none; border: none; color: #d8b97a; cursor: pointer; padding: 0 2px; font-size: 12px; }
.fb-sep { color: #6b5638; }
.fb-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
.fb-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: inherit; cursor: pointer; padding: 6px 14px; text-align: left; }
.fb-item:hover { background: rgba(255,255,255,.05); }
.fb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-size { color: #8a7a5c; font-size: 11px; }
.fb-empty, .fb-state { padding: 16px 14px; color: #8a7a5c; }
.fb-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid #3a2a18; }
.fb-upload { background: #3a2a18; border: 1px solid #5a4326; color: #f0e2c8; border-radius: 5px; padding: 6px 12px; cursor: pointer; }
.fb-upload:disabled { opacity: .6; cursor: default; }
.fb-uperr { color: #e08a6a; font-size: 12px; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npx vue-tsc --noEmit`
Expected: sin errores. *(Verificar que `fmt` exista en `../sprites`; ya se usa en `DetailPanel.vue`.)*

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/components/FileBrowser.vue
git commit -m "feat(habitat): componente FileBrowser (overlay con listado y upload)"
```

---

## Task 8: Conectar el `FileBrowser` en el `DetailPanel`

**Files:**
- Modify: `habitat/client/src/components/DetailPanel.vue` (script ~línea 1-46; template ~línea 49-69)

**Interfaces:**
- Consumes: `FileBrowser.vue` (Task 7); `useTerminal().insert` (Task 5); `quotePath` (Task 6).

- [ ] **Step 1: Imports y estado en el script**

En `habitat/client/src/components/DetailPanel.vue`, agregar el import del componente y de `quotePath`, y capturar `insert` del composable.

Tras `import QuestBook from './QuestBook.vue'` (línea 3):

```ts
import QuestBook from './QuestBook.vue'
import FileBrowser from './FileBrowser.vue'
import { quotePath } from '../composables/useFiles'
```

Cambiar la desestructuración de `useTerminal` (línea 14) para capturar `insert`:

```ts
const { fit, insert } = useTerminal(termEl, selectedId)
```

Tras el bloque de `bookOpen` (línea 26-30), agregar el estado de archivos y el handler de `pick`:

```ts
const filesOpen = ref(false)
watch(selectedId, () => { filesOpen.value = false }) // cerrar al cambiar de sesión
function onPickFile(rel: string) {
  insert(quotePath(rel) + ' ') // escribir el path (con espacio final) en la terminal
  filesOpen.value = false
}
```

Y extender el handler de `Escape` (línea 28) para cerrar también el browser:

```ts
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { bookOpen.value = false; filesOpen.value = false } }
```

- [ ] **Step 2: Botón y componente en el template**

En el header del panel, junto al botón `bookbtn` (línea 63-65), agregar el botón `📁` antes del de Quest Book:

```html
        <button class="bookbtn" @click="filesOpen = !filesOpen" aria-label="archivos" title="Archivos">
          📁
        </button>
```

Y montar el componente junto a `<QuestBook .../>` (línea 69):

```html
      <QuestBook v-if="bookOpen" :id="store.selected.id" @close="bookOpen = false" />
      <FileBrowser v-if="filesOpen" :id="store.selected.id" @close="filesOpen = false" @pick="onPickFile" />
```

- [ ] **Step 3: Typecheck + tests**

Run: `cd habitat/client && npx vue-tsc --noEmit && npx vitest run`
Expected: sin errores de tipos; suite Vitest completa en verde.

- [ ] **Step 4: Build de producción**

Run: `cd habitat/client && npm run build`
Expected: build OK (sale a `../web`). *(El warning de tamaño de chunk es pre-existente.)*

- [ ] **Step 5: Verificación manual end-to-end**

Con el server corriendo (rebuildeado): abrir un pod, click en `📁`, navegar el working dir, subir una imagen desde la Mac, y confirmar que (a) aparece en `.habitat-uploads/`, y (b) al clickearla se escribe su path en la terminal. Pedirle a Claude que la lea.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): botón Archivos en el panel; pick escribe el path en la terminal"
```

---

## Cierre (workflow del repo)

Tras completar las tareas, seguir el flujo obligatorio del `CLAUDE.md`:

```bash
git fetch origin && git merge origin/main   # resolver conflictos si los hay
# correr verificaciones de lo tocado:
cd habitat && node --test server/files.test.js server/hooks-logic.test.js
cd client && npx vitest run && npx vue-tsc --noEmit
git push origin feat/habitat-file-browser
gh pr create --base main --head feat/habitat-file-browser
```

Recordar la **nota de despliegue**: requiere rebuildear el cliente (`npm run build` en `habitat/client`) y, para `cwd` en pods, que las sesiones disparen `SessionStart` (pods viejos sin `cwd` muestran el estado "sin directorio" hasta reiniciar su sesión).
