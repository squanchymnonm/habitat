# Gestión de proyectos desde la UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestionar la lista de proyectos spawneables desde la UI (alta con navegador de carpetas del servidor, baja, edición), con color por proyecto reflejado como tinte de fondo del pod y allowlist opcional de personajes.

**Architecture:** Un store persistido nuevo (`server/projects.js`, mismo patrón que `settings.js`: carga al iniciar + escritura atómica) es la fuente de verdad de la lista; `HABITAT_PROJECTS` solo lo siembra la primera vez. El server expone CRUD + un endpoint de navegación de carpetas acotado a `HABITAT_PROJECTS_ROOT`, y emite el estado por WS. El cliente consume la lista en `useProjects`, gestiona los proyectos en `ProjectsManager.vue` (dentro de Settings) y pinta cada pod con el color de su proyecto.

**Tech Stack:** Node.js (ESM, sin deps externas, `node:test`), Vue 3 + `<script setup>` + TypeScript, Vite, WebSocket.

## Global Constraints

- Sin dependencias nuevas: solo stdlib de Node y lo ya presente en el cliente.
- ESM en todo el server (`import`/`export`), igual que los módulos existentes.
- Tests con `node:test` + `node:assert/strict` en el server; el cliente usa Vitest (`*.test.ts`).
- La paleta de colores es una lista fija de hex **duplicada** entre `server/palette.js` y `client/src/palette.ts`; deben quedar idénticas (mismo contrato que `characters.js` ↔ `sprites.ts`).
- `CHARACTERS` canónico vive en `server/characters.js` y `client/src/sprites.ts`; no inventar personajes.
- Endpoints: todos requieren auth (token); los de escritura y `/projects/browse` requieren además `config.ALLOW_SPAWN`.
- Persistencia atómica: escribir a `<path>.tmp` y `renameSync` (nunca dejar un JSON a medias).
- Mensajes de UI en español, minúscula, igual que el resto del cliente.

---

## File Structure

**Crear:**
- `habitat/server/palette.js` — paleta fija de hex + selección determinística por seed.
- `habitat/server/projects.js` — store persistido de proyectos (CRUD + seed + validación).
- `habitat/server/projects.test.js` — tests del store.
- `habitat/client/src/palette.ts` — misma paleta para swatches/render.
- `habitat/client/src/components/ProjectsManager.vue` — UI de gestión (lista + alta con browser + editar/borrar).

**Modificar:**
- `habitat/server/config.js` — `PROJECTS_ROOT`, `PROJECTS_STATE`.
- `habitat/server/config.test.js` — defaults de las nuevas claves.
- `habitat/server/index.js` — wire del store; `GET /projects` desde el store; `/projects/browse`; `POST/PATCH/DELETE /projects`; spawn/kill usan el store + allowlist de chars.
- `habitat/server/index.test.js` — ajustar asserts de `/projects` y agregar casos nuevos.
- `habitat/client/src/types.ts` — `Project` + variante WS `projects`.
- `habitat/client/src/composables/useProjects.ts` — `color`/`chars`, acciones CRUD, `browse`, `colorForProject`, `applyServerProjects`.
- `habitat/client/src/composables/useSocket.ts` — manejar mensaje WS `projects`.
- `habitat/client/src/components/SessionPod.vue` — tinte de fondo por color de proyecto.
- `habitat/client/src/components/SpawnMenu.vue` — swatch por proyecto + filtro de personajes por allowlist.
- `habitat/client/src/components/SettingsView.vue` — montar `<ProjectsManager />`.
- `habitat/README.md` — documentar el nuevo flujo y env vars.

---

## Task 1: Paleta compartida + claves de config

**Files:**
- Create: `habitat/server/palette.js`
- Create: `habitat/client/src/palette.ts`
- Modify: `habitat/server/config.js:11-21`
- Test: `habitat/server/config.test.js`

**Interfaces:**
- Produces (server `palette.js`): `export const PALETTE` (array de 12 strings hex en minúscula); `export function pickColor(seed)` → un hex de `PALETTE` determinístico por `seed` (string).
- Produces (client `palette.ts`): `export const PALETTE` (mismos 12 hex, mismo orden).
- Produces (config): `config.PROJECTS_ROOT` (string, `''` por default), `config.PROJECTS_STATE` (string, ruta absoluta).

- [ ] **Step 1: Escribir el test de paleta+config**

Agregar al final de `habitat/server/config.test.js`:

```js
test('config: PROJECTS_ROOT y PROJECTS_STATE con defaults', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.PROJECTS_ROOT, 'string');
  assert.equal(typeof config.PROJECTS_STATE, 'string');
});

test('palette: PALETTE son 12 hex y pickColor es determinístico y miembro', async () => {
  const { PALETTE, pickColor } = await import('./palette.js');
  assert.equal(PALETTE.length, 12);
  assert.ok(PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  const a = pickColor('/home/u/proj-api');
  const b = pickColor('/home/u/proj-api');
  assert.equal(a, b);
  assert.ok(PALETTE.includes(a));
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd habitat && node --test server/config.test.js`
Expected: FAIL (`Cannot find module './palette.js'` y/o `PROJECTS_ROOT` undefined).

- [ ] **Step 3: Crear `habitat/server/palette.js`**

```js
// Paleta fija de colores de proyecto. DEBE quedar idéntica a
// habitat/client/src/palette.ts (mismo contrato duplicado client/server que
// characters.js <-> sprites.ts). Elegidos por contraste sobre --surface (#1a1a24).
export const PALETTE = [
  '#e7c14a', '#4ec9b0', '#6db74e', '#e06c75',
  '#61afef', '#c678dd', '#e59e54', '#56b6c2',
  '#d19a66', '#98c379', '#ff79c6', '#bd93f9',
];

// Color determinístico a partir de un seed (p.ej. el dir del proyecto): FNV-1a.
export function pickColor(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
```

- [ ] **Step 4: Crear `habitat/client/src/palette.ts`**

```ts
// Paleta fija de colores de proyecto. DEBE quedar idéntica a
// habitat/server/palette.js (mismo contrato duplicado client/server).
export const PALETTE = [
  '#e7c14a', '#4ec9b0', '#6db74e', '#e06c75',
  '#61afef', '#c678dd', '#e59e54', '#56b6c2',
  '#d19a66', '#98c379', '#ff79c6', '#bd93f9',
]
```

- [ ] **Step 5: Agregar las claves a `habitat/server/config.js`**

Dentro del objeto exportado por default, agregar (después de `WORKTREES_DIR`):

```js
  PROJECTS_ROOT: process.env.HABITAT_PROJECTS_ROOT || '',
  PROJECTS_STATE: process.env.HABITAT_PROJECTS_STATE || join(HERE, '..', '.projects.json'),
```

- [ ] **Step 6: Correr el test y verlo pasar**

Run: `cd habitat && node --test server/config.test.js`
Expected: PASS (incluye los dos nuevos tests).

- [ ] **Step 7: Commit**

```bash
git add habitat/server/palette.js habitat/client/src/palette.ts habitat/server/config.js habitat/server/config.test.js
git commit -m "feat(habitat): paleta de colores compartida + config PROJECTS_ROOT/PROJECTS_STATE"
```

---

## Task 2: Store de proyectos (`server/projects.js`)

**Files:**
- Create: `habitat/server/projects.js`
- Test: `habitat/server/projects.test.js`

**Interfaces:**
- Consumes: `PALETTE`, `pickColor` de `./palette.js`; `CHARACTERS` de `./characters.js`.
- Produces: `export function createProjects({ persistPath, seed = [] } = {})` que devuelve:
  - `list()` → `Array<{ dir, label, color, chars }>` (copias defensivas; `chars` es array).
  - `has(dir)` → `boolean`.
  - `add({ dir, label, color, chars })` → `{ ok: true, record }` o `{ ok: false, error }`. Valida: `dir` string no vacío y no duplicado; `color` ∈ `PALETTE`; `chars` (si viene) ⊂ `CHARACTERS`. `label` default = `basename(dir)`. `chars` default = `[]`. Persiste si ok.
  - `update({ dir, label, color, chars })` → `{ ok, record }|{ ok:false, error }`. `dir` debe existir; valida solo los campos provistos. Persiste si ok.
  - `remove(dir)` → `boolean` (true si existía). Persiste si removió.
- **Nota de responsabilidad:** el store NO toca el filesystem para validar existencia del dir ni contención en el root; eso lo hace la capa HTTP (Task 5). El store es puro+persistido y por eso testeable sin fs real salvo su propio archivo.
- **Seed:** solo se aplica cuando `persistPath` no existe (o no se pasó `persistPath`). Los registros sembrados usan `label=basename(dir)`, `color=pickColor(dir)`, `chars=[]`.

- [ ] **Step 1: Escribir los tests del store**

Crear `habitat/server/projects.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { createProjects } from './projects.js';
import { PALETTE } from './palette.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-projects-${process.pid}-${tag}.json`);

test('seed: arranca con los dirs sembrados, label=basename, color de paleta, chars=[]', () => {
  const p = createProjects({ seed: ['/home/u/proj-api'] });
  const list = p.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].dir, '/home/u/proj-api');
  assert.equal(list[0].label, 'proj-api');
  assert.ok(PALETTE.includes(list[0].color));
  assert.deepEqual(list[0].chars, []);
});

test('add válido agrega y devuelve el record', () => {
  const p = createProjects();
  const r = p.add({ dir: '/x/web', color: PALETTE[0] });
  assert.equal(r.ok, true);
  assert.equal(r.record.label, 'web');
  assert.equal(r.record.color, PALETTE[0]);
  assert.deepEqual(r.record.chars, []);
  assert.equal(p.has('/x/web'), true);
});

test('add duplicado por dir -> ok:false', () => {
  const p = createProjects({ seed: ['/x/web'] });
  const r = p.add({ dir: '/x/web', color: PALETTE[0] });
  assert.equal(r.ok, false);
});

test('add con color fuera de paleta -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.add({ dir: '/x/web', color: '#123456' }).ok, false);
});

test('add con char inválido -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.add({ dir: '/x/web', color: PALETTE[0], chars: ['NoExiste'] }).ok, false);
});

test('add con chars válidos los guarda', () => {
  const p = createProjects();
  const r = p.add({ dir: '/x/web', color: PALETTE[0], chars: ['Knight', 'Monk'] });
  assert.deepEqual(r.record.chars, ['Knight', 'Monk']);
});

test('update edita solo los campos provistos', () => {
  const p = createProjects({ seed: ['/x/web'] });
  const r = p.update({ dir: '/x/web', color: PALETTE[2], label: 'Web App' });
  assert.equal(r.ok, true);
  assert.equal(r.record.color, PALETTE[2]);
  assert.equal(r.record.label, 'Web App');
  assert.deepEqual(r.record.chars, []);
});

test('update sobre dir inexistente -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.update({ dir: '/no/existe', color: PALETTE[0] }).ok, false);
});

test('remove quita y devuelve true; segundo remove false', () => {
  const p = createProjects({ seed: ['/x/web'] });
  assert.equal(p.remove('/x/web'), true);
  assert.equal(p.has('/x/web'), false);
  assert.equal(p.remove('/x/web'), false);
});

test('persistencia: add escribe y un store nuevo recarga (sin re-seed)', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createProjects({ persistPath: path, seed: ['/seed/one'] });
    a.add({ dir: '/x/web', color: PALETTE[0] });
    assert.ok(existsSync(path));
    // El seed NO debe re-aplicarse: el archivo ya existe, manda el disco.
    const b = createProjects({ persistPath: path, seed: ['/otro/dir'] });
    const dirs = b.list().map((r) => r.dir).sort();
    assert.deepEqual(dirs, ['/seed/one', '/x/web']);
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca aplicando el seed', () => {
  const path = tmpPath('corrupt');
  rmSync(path, { force: true });
  try {
    require('node:fs').writeFileSync(path, '{ no json');
    const p = createProjects({ persistPath: path, seed: ['/x/web'] });
    assert.equal(p.has('/x/web'), true);
  } finally {
    rmSync(path, { force: true });
  }
});
```

> Nota: en ESM no hay `require`; reemplazar la línea del último test por un import arriba. Usar en su lugar:
> en el bloque de imports agregar `import { writeFileSync } from 'node:fs';` y dentro del test `writeFileSync(path, '{ no json');`.

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat && node --test server/projects.test.js`
Expected: FAIL (`Cannot find module './projects.js'`).

- [ ] **Step 3: Implementar `habitat/server/projects.js`**

```js
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { PALETTE, pickColor } from './palette.js';
import { CHARACTERS } from './characters.js';

// Store persistido de la lista de proyectos spawneables (fuente de verdad).
// Mismo patrón que settings.js: carga al iniciar + escritura atómica. HABITAT_PROJECTS
// solo siembra cuando el archivo aún no existe; después manda siempre el disco.
const validColor = (c) => PALETTE.includes(c);
const validChars = (cs) => Array.isArray(cs) && cs.every((c) => CHARACTERS.includes(c));

function seedRecord(dir) {
  return { dir, label: basename(dir), color: pickColor(dir), chars: [] };
}

export function createProjects({ persistPath, seed = [] } = {}) {
  let items = [];

  const loaded = persistPath && existsSync(persistPath);
  if (loaded) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      if (Array.isArray(parsed)) {
        items = parsed
          .filter((p) => p && typeof p.dir === 'string')
          .map((p) => ({
            dir: p.dir,
            label: typeof p.label === 'string' && p.label ? p.label : basename(p.dir),
            color: validColor(p.color) ? p.color : pickColor(p.dir),
            chars: validChars(p.chars) ? p.chars : [],
          }));
      } else {
        items = seed.map(seedRecord); // archivo presente pero no es array: re-sembramos
      }
    } catch {
      items = seed.map(seedRecord); // corrupto: arrancamos del seed
    }
  } else {
    items = seed.map(seedRecord);
  }

  function persist() {
    if (!persistPath) return;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(items));
    renameSync(tmp, persistPath); // atómico
  }
  // Si veníamos de seed/corrupto y hay persistPath, dejamos el archivo escrito.
  if (persistPath && !loaded) persist();

  const copy = (r) => ({ dir: r.dir, label: r.label, color: r.color, chars: [...r.chars] });
  const find = (dir) => items.find((r) => r.dir === dir);

  return {
    list: () => items.map(copy),
    has: (dir) => !!find(dir),
    add: ({ dir, label, color, chars } = {}) => {
      if (typeof dir !== 'string' || !dir) return { ok: false, error: 'dir inválido' };
      if (find(dir)) return { ok: false, error: 'duplicado' };
      if (!validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      const record = {
        dir,
        label: typeof label === 'string' && label ? label : basename(dir),
        color,
        chars: chars ? [...chars] : [],
      };
      items.push(record);
      persist();
      return { ok: true, record: copy(record) };
    },
    update: ({ dir, label, color, chars } = {}) => {
      const r = find(dir);
      if (!r) return { ok: false, error: 'no existe' };
      if (color != null && !validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      if (typeof label === 'string' && label) r.label = label;
      if (color != null) r.color = color;
      if (chars != null) r.chars = [...chars];
      persist();
      return { ok: true, record: copy(r) };
    },
    remove: (dir) => {
      const i = items.findIndex((r) => r.dir === dir);
      if (i === -1) return false;
      items.splice(i, 1);
      persist();
      return true;
    },
  };
}
```

- [ ] **Step 4: Ajustar el último test al import ESM**

En `projects.test.js`, agregar `writeFileSync` al import de `node:fs` (línea de imports) y usar `writeFileSync(path, '{ no json');` dentro del test 'archivo corrupto'. Quitar la referencia a `require`.

- [ ] **Step 5: Correr y ver pasar**

Run: `cd habitat && node --test server/projects.test.js`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/projects.js habitat/server/projects.test.js
git commit -m "feat(habitat): store persistido de proyectos con seed, CRUD y validación"
```

---

## Task 3: Wire del store + `GET /projects` desde el store

**Files:**
- Modify: `habitat/server/index.js:36-37` (firma de `createApp`), `:112-118` (`GET /projects`), `:246-248` (arranque)
- Test: `habitat/server/index.test.js:145-153`

**Interfaces:**
- Consumes: `createProjects` de `./projects.js`.
- Produces: `createApp({ ..., projectsStore })` — nuevo parámetro opcional; si no se pasa, se crea `createProjects({ seed: config.PROJECTS })`. `GET /projects` devuelve `{ canSpawn, projects: [{ dir, name, color, chars }] }` donde `name = label`.

- [ ] **Step 1: Actualizar el test de `/projects`**

Reemplazar el assert del test 'GET /projects lista la whitelist cuando está habilitado' (`index.test.js:151`) por:

```js
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].dir, '/home/u/proj-api');
  assert.equal(body.projects[0].name, 'proj-api');
  assert.ok(typeof body.projects[0].color === 'string' && body.projects[0].color.startsWith('#'));
  assert.deepEqual(body.projects[0].chars, []);
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (el endpoint aún devuelve `{name,dir}` sin color/chars).

- [ ] **Step 3: Importar el store en `index.js`**

Agregar junto a los demás imports (cerca de `import { createSettings } from './settings.js';`):

```js
import { createProjects } from './projects.js';
```

- [ ] **Step 4: Aceptar `projectsStore` en `createApp`**

Cambiar la firma (`index.js:36`) para sumar `projectsStore`:

```js
export function createApp({ config, store, settingsStore = createSettings(), projectsStore, tmux = { listSessions, newTmuxSession, killTmuxSession }, git: gitOverrides = {} }) {
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, ...gitOverrides };
  const projects = projectsStore || createProjects({ seed: config.PROJECTS });
```

(Insertar la línea `const projects = ...` justo después de la línea `const git = {...}`.)

- [ ] **Step 5: Reescribir `GET /projects` para leer del store**

Reemplazar el bloque `index.js:112-118` por:

```js
    if (req.method === 'GET' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      const list = projects.list().map((p) => ({ dir: p.dir, name: p.label, color: p.color, chars: p.chars }));
      const canSpawn = !!(config.ALLOW_SPAWN && list.length > 0);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, projects: list }));
      return;
    }
```

- [ ] **Step 6: Actualizar el arranque real**

En `index.js:246-248`, crear el store persistido y pasarlo:

```js
  const store = createStore({ persistPath: config.STATE_PATH });
  const settingsStore = createSettings({ persistPath: config.SETTINGS_PATH });
  const projectsStore = createProjects({ persistPath: config.PROJECTS_STATE, seed: config.PROJECTS });
  const { server } = createApp({ config, store, settingsStore, projectsStore });
```

- [ ] **Step 7: Correr la suite del server completa**

Run: `cd habitat && node --test server/`
Expected: PASS (incluye index.test.js con el assert nuevo).

- [ ] **Step 8: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): /projects sale del store persistido (color + chars)"
```

---

## Task 4: Endpoint `GET /projects/browse` (navegador recursivo con guard)

**Files:**
- Modify: `habitat/server/index.js` (nuevo handler después de `GET /projects`), imports
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `config.PROJECTS_ROOT`, `config.ALLOW_SPAWN`; `projects.has(dir)`.
- Produces: `GET /projects/browse?path=<rel>` → `200 { root, rel, breadcrumbs: [{ name, rel }], entries: [{ name, rel, isRepo, added }] }`. `403` si `!ALLOW_SPAWN` o `PROJECTS_ROOT` vacío. `400` si `path` escapa del root. Solo lista **subcarpetas** (no archivos). `added` = el dir ya está en el store.

- [ ] **Step 1: Escribir los tests de browse**

Agregar a `index.test.js` (al final). Crea un root temporal con subcarpetas:

```js
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('GET /projects/browse deshabilitado (sin ALLOW_SPAWN) -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects/browse`, { headers: auth });
  assert.equal(r.status, 403);
  server.close();
});

test('GET /projects/browse lista subcarpetas del root y marca isRepo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-a'));
  mkdirSync(join(root, 'proj-a', '.git'));
  mkdirSync(join(root, 'proj-b'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/browse`, { headers: auth });
    const body = await r.json();
    assert.equal(r.status, 200);
    const names = body.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['proj-a', 'proj-b']);
    assert.equal(body.entries.find((e) => e.name === 'proj-a').isRepo, true);
    assert.equal(body.entries.find((e) => e.name === 'proj-b').isRepo, false);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /projects/browse con path=.. -> 400 (no escapa del root)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/browse?path=..`, { headers: auth });
    assert.equal(r.status, 400);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (browse devuelve 404 estático / no existe).

- [ ] **Step 3: Sumar imports de fs en `index.js`**

Asegurar que `index.js` importe lo necesario (ya importa de `node:path` y `node:fs/promises`):

```js
import { readdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
```

(Si `node:fs/promises` ya está importado con `readFile`, sumar `readdir, realpath` a esa línea; `resolve, relative` a la línea de `node:path`.)

- [ ] **Step 4: Implementar el handler de browse**

Insertar justo después del bloque `GET /projects` en `index.js`:

```js
    if (req.method === 'GET' && url.pathname === '/projects/browse') {
      if (!authorize(req, res)) return;
      const root = config.PROJECTS_ROOT;
      if (!config.ALLOW_SPAWN || !root) { res.writeHead(403).end(); return; }
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolve(root, rel);
      // Guard sintáctico: el target no puede salirse del root.
      if (target !== root && !target.startsWith(root + sep)) { res.writeHead(400).end(); return; }
      let realTarget, realRoot;
      try {
        realTarget = await realpath(target);
        realRoot = await realpath(root);
      } catch { res.writeHead(404).end(); return; }
      // Guard contra symlinks que escapen del root.
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const childAbs = join(realTarget, d.name);
          const childRel = relative(realRoot, childAbs);
          return {
            name: d.name,
            rel: childRel,
            isRepo: existsSync(join(childAbs, '.git')),
            added: projects.has(childAbs),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }
```

- [ ] **Step 5: Correr y ver pasar**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (los tres browse + el resto).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): GET /projects/browse navega carpetas del root con guard anti-traversal"
```

---

## Task 5: `POST` / `PATCH` / `DELETE /projects` + broadcast WS

**Files:**
- Modify: `habitat/server/index.js` (nuevos handlers), broadcast helper
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `projects.add/update/remove/has`, `config.PROJECTS_ROOT`, `hub.broadcast`.
- Produces:
  - `POST /projects` body `{ dir, label?, color, chars? }` → `200 record` | `400` (validación/dir fuera del root/no existe) | `403` (sin spawn) | `409` (duplicado).
  - `PATCH /projects` body `{ dir, label?, color?, chars? }` → `200 record` | `400` | `404` (dir no en lista) | `403`.
  - `DELETE /projects` body `{ dir }` → `200` | `400` | `404` | `403`.
  - Tras cada mutación: `hub.broadcast({ type: 'projects', projects: <list para cliente> })`.

- [ ] **Step 1: Escribir tests de alta/baja**

Agregar a `index.test.js`:

```js
import { PALETTE } from './palette.js';

test('POST /projects agrega una carpeta del root y la lista la incluye', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-c'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const dir = join(root, 'proj-c');
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir, color: PALETTE[0], chars: ['Knight'] }),
    });
    assert.equal(r.status, 200);
    const rec = await r.json();
    assert.equal(rec.name, 'proj-c');
    assert.equal(rec.color, PALETTE[0]);
    const list = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
    assert.ok(list.projects.some((p) => p.dir === dir));
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /projects con dir fuera del root -> 400', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: '/etc', color: PALETTE[0] }),
    });
    assert.equal(r.status, 400);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DELETE /projects quita de la lista', async () => {
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'] };
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 200);
  const list = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
  assert.equal(list.projects.length, 0);
  server.close();
});

test('PATCH /projects edita el color', async () => {
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'] };
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', color: PALETTE[5] }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).color, PALETTE[5]);
  server.close();
});

test('POST /projects sin ALLOW_SPAWN -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/x', color: PALETTE[0] }),
  });
  assert.equal(r.status, 403);
  server.close();
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (POST/PATCH/DELETE /projects caen en estáticos → 404/403 inesperado).

- [ ] **Step 3: Agregar un helper de broadcast de proyectos**

Dentro de `createApp`, cerca de `announcePending`, agregar:

```js
    // Lista de proyectos en el shape que consume el cliente (name = label).
    function projectsForClient() {
      return projects.list().map((p) => ({ dir: p.dir, name: p.label, color: p.color, chars: p.chars }));
    }
    function broadcastProjects() {
      if (hub) hub.broadcast({ type: 'projects', projects: projectsForClient() });
    }
```

Y reescribir `GET /projects` (de Task 3) para reusar `projectsForClient()`:

```js
    if (req.method === 'GET' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      const list = projectsForClient();
      const canSpawn = !!(config.ALLOW_SPAWN && list.length > 0);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, projects: list }));
      return;
    }
```

- [ ] **Step 4: Implementar POST/PATCH/DELETE**

Insertar después del handler de browse. Helper local para validar dir dentro del root:

```js
    // dir absoluto, existente y contenido en PROJECTS_ROOT (para alta).
    async function dirWithinRoot(dir) {
      const root = config.PROJECTS_ROOT;
      if (!root || typeof dir !== 'string' || !dir) return false;
      let real, realRoot;
      try { real = await realpath(dir); realRoot = await realpath(root); }
      catch { return false; }
      return real === realRoot || real.startsWith(realRoot + sep);
    }

    if (req.method === 'POST' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const dir = body && body.dir;
      if (!(await dirWithinRoot(dir))) { res.writeHead(400).end(); return; }
      const r = projects.add({ dir, label: body.label, color: body.color, chars: body.chars });
      if (!r.ok) { res.writeHead(r.error === 'duplicado' ? 409 : 400).end(); return; }
      broadcastProjects();
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ dir: r.record.dir, name: r.record.label, color: r.record.color, chars: r.record.chars }));
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      if (!projects.has(body.dir)) { res.writeHead(404).end(); return; }
      const r = projects.update({ dir: body.dir, label: body.label, color: body.color, chars: body.chars });
      if (!r.ok) { res.writeHead(400).end(); return; }
      broadcastProjects();
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ dir: r.record.dir, name: r.record.label, color: r.record.color, chars: r.record.chars }));
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      if (!projects.remove(body.dir)) { res.writeHead(404).end(); return; }
      broadcastProjects();
      res.writeHead(200).end();
      return;
    }
```

- [ ] **Step 5: Correr y ver pasar**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): CRUD /projects (alta/edición/baja) con broadcast WS"
```

---

## Task 6: Spawn/kill usan el store + allowlist de personajes

**Files:**
- Modify: `habitat/server/index.js:144` (validación spawn), `:145-146` (char), `:193` (kill lookup)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `projects.list()`, `projects.has(dir)`.
- Produces: `/spawn` valida `dir` con `projects.has(dir)`; si el proyecto tiene `chars` no vacío, el `char` recibido debe estar en esa allowlist. `/kill` resuelve el dir del proyecto con `projects.list()`.

- [ ] **Step 1: Escribir test de allowlist en spawn**

Agregar a `index.test.js`. El proyecto se siembra con una allowlist vía un `projectsStore` explícito:

```js
import { createProjects } from './projects.js';

test('POST /spawn con char fuera de la allowlist del proyecto -> 400', async () => {
  const projectsStore = createProjects();
  projectsStore.add({ dir: '/home/u/proj-api', color: PALETTE[0], chars: ['Knight'] });
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: [] };
  const { server } = createApp({ config: cfg, store: createStore(), projectsStore, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Monk' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn con char dentro de la allowlist -> 200', async () => {
  const projectsStore = createProjects();
  projectsStore.add({ dir: '/home/u/proj-api', color: PALETTE[0], chars: ['Knight'] });
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: [] };
  const { server } = createApp({ config: cfg, store: createStore(), projectsStore, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  server.close();
});
```

> Verificar que `spawnConfig()` (que aún setea `PROJECTS: ['/home/u/proj-api']`) sigue funcionando: con la firma nueva, `createApp` sin `projectsStore` lo siembra desde `config.PROJECTS`, así que los tests de spawn existentes siguen pasando.

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL (hoy el char fuera de allowlist devuelve 200, no 400).

- [ ] **Step 3: Cambiar la validación de dir y char en `/spawn`**

En `index.js`, reemplazar la línea `if (!config.PROJECTS.includes(dir)) { res.writeHead(403).end(); return; }` (`:144`) y el chequeo de `char` (`:145-146`) por:

```js
      if (!projects.has(dir)) { res.writeHead(403).end(); return; }
      const char = body && body.char;
      if (char != null && !CHARACTERS.includes(char)) { res.writeHead(400).end(); return; }
      const allowed = (projects.list().find((p) => p.dir === dir) || {}).chars || [];
      if (char != null && allowed.length && !allowed.includes(char)) { res.writeHead(400).end(); return; }
```

- [ ] **Step 4: Cambiar el lookup de `/kill`**

En `index.js:193`, reemplazar:

```js
        const projectDir = (config.PROJECTS || []).find((d) => basename(d) === s.project);
```

por:

```js
        const projectDir = (projects.list().find((p) => basename(p.dir) === s.project) || {}).dir;
```

- [ ] **Step 5: Correr la suite del server**

Run: `cd habitat && node --test server/`
Expected: PASS (todos, incluidos los de spawn previos y los nuevos de allowlist).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): spawn/kill usan el store; spawn respeta allowlist de personajes"
```

---

## Task 7: Cliente — tipos, `useProjects` y wiring WS

**Files:**
- Modify: `habitat/client/src/types.ts:48-63`
- Modify: `habitat/client/src/composables/useProjects.ts`
- Modify: `habitat/client/src/composables/useSocket.ts:14-21`
- Test: `habitat/client/src/composables/useProjects.test.ts` (crear)

**Interfaces:**
- Produces (types.ts): `export interface Project { dir: string; name: string; color: string; chars?: string[] }`; `ServerMessage` suma `{ type: 'projects'; projects: Project[] }`.
- Produces (useProjects): además de lo actual, `browse(path?: string)`, `addProject(p)`, `updateProject(p)`, `removeProject(dir)`, `colorForProject(name)`, y `applyServerProjects(list)` (export nombrado, como `applyServerSettings`).

- [ ] **Step 1: Escribir el test de `colorForProject`**

Crear `habitat/client/src/composables/useProjects.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useProjects, applyServerProjects } from './useProjects'

describe('useProjects.colorForProject', () => {
  it('mapea el color por basename del dir y default vacío si no hay match', () => {
    applyServerProjects([{ dir: '/home/u/proj-api', name: 'proj-api', color: '#e7c14a', chars: [] }])
    const { colorForProject } = useProjects()
    expect(colorForProject('proj-api')).toBe('#e7c14a')
    expect(colorForProject('desconocido')).toBe('')
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd habitat/client && npx vitest run src/composables/useProjects.test.ts`
Expected: FAIL (`applyServerProjects`/`colorForProject` no existen).

- [ ] **Step 3: Extender `types.ts`**

Antes de `ServerMessage`, agregar la interfaz `Project`:

```ts
export interface Project {
  dir: string
  name: string // label mostrado
  color: string
  chars?: string[]
}
```

Y sumar a la unión `ServerMessage`:

```ts
  | { type: 'projects'; projects: Project[] }
```

- [ ] **Step 4: Reescribir `useProjects.ts`**

Reemplazar el contenido por:

```ts
import { ref } from 'vue'
import type { Project } from '../types'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}
const jsonHeaders = () => ({ ...authHeaders(), 'content-type': 'application/json' })

export interface BrowseEntry { name: string; rel: string; isRepo: boolean; added: boolean }
export interface BrowseResult {
  root: string; rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: BrowseEntry[]
}

const canSpawn = ref(false)
const projects = ref<Project[]>([])
const error = ref('')
let loaded = false

const basenameOf = (dir: string) => dir.split('/').filter(Boolean).pop() ?? dir

async function load() {
  try {
    const res = await fetch('/projects', { headers: authHeaders() })
    if (!res.ok) return
    const data = (await res.json()) as { canSpawn: boolean; projects: Project[] }
    canSpawn.value = data.canSpawn
    projects.value = data.projects
  } catch {
    /* sin red: el botón simplemente no aparece */
  }
}

// Aplica un broadcast del server (otra pestaña/cambio de proyectos). No dispara load().
export function applyServerProjects(list: Project[]) {
  projects.value = list
  canSpawn.value = canSpawn.value || list.length > 0
}

async function browse(path = ''): Promise<BrowseResult | null> {
  try {
    const q = path ? `?path=${encodeURIComponent(path)}` : ''
    const res = await fetch(`/projects/browse${q}`, { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as BrowseResult
  } catch {
    return null
  }
}

async function addProject(p: { dir: string; label?: string; color: string; chars?: string[] }): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(p) })
    if (res.ok) { await load(); return true }
    error.value = res.status === 409 ? 'ese proyecto ya está agregado' : 'no se pudo agregar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo agregar el proyecto'
    return false
  }
}

async function updateProject(p: { dir: string; label?: string; color?: string; chars?: string[] }): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(p) })
    if (res.ok) { await load(); return true }
    error.value = 'no se pudo editar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo editar el proyecto'
    return false
  }
}

async function removeProject(dir: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({ dir }) })
    if (res.ok) { await load(); return true }
    error.value = 'no se pudo quitar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo quitar el proyecto'
    return false
  }
}

function colorForProject(name: string): string {
  const p = projects.value.find((p) => basenameOf(p.dir) === name || p.name === name)
  return p?.color ?? ''
}

async function spawn(dir: string, branch: string, base: string, char?: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/spawn', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ dir, branch, base, char }) })
    if (res.ok) return true
    error.value =
      res.status === 409 ? 'ya hay un agente en esa rama'
      : res.status === 400 ? 'datos inválidos'
      : res.status === 403 ? 'no permitido'
      : 'no se pudo crear el agente'
    return false
  } catch {
    error.value = 'no se pudo crear el agente'
    return false
  }
}

async function kill(id: string): Promise<boolean> {
  try {
    const res = await fetch('/kill', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ id }) })
    return res.ok
  } catch {
    return false
  }
}

export function useProjects() {
  if (!loaded) {
    loaded = true
    load()
  }
  return { canSpawn, projects, error, spawn, kill, browse, addProject, updateProject, removeProject, colorForProject }
}
```

- [ ] **Step 5: Manejar el mensaje WS en `useSocket.ts`**

Importar y manejar:

```ts
import { applyServerProjects } from './useProjects'
```

Y dentro de `ws.onmessage`, sumar una rama:

```ts
    else if (msg.type === 'projects') applyServerProjects(msg.projects)
```

- [ ] **Step 6: Correr y ver pasar**

Run: `cd habitat/client && npx vitest run src/composables/useProjects.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check del cliente**

Run: `cd habitat/client && npx vue-tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useProjects.ts habitat/client/src/composables/useProjects.test.ts habitat/client/src/composables/useSocket.ts
git commit -m "feat(habitat): cliente — Project con color/chars, CRUD, browse y wiring WS"
```

---

## Task 8: Tinte de fondo del pod por color de proyecto

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`

**Interfaces:**
- Consumes: `colorForProject` de `useProjects`.
- Produces: el `.pod` recibe `:style` con `background: color-mix(in srgb, <color> 14%, var(--surface))` cuando hay color; si no, sin override (queda `var(--surface)` del CSS global).

- [ ] **Step 1: Importar `colorForProject` y computar el tinte**

En el `<script setup>` de `SessionPod.vue`, cambiar la desestructuración y agregar el computed:

```ts
const { canSpawn, kill, colorForProject } = useProjects()
const tint = computed(() => {
  const c = colorForProject(props.session.project)
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})
```

(`computed` ya está importado de `vue` en este archivo.)

- [ ] **Step 2: Bindear el estilo en el `.pod`**

Agregar `:style="tint"` al div raíz `.pod`:

```html
  <div
    class="pod"
    :class="[session.status, { selected }]"
    :style="tint"
    tabindex="0"
    ...
```

- [ ] **Step 3: Verificar render manual (build + vista)**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: build OK. (Verificación visual del tinte se hace al final, Task 11.)

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue
git commit -m "feat(habitat): pod toma el color del proyecto como tinte de fondo"
```

---

## Task 9: SpawnMenu — swatch por proyecto + filtro de personajes

**Files:**
- Modify: `habitat/client/src/components/SpawnMenu.vue`

**Interfaces:**
- Consumes: `projects` (con `color`/`chars`) de `useProjects`; `CHARACTERS` de `sprites`.
- Produces: cada item de proyecto muestra un swatch de su color; en el paso de personaje, los botones se limitan a `chars` del proyecto si la allowlist no está vacía.

- [ ] **Step 1: Guardar los chars del proyecto al elegirlo**

En `<script setup>` de `SpawnMenu.vue`, agregar import y estado, y completar `pickProject`:

```ts
import { ref, computed } from 'vue'
import { useProjects } from '../composables/useProjects'
import { CHARACTERS, faceFor } from '../sprites'

const { canSpawn, projects, error, spawn } = useProjects()
const pickedChars = ref<string[]>([])
const allowedChars = computed(() => (pickedChars.value.length ? pickedChars.value : CHARACTERS))
```

En `pickProject`, setear `pickedChars`:

```ts
function pickProject(dir: string) {
  pickedDir.value = dir
  pickedChars.value = projects.value.find((p) => p.dir === dir)?.chars ?? []
  branch.value = ''
  base.value = 'main'
  step.value = 'detail'
}
```

- [ ] **Step 2: Mostrar el swatch en el item de proyecto**

En el paso 1, agregar un puntito de color dentro del botón:

```html
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="pickProject(p.dir)"
        >
          <span class="proj-dot" :style="{ background: p.color }"></span>{{ p.name }}
        </button>
```

- [ ] **Step 3: Filtrar los personajes por la allowlist**

En el paso 2, cambiar `v-for="c in CHARACTERS"` por `v-for="c in allowedChars"`:

```html
          <button
            v-for="c in allowedChars"
            :key="c"
            class="spawn-char"
            :disabled="busy || !branch.trim()"
            :title="c"
            @click="create(c)"
          >
            <img :src="faceFor('', c)" alt="" />
          </button>
```

- [ ] **Step 4: Estilo del swatch**

Agregar al `<style scoped>`:

```css
.proj-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Verificar type-check + build**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/SpawnMenu.vue
git commit -m "feat(habitat): SpawnMenu muestra color del proyecto y filtra personajes por allowlist"
```

---

## Task 10: `ProjectsManager.vue` + integración en Settings

**Files:**
- Create: `habitat/client/src/components/ProjectsManager.vue`
- Modify: `habitat/client/src/components/SettingsView.vue`

**Interfaces:**
- Consumes: `useProjects` (`projects`, `canSpawn`, `error`, `browse`, `addProject`, `updateProject`, `removeProject`); `PALETTE` de `../palette`; `CHARACTERS` de `../sprites`; tipo `BrowseResult` de `useProjects`.
- Produces: sección de gestión montada dentro de `SettingsView`.

- [ ] **Step 1: Crear `ProjectsManager.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useProjects, type BrowseResult } from '../composables/useProjects'
import { PALETTE } from '../palette'
import { CHARACTERS } from '../sprites'

const { projects, canSpawn, error, browse, addProject, updateProject, removeProject } = useProjects()

// --- alta con navegador de carpetas ---
const browsing = ref(false)
const tree = ref<BrowseResult | null>(null)
const busy = ref(false)

// formulario de alta para la carpeta elegida
const draftDir = ref('')
const draftLabel = ref('')
const draftColor = ref(PALETTE[0])
const draftChars = ref<string[]>([])

async function openBrowser() {
  browsing.value = true
  tree.value = await browse('')
}
async function go(rel: string) {
  tree.value = await browse(rel)
}
function chooseFolder(rel: string, name: string) {
  // dir absoluto = no lo conocemos en el cliente; lo arma el server a partir del root.
  // Mandamos el rel y el server resuelve; pero addProject necesita dir absoluto.
  // Por eso el server expone el dir absoluto: lo derivamos pidiendo browse del padre.
  // Simplificación: el server acepta dir absoluto, y browse ya nos da entries con rel;
  // el dir absoluto se reconstruye en el submit usando el root informado por el tree.
  draftDir.value = rel // rel respecto del root; el server lo resuelve contra PROJECTS_ROOT
  draftLabel.value = name
  draftColor.value = PALETTE[0]
  draftChars.value = []
}
function toggleDraftChar(c: string) {
  draftChars.value = draftChars.value.includes(c)
    ? draftChars.value.filter((x) => x !== c)
    : [...draftChars.value, c]
}
async function submitAdd() {
  busy.value = true
  const ok = await addProject({
    dir: draftDir.value,
    label: draftLabel.value.trim() || undefined,
    color: draftColor.value,
    chars: draftChars.value,
  })
  busy.value = false
  if (ok) { browsing.value = false; tree.value = null; draftDir.value = '' }
}

async function setColor(dir: string, color: string) {
  await updateProject({ dir, color })
}
async function remove(dir: string, name: string) {
  if (confirm(`¿Quitar "${name}" de la lista? No se borra nada del disco.`)) {
    await removeProject(dir)
  }
}
</script>

<template>
  <section class="projects">
    <h3>PROYECTOS</h3>
    <p class="hint" v-if="!canSpawn">Spawn deshabilitado: configurá HABITAT_ALLOW_SPAWN para gestionar proyectos.</p>

    <ul class="plist">
      <li v-for="p in projects" :key="p.dir" class="pitem">
        <span class="sw" :style="{ background: p.color }"></span>
        <span class="plabel">{{ p.name }}</span>
        <span class="pdir">{{ p.dir }}</span>
        <span class="swatches">
          <button
            v-for="c in PALETTE"
            :key="c"
            class="swatch"
            :class="{ on: c === p.color }"
            :style="{ background: c }"
            :title="c"
            @click="setColor(p.dir, c)"
          />
        </span>
        <button class="ctl del" @click="remove(p.dir, p.name)">quitar</button>
      </li>
    </ul>

    <button v-if="canSpawn && !browsing" class="ctl" @click="openBrowser">+ Agregar proyecto</button>

    <div v-if="browsing" class="browser">
      <div class="crumbs">
        <button class="crumb" @click="go('')">{{ tree?.root ?? 'root' }}</button>
        <template v-for="b in tree?.breadcrumbs ?? []" :key="b.rel">
          <span class="sep">/</span>
          <button class="crumb" @click="go(b.rel)">{{ b.name }}</button>
        </template>
      </div>
      <ul class="entries">
        <li v-for="e in tree?.entries ?? []" :key="e.rel">
          <button class="enter" @click="go(e.rel)">📁 {{ e.name }}<span v-if="e.isRepo" class="repo">git</span></button>
          <button class="pick" :disabled="e.added" @click="chooseFolder(e.rel, e.name)">
            {{ e.added ? 'ya agregado' : 'elegir' }}
          </button>
        </li>
      </ul>

      <div v-if="draftDir" class="draft">
        <label>Nombre <input v-model="draftLabel" /></label>
        <div class="row">
          <span>Color</span>
          <span class="swatches">
            <button
              v-for="c in PALETTE"
              :key="c"
              class="swatch"
              :class="{ on: c === draftColor }"
              :style="{ background: c }"
              @click="draftColor = c"
            />
          </span>
        </div>
        <div class="row chars">
          <span>Personajes permitidos (vacío = todos)</span>
          <span class="charlist">
            <button
              v-for="c in CHARACTERS"
              :key="c"
              class="charbtn"
              :class="{ on: draftChars.includes(c) }"
              @click="toggleDraftChar(c)"
            >{{ c }}</button>
          </span>
        </div>
        <div class="actions">
          <button class="ctl" :disabled="busy" @click="submitAdd">Agregar</button>
          <button class="ctl" :disabled="busy" @click="draftDir = ''">cancelar</button>
        </div>
      </div>

      <button class="ctl close" @click="browsing = false">cerrar navegador</button>
    </div>

    <p class="err" v-if="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.projects { max-width: 720px; padding: clamp(18px, 3.5vw, 38px); }
.projects h3 { font-family: var(--f-logo); margin: 0 0 12px; }
.hint, .err { color: var(--dim); font-size: 12px; }
.err { color: #e06; }
.plist { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; }
.pitem { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sw, .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #0006; cursor: pointer; }
.plabel { font-family: var(--f-ui); font-weight: 700; }
.pdir { color: var(--dim); font-size: 11px; }
.swatches { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.swatch.on { outline: 2px solid var(--ink); outline-offset: 1px; }
.del { font-size: 11px; }
.browser { margin-top: 10px; border: 2px solid #3a3a4a; border-radius: 6px; padding: 10px; }
.crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.crumb { background: transparent; border: 1px solid #3a3a4a; border-radius: 4px; color: var(--ink); padding: 2px 6px; cursor: pointer; }
.entries { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; }
.entries li { display: flex; justify-content: space-between; gap: 8px; }
.enter { background: transparent; border: none; color: var(--ink); cursor: pointer; text-align: left; flex: 1; }
.enter .repo { color: var(--gold); font-size: 10px; margin-left: 6px; }
.draft { border-top: 1px solid #3a3a4a; margin-top: 8px; padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.draft .row { display: flex; flex-direction: column; gap: 4px; }
.charlist { display: flex; flex-wrap: wrap; gap: 4px; }
.charbtn { background: #1a1a24; border: 1px solid #3a3a4a; border-radius: 4px; color: var(--dim); font-size: 10px; padding: 2px 5px; cursor: pointer; }
.charbtn.on { color: #2a1c0a; background: var(--gold); border-color: var(--gold); }
.actions { display: flex; gap: 6px; }
.close { margin-top: 6px; }
</style>
```

> **Decisión de contrato:** el cliente manda en `dir` el `rel` que devuelve `/projects/browse` (ruta relativa al root). Para que el server lo acepte, en Task 5 el handler `POST /projects` ya valida con `dirWithinRoot(dir)`, que hace `realpath(dir)` — y `realpath` de una ruta relativa la resuelve contra el **cwd del proceso**, NO contra el root. Ver Step 2: el server debe resolver el `dir` contra `PROJECTS_ROOT` antes de validar.

- [ ] **Step 2: Ajustar `POST /projects` para resolver `dir` relativo contra el root**

En `index.js`, dentro del handler `POST /projects` (Task 5), antes de `dirWithinRoot`, normalizar el `dir` recibido a absoluto contra el root:

```js
      let dir = body && body.dir;
      if (typeof dir === 'string' && dir && !dir.startsWith(sep)) {
        dir = resolve(config.PROJECTS_ROOT || '', dir); // el cliente manda rel respecto del root
      }
      if (!(await dirWithinRoot(dir))) { res.writeHead(400).end(); return; }
```

(Reemplaza la línea `const dir = body && body.dir;` previa por este bloque con `let dir`.)

- [ ] **Step 3: Agregar un test del alta vía rel**

En `index.test.js`, ajustar/duplicar el test de alta para mandar `dir` relativo:

```js
test('POST /projects acepta dir relativo al root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-rel'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'proj-rel', color: PALETTE[0] }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).name, 'proj-rel');
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Montar `ProjectsManager` en `SettingsView.vue`**

Importar y renderizar bajo el permission mode:

```ts
import ProjectsManager from './ProjectsManager.vue'
```

En el template, después de `<p class="err" ...>`, antes de cerrar `</section>`... en realidad montarlo fuera de la `<section class="settings">`, al final del template:

```html
  <section class="settings">
    ... (lo existente) ...
  </section>
  <ProjectsManager />
```

- [ ] **Step 5: Correr server tests + type-check + build**

Run: `cd habitat && node --test server/ && cd client && npx vue-tsc --noEmit && npm run build`
Expected: server PASS, type-check sin errores, build OK.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/ProjectsManager.vue habitat/client/src/components/SettingsView.vue habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): ProjectsManager en Settings (alta con browser, editar color, quitar)"
```

---

## Task 11: Documentación + verificación end-to-end

**Files:**
- Modify: `habitat/README.md:49-63`

**Interfaces:** ninguna (docs + verificación manual).

- [ ] **Step 1: Documentar las env vars y el flujo nuevo**

En `habitat/README.md`, en la sección de spawn (~líneas 49-63), reemplazar/ampliar la explicación de `HABITAT_PROJECTS` por:

```markdown
    export HABITAT_ALLOW_SPAWN=1
    export HABITAT_PROJECTS_ROOT="/home/tu/proyectos"   # raíz para navegar y agregar proyectos desde la UI
    export HABITAT_PROJECTS="/home/tu/proyecto-a:/home/tu/proyecto-b"   # opcional: siembra la lista la primera vez

La lista de proyectos se gestiona desde **Settings → Proyectos**: el botón "Agregar proyecto"
navega las carpetas dentro de `HABITAT_PROJECTS_ROOT`, y al elegir una se asigna un **color**
(de una paleta fija) que diferencia los pods de ese proyecto. La lista se persiste en
`.projects.json`; `HABITAT_PROJECTS` solo la siembra la primera vez (después manda la UI).
Cada proyecto puede además fijar una **allowlist de personajes**: si está seteada, al crear una
sesión solo se ofrecen esos; si está vacía, están todos.
```

- [ ] **Step 2: Suite completa del server**

Run: `cd habitat && node --test server/`
Expected: PASS (todas las suites).

- [ ] **Step 3: Suite completa del cliente + build**

Run: `cd habitat/client && npx vitest run && npx vue-tsc --noEmit && npm run build`
Expected: PASS + build OK.

- [ ] **Step 4: Verificación manual (humo)**

Arrancar con `HABITAT_ALLOW_SPAWN=1 HABITAT_PROJECTS_ROOT=<dir con repos> HABITAT_TOKEN=<t> npm start` y verificar en el navegador:
1. Settings → Proyectos: la lista aparece (sembrada de `HABITAT_PROJECTS` si estaba).
2. "Agregar proyecto" → navegar carpetas (breadcrumbs, entrar/salir), elegir una, asignar color y opcionalmente personajes, Agregar.
3. El nuevo proyecto aparece en el SpawnMenu con su swatch; al crear sesión, solo se ofrecen los personajes permitidos (si se fijó allowlist).
4. El pod de una sesión de ese proyecto muestra el tinte de fondo del color elegido.
5. Editar el color desde Settings se refleja en vivo (WS) en el pod.
6. "Quitar" saca el proyecto de la lista sin borrar nada del disco.

- [ ] **Step 5: Commit**

```bash
git add habitat/README.md
git commit -m "docs(habitat): gestión de proyectos desde la UI (PROJECTS_ROOT, color, allowlist)"
```

---

## Self-Review

**Spec coverage:**
- UI gestiona la lista + persiste → Task 2, 3, 5. ✔
- Seed desde `HABITAT_PROJECTS` la primera vez → Task 2 (seed), Task 3 (arranque). ✔
- `HABITAT_PROJECTS_ROOT` para navegar → Task 1 (config), Task 4 (browse). ✔
- Navegación recursiva con breadcrumbs y guard anti-traversal → Task 4, Task 10 (UI). ✔
- Paleta fija de color → Task 1, usada en Task 5/9/10. ✔
- Color como tinte de fondo del pod → Task 8. ✔
- Gestión: agregar/eliminar/editar color/renombrar label/allowlist de personajes → Task 10 (UI) + Task 5 (PATCH/DELETE/POST) + Task 2 (store). ✔
- Spawn valida contra el store y respeta allowlist → Task 6. ✔
- Kill usa el store → Task 6. ✔
- Broadcast WS para refresco en vivo → Task 5, Task 7. ✔
- Docs → Task 11. ✔

**Placeholder scan:** sin TBD/TODO; todo paso de código trae el código. ✔

**Type/contract consistency:**
- `createProjects({ persistPath, seed })` y métodos `list/has/add/update/remove` coherentes entre Task 2, 3, 5, 6. ✔
- Shape cliente `{ dir, name, color, chars }` consistente en `/projects`, broadcast y `Project` (Task 3, 5, 7). ✔
- Contrato del `dir` en alta: el cliente manda `rel` (Task 10), el server lo resuelve contra el root (Task 10 Step 2) — resuelto explícitamente para evitar el bug de `realpath` sobre ruta relativa. ✔
- `PALETTE` idéntica server/cliente (Task 1). ✔
```
