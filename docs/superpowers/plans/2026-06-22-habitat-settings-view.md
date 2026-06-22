# Vista Settings con permission-mode persistido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover el `--permission-mode` con el que se lanza Claude Code a una setting global, editable desde una nueva vista Settings en la GUI y persistida en disco.

**Architecture:** El servidor guarda la setting en `.settings.json` (escritura atómica, mismo patrón que `state.js`) y la lee al hacer `/spawn` para construir el comando `claude`. El cliente Vue agrega un toggle de vista en el header (router casero con un `ref`) y una vista `SettingsView` con un `<select>` que persiste vía `POST /settings`; los cambios se broadcastean por WS para sincronizar pestañas.

**Tech Stack:** Node `node:http` + `ws` (servidor, tests con `node --test` + `node:assert`), Vue 3 `<script setup>` + TypeScript (cliente, verificación con `vue-tsc`).

## Global Constraints

- Modos válidos (set único, copiado verbatim): `default`, `acceptEdits`, `plan`, `bypassPermissions`.
- Default cuando no hay archivo / archivo corrupto / modo inválido: `acceptEdits`.
- La setting es **global** (una sola) y sólo afecta **sesiones nuevas**.
- Persistencia atómica: escribir a `<path>.tmp` y `renameSync` al destino (igual que `state.js`).
- Tests del servidor corren con `cd habitat && npm test` (que es `node --test`).
- Verificación del cliente: `cd habitat/client && npm run typecheck` (`vue-tsc --noEmit`).
- Seguir patrones existentes: composables singleton a nivel módulo (como `useProjects`), `authHeaders()` con token de la query.

---

### Task 1: Módulo `settings.js` (store persistido)

**Files:**
- Create: `habitat/server/settings.js`
- Test: `habitat/server/settings.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const PERMISSION_MODES: string[]` — `['default','acceptEdits','plan','bypassPermissions']`.
  - `export function createSettings({ persistPath }?) -> { get(): {permissionMode}, set(patch): boolean }`.
    - `get()` devuelve copia `{ permissionMode }`.
    - `set(patch)` devuelve `true` si `patch.permissionMode` es válido (aplica + persiste), `false` si es inválido (no cambia nada).

- [ ] **Step 1: Escribir el test que falla**

Create `habitat/server/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { createSettings, PERMISSION_MODES } from './settings.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-settings-${process.pid}-${tag}.json`);

test('default sin persistPath es acceptEdits', () => {
  assert.equal(createSettings().get().permissionMode, 'acceptEdits');
});

test('PERMISSION_MODES son los cuatro modos', () => {
  assert.deepEqual(PERMISSION_MODES, ['default', 'acceptEdits', 'plan', 'bypassPermissions']);
});

test('set válido aplica y get lo refleja', () => {
  const s = createSettings();
  assert.equal(s.set({ permissionMode: 'plan' }), true);
  assert.equal(s.get().permissionMode, 'plan');
});

test('set inválido devuelve false y no cambia el modo previo', () => {
  const s = createSettings();
  s.set({ permissionMode: 'plan' });
  assert.equal(s.set({ permissionMode: 'nope' }), false);
  assert.equal(s.get().permissionMode, 'plan');
});

test('persistencia: set escribe y un store nuevo recarga el modo', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createSettings({ persistPath: path });
    assert.equal(a.set({ permissionMode: 'bypassPermissions' }), true);
    assert.ok(existsSync(path), 'debería haber escrito el archivo');
    const b = createSettings({ persistPath: path });
    assert.equal(b.get().permissionMode, 'bypassPermissions');
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca en default acceptEdits', () => {
  const path = tmpPath('corrupt');
  writeFileSync(path, '{ no json');
  try {
    assert.equal(createSettings({ persistPath: path }).get().permissionMode, 'acceptEdits');
  } finally {
    rmSync(path, { force: true });
  }
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd habitat && node --test server/settings.test.js`
Expected: FAIL con `Cannot find module './settings.js'`.

- [ ] **Step 3: Escribir la implementación**

Create `habitat/server/settings.js`:

```js
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const DEFAULT_MODE = 'acceptEdits';

// Setting global del hábitat, respaldada en disco con escritura atómica (igual que
// state.js). Hoy sólo guarda el permissionMode con el que se lanzan las sesiones nuevas.
export function createSettings({ persistPath } = {}) {
  let permissionMode = DEFAULT_MODE;

  if (persistPath) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      if (PERMISSION_MODES.includes(parsed.permissionMode)) permissionMode = parsed.permissionMode;
    } catch { /* sin archivo aún, o corrupto: arrancamos en default */ }
  }

  function persist() {
    if (!persistPath) return;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ permissionMode }));
    renameSync(tmp, persistPath); // atómico: nunca dejamos un JSON a medias
  }

  return {
    get: () => ({ permissionMode }),
    // true si el patch trae un modo válido (aplica + persiste); false si es inválido.
    set: (patch = {}) => {
      if (!PERMISSION_MODES.includes(patch.permissionMode)) return false;
      permissionMode = patch.permissionMode;
      persist();
      return true;
    },
  };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd habitat && node --test server/settings.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/settings.js habitat/server/settings.test.js
git commit -m "feat(habitat): settings store con permissionMode persistido"
```

---

### Task 2: `newTmuxSession` usa el permissionMode

**Files:**
- Modify: `habitat/server/tmux.js` (función `newTmuxSession`, ~líneas 53-61)
- Test: `habitat/server/tmux.test.js` (test existente ~líneas 61-70 + nuevos)

**Interfaces:**
- Consumes: nada de Task 1 directamente.
- Produces: `newTmuxSession(name, dir, exec?, opts?) -> Promise<boolean>` donde `opts.permissionMode` define el flag. `'default'` o ausente → `claude` pelado; otro modo → `claude --permission-mode <modo>`.

- [ ] **Step 1: Actualizar el test existente y agregar los nuevos**

En `habitat/server/tmux.test.js`, reemplazá el test `newTmuxSession crea sesión detached en dir y lanza claude` (el que hoy espera `'claude --permission-mode acceptEdits'`) por:

```js
test('newTmuxSession sin opts lanza claude pelado', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  const ok = await newTmuxSession('proj', '/home/u/proj', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['tmux', 'new-session', '-d', '-s', 'proj', '-c', '/home/u/proj']);
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'proj', '-l', 'claude']);
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'proj', 'Enter']);
});

test('newTmuxSession con permissionMode agrega el flag', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  await newTmuxSession('proj', '/home/u/proj', exec, { permissionMode: 'acceptEdits' });
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'proj', '-l', 'claude --permission-mode acceptEdits']);
});

test('newTmuxSession con modo default lanza claude pelado', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  await newTmuxSession('proj', '/home/u/proj', exec, { permissionMode: 'default' });
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'proj', '-l', 'claude']);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: FAIL — el test `con permissionMode agrega el flag` falla (la implementación actual ignora `opts` y hardcodea `acceptEdits`).

- [ ] **Step 3: Implementar el cambio**

En `habitat/server/tmux.js`, reemplazá la función `newTmuxSession` (y su comentario que dice "lanza claude ... acceptEdits") por:

```js
// Crea una sesión tmux detached en `dir` y lanza claude dentro (vía shell de login,
// para heredar PATH/rc y disparar los hooks de ~/.claude/settings.json). El
// permissionMode (setting global) define el flag: 'default'/ausente => claude pelado.
export async function newTmuxSession(name, dir, exec = defaultExec, { permissionMode } = {}) {
  try {
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', dir]);
    const flag = permissionMode && permissionMode !== 'default' ? ` --permission-mode ${permissionMode}` : '';
    await sendKeys(name, `claude${flag}`, exec);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: PASS (todos, incluidos los 3 de `newTmuxSession`).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/tmux.js habitat/server/tmux.test.js
git commit -m "feat(habitat): newTmuxSession arma el flag desde permissionMode"
```

---

### Task 3: Config + rutas `/settings` + `/spawn` lee la setting

**Files:**
- Modify: `habitat/server/config.js` (agregar `SETTINGS_PATH`)
- Modify: `habitat/server/index.js` (import, `createApp` param, rutas GET/POST, `/spawn`, arranque)
- Test: `habitat/server/index.test.js` (nuevos tests)

**Interfaces:**
- Consumes: `createSettings`, `PERMISSION_MODES` de Task 1; `newTmuxSession(name, dir, exec?, {permissionMode})` de Task 2.
- Produces:
  - `GET /settings` → `200 { permissionMode }`.
  - `POST /settings` → `200 { permissionMode }` + broadcast `{ type:'settings', settings:{permissionMode} }`; `400` si el modo es inválido o el body no es JSON.
  - `createApp({ config, store, settingsStore?, tmux? })` — `settingsStore` por defecto `createSettings()` (en memoria).
  - `/spawn` pasa `{ permissionMode }` (4º arg) a `tmux.newTmuxSession`.

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/index.test.js`, agregá el import arriba (junto a los otros):

```js
import { createSettings } from './settings.js';
```

Y agregá estos tests al final del archivo:

```js
test('GET /settings sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`);
  assert.equal(r.status, 401);
  server.close();
});

test('GET /settings devuelve el default acceptEdits', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`, { headers: auth });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.permissionMode, 'acceptEdits');
  server.close();
});

test('POST /settings con modo inválido -> 400', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ permissionMode: 'nope' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /settings válido -> 200, persiste en el store y broadcast', { timeout: 5000 }, async () => {
  const settingsStore = createSettings();
  const { server } = createApp({ config, store: createStore(), settingsStore });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const settingsMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'settings') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/settings`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ permissionMode: 'plan' }),
  });
  assert.equal(res.status, 200);
  const m = await settingsMsg;
  assert.equal(m.settings.permissionMode, 'plan');
  assert.equal(settingsStore.get().permissionMode, 'plan');
  ws.close();
  server.close();
});

test('POST /spawn pasa el permissionMode de settings a newTmuxSession', async () => {
  const settingsStore = createSettings();
  settingsStore.set({ permissionMode: 'plan' });
  const seen = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async (name, dir, _exec, opts) => { seen.push([name, dir, opts]); return true; },
  };
  const { server } = createApp({ config: spawnConfig(), store: createStore(), settingsStore, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [['proj-api', '/home/u/proj-api', { permissionMode: 'plan' }]]);
  server.close();
});
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `/settings` devuelve 404 (estático) y `/spawn` no pasa `opts`.

- [ ] **Step 3: Implementar config + rutas**

En `habitat/server/config.js`, dentro del objeto exportado, agregá la línea (después de `STATE_PATH`):

```js
  SETTINGS_PATH: process.env.HABITAT_SETTINGS || join(HERE, '..', '.settings.json'),
```

En `habitat/server/index.js`:

1. Agregá el import (junto a `createStore`):

```js
import { createSettings } from './settings.js';
```

2. Cambiá la firma de `createApp` para aceptar `settingsStore` con default:

```js
export function createApp({ config, store, settingsStore = createSettings(), tmux = { listSessions, newTmuxSession, killTmuxSession } }) {
```

3. Agregá las rutas `/settings` justo después del bloque `GET /projects` (antes de `POST /spawn`):

```js
    if (req.method === 'GET' && url.pathname === '/settings') {
      if (!authorize(req, res)) return;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(settingsStore.get()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/settings') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!settingsStore.set(body)) { res.writeHead(400).end(); return; }
      const settings = settingsStore.get();
      hub.broadcast({ type: 'settings', settings });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(settings));
      return;
    }
```

4. En el handler `POST /spawn`, reemplazá la línea `const ok = await tmux.newTmuxSession(name, dir);` por:

```js
      const { permissionMode } = settingsStore.get();
      const ok = await tmux.newTmuxSession(name, dir, undefined, { permissionMode });
```

5. En el bloque de arranque real (al final), reemplazá las dos líneas de creación por:

```js
  const store = createStore({ persistPath: config.STATE_PATH });
  const settingsStore = createSettings({ persistPath: config.SETTINGS_PATH });
  const { server } = createApp({ config, store, settingsStore });
```

- [ ] **Step 4: Correr toda la suite del servidor**

Run: `cd habitat && npm test`
Expected: PASS (incluidos los nuevos de `/settings` y `/spawn`, y los existentes sin regresión).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): rutas GET/POST /settings y /spawn lee el permissionMode"
```

---

### Task 4: Tipos + composable `useSettings` + sync por WS

**Files:**
- Modify: `habitat/client/src/types.ts` (tipos `PermissionMode`, `Settings`, `ServerMessage`)
- Create: `habitat/client/src/composables/useSettings.ts`
- Modify: `habitat/client/src/composables/useSocket.ts` (manejar `settings`)

**Interfaces:**
- Consumes: `GET/POST /settings` de Task 3; broadcast `{ type:'settings', settings }`.
- Produces:
  - `export type PermissionMode`, `export interface Settings { permissionMode: PermissionMode }`.
  - `useSettings() -> { permissionMode: Ref<PermissionMode>, error: Ref<string>, saving: Ref<boolean>, save(mode): Promise<boolean> }`.
  - `applyServerSettings(s: Settings): void` (usado por `useSocket`).

- [ ] **Step 1: Extender `types.ts`**

En `habitat/client/src/types.ts`, antes del bloque `// server -> client`, agregá:

```ts
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface Settings {
  permissionMode: PermissionMode
}
```

Y agregá una variante a la unión `ServerMessage`:

```ts
  | { type: 'settings'; settings: Settings }
```

- [ ] **Step 2: Crear el composable `useSettings.ts`**

Create `habitat/client/src/composables/useSettings.ts`:

```ts
import { ref } from 'vue'
import type { PermissionMode, Settings } from '../types'

// Token de la query, igual que useProjects/useSocket.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

// Estado compartido a nivel de módulo (singleton, como useProjects): /settings se
// pide una sola vez y permissionMode se comparte entre la vista y el resto.
const permissionMode = ref<PermissionMode>('acceptEdits')
const error = ref('')
const saving = ref(false)
let loaded = false

async function load() {
  try {
    const res = await fetch('/settings', { headers: authHeaders() })
    if (!res.ok) return
    const data = (await res.json()) as Settings
    permissionMode.value = data.permissionMode
  } catch {
    /* sin red: queda el default */
  }
}

async function save(mode: PermissionMode): Promise<boolean> {
  error.value = ''
  saving.value = true
  try {
    const res = await fetch('/settings', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ permissionMode: mode }),
    })
    if (res.ok) {
      const data = (await res.json()) as Settings
      permissionMode.value = data.permissionMode
      return true
    }
    error.value = 'no se pudo guardar'
    return false
  } catch {
    error.value = 'no se pudo guardar'
    return false
  } finally {
    saving.value = false
  }
}

// Aplica un broadcast del server (otra pestaña guardó). No dispara load().
export function applyServerSettings(s: Settings) {
  permissionMode.value = s.permissionMode
}

export function useSettings() {
  if (!loaded) {
    loaded = true
    load()
  }
  return { permissionMode, error, saving, save }
}
```

- [ ] **Step 3: Manejar el mensaje `settings` en `useSocket.ts`**

En `habitat/client/src/composables/useSocket.ts`, agregá el import arriba:

```ts
import { applyServerSettings } from './useSettings'
```

Y agregá una rama al `onmessage` (después de la línea de `fightResult`):

```ts
    else if (msg.type === 'settings') applyServerSettings(msg.settings)
```

- [ ] **Step 4: Verificar tipos**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS sin errores (`vue-tsc --noEmit`).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useSettings.ts habitat/client/src/composables/useSocket.ts
git commit -m "feat(habitat): tipos + useSettings + sync de settings por WS"
```

---

### Task 5: Vista `SettingsView` + toggle en `App.vue`

**Files:**
- Create: `habitat/client/src/components/SettingsView.vue`
- Modify: `habitat/client/src/App.vue` (ref de vista + toggle en header + render condicional)

**Interfaces:**
- Consumes: `useSettings()` de Task 4.
- Produces: nada para otras tasks (es la capa de UI final).

- [ ] **Step 1: Crear `SettingsView.vue`**

Create `habitat/client/src/components/SettingsView.vue`:

```vue
<script setup lang="ts">
import { useSettings } from '../composables/useSettings'
import type { PermissionMode } from '../types'

const { permissionMode, error, saving, save } = useSettings()

const MODES: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'default', label: 'Default', desc: 'Pregunta antes de cada acción (comportamiento normal).' },
  { value: 'acceptEdits', label: 'Auto-accept edits', desc: 'Auto-aprueba ediciones de archivos; pregunta por bash y acciones sensibles.' },
  { value: 'plan', label: 'Plan', desc: 'Arranca en modo plan: investiga y propone sin tocar nada.' },
  { value: 'bypassPermissions', label: 'Bypass', desc: 'Aprueba TODO sin preguntar. Usalo con cuidado.' },
]

function onChange(e: Event) {
  save((e.target as HTMLSelectElement).value as PermissionMode)
}
</script>

<template>
  <section class="settings">
    <h2>SETTINGS</h2>
    <div class="row">
      <label for="pmode">Permission mode de sesiones nuevas</label>
      <select id="pmode" :value="permissionMode" :disabled="saving" @change="onChange">
        <option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>
    <p class="desc">{{ MODES.find((m) => m.value === permissionMode)?.desc }}</p>
    <p class="err" v-if="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.settings { max-width: 560px; }
.settings h2 { font-family: var(--f-logo); margin: 0 0 18px; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.row label { font-family: var(--f-ui); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--dim); }
.row select { font-family: var(--f-ui); font-size: 13px; padding: 8px 10px; background: #1a1a24; color: var(--ink); border: 2px solid #3a3a4a; border-radius: 6px; }
.desc { color: var(--dim); font-size: 12px; margin: 4px 0 0; }
.err { color: #e06; font-size: 12px; }
</style>
```

- [ ] **Step 2: Agregar el toggle de vista en `App.vue`**

Reemplazá el contenido completo de `habitat/client/src/App.vue` por:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import SessionGrid from './components/SessionGrid.vue'
import SessionDrawer from './components/SessionDrawer.vue'
import SpawnMenu from './components/SpawnMenu.vue'
import SettingsView from './components/SettingsView.vue'

const store = useSessions()
const view = ref<'sessions' | 'settings'>('sessions')
onMounted(startSocket)
</script>

<template>
  <header>
    <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
    <div class="count">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <nav class="views">
      <button class="ctl" :class="{ active: view === 'sessions' }" @click="view = 'sessions'">Sesiones</button>
      <button class="ctl" :class="{ active: view === 'settings' }" @click="view = 'settings'">⚙ Settings</button>
    </nav>
    <SpawnMenu />
  </header>
  <main>
    <SessionGrid v-if="view === 'sessions'" />
    <SettingsView v-else />
  </main>
  <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
  <SessionDrawer />
</template>

<style scoped>
.views { display: flex; gap: 6px; }
.views .ctl.active { background: var(--gold); color: #2a1c0a; }
</style>
```

- [ ] **Step 3: Verificar tipos y build**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS sin errores.

- [ ] **Step 4: Verificación manual**

Run: `cd habitat && npm start` (con `HABITAT_ALLOW_SPAWN=1` y `HABITAT_PROJECTS=...` si querés probar spawn), abrir la GUI:
- El header muestra `[Sesiones] [⚙ Settings]`; al tocar Settings se ve el `<select>` con el modo actual (acceptEdits por default).
- Cambiar el modo → recargar la página → el modo elegido persiste (vino de `.settings.json`).
- Crear una sesión nueva → en su tmux se lanza `claude` con el flag correspondiente (`default` → sin flag).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/SettingsView.vue habitat/client/src/App.vue
git commit -m "feat(habitat): vista Settings con selector de permission mode"
```

---

## Self-Review

**Spec coverage:**
- Persistencia server-side (`settings.js` + `.settings.json`, atómica) → Task 1 + config en Task 3. ✓
- `SETTINGS_PATH` en config → Task 3. ✓
- Rutas `GET`/`POST /settings` con validación + broadcast → Task 3. ✓
- `/spawn` lee la setting; `newTmuxSession` arma el flag → Task 2 + Task 3. ✓
- Vista que reemplaza el grid + toggle en header → Task 5. ✓
- `useSettings` singleton + sync por WS → Task 4. ✓
- Selector de 4 modos con descripciones → Task 5. ✓
- Default `acceptEdits`, sólo sesiones nuevas, global → Task 1 (default) + diseño. ✓
- Tests de settings/tmux/index → Tasks 1-3. ✓

**Type consistency:** `permissionMode` / `PermissionMode` / `Settings` / `createSettings` / `PERMISSION_MODES` / `applyServerSettings` usados consistentes entre tasks. `newTmuxSession(name, dir, exec?, {permissionMode})` consistente entre Task 2 (def) y Task 3 (uso). Mensaje WS `{ type:'settings', settings }` consistente entre Task 3 (emite), Task 4 (consume) y types.ts.

**Placeholder scan:** sin TBD/TODO; todo el código está completo.
