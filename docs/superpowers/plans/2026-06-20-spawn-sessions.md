# Abrir sesiones tmux desde el panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear una sesión de Claude Code desde la GUI: el usuario elige un proyecto de una whitelist y el server lanza `claude` en una sesión tmux nueva; el pod aparece solo vía el hook `SessionStart`.

**Architecture:** Dos endpoints HTTP nuevos (`GET /projects`, `POST /spawn`) detrás del mismo `authorize()` (token + loopback) que el resto. Una función `newTmuxSession` en `tmux.js`. `createApp` gana inyección de deps de tmux para testear sin tmux real. En el front, un componente `SpawnMenu.vue` en el header.

**Tech Stack:** Node 18 (ESM, sin TypeScript en server), `node:test`. Front Vue 3 + TS + Vite.

## Global Constraints

- **Server: JavaScript plano (ESM)**, sin TypeScript. Tests con `node:test` (`node --test`).
- **Sin dependencias nuevas.** Solo `ws` (ya presente).
- **Seguridad (Ley 1):** `/projects` y `/spawn` exigen `authorize()` (Bearer `MNONM_TOKEN` + bind loopback). `/spawn` además requiere `ALLOW_SPAWN` y whitelist.
- **Contrato estable:** no renombrar campos existentes. Comandos tmux vía `execFile` con array de args (sin shell).
- **Commits frecuentes**, uno por tarea. Terminar mensajes con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Front:** correr `npm run build` (incluye `vue-tsc`) en `habitat/client` antes del commit del front; el build sale a `habitat/web/` (gitignored).

---

### Task 1: Config — ALLOW_SPAWN + PROJECTS

**Files:**
- Modify: `habitat/server/config.js`
- Test: `habitat/server/config.test.js`

**Interfaces:**
- Produces: `config.ALLOW_SPAWN: boolean`, `config.PROJECTS: string[]`.

- [ ] **Step 1: Escribir el test (agregar al final de config.test.js, antes de cerrar)**

```js
test('config: ALLOW_SPAWN y PROJECTS con defaults', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.ALLOW_SPAWN, 'boolean');
  assert.equal(Array.isArray(config.PROJECTS), true);
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/config.test.js`
Expected: FAIL — `config.ALLOW_SPAWN` es `undefined` (typeof !== 'boolean').

- [ ] **Step 3: Implementar en config.js**

Agregar el helper `list` y los dos campos al objeto exportado:

```js
const num = (v, d) => (v == null || v === '' ? d : Number(v));
const bool = (v) => v === '1' || v === 'true';
const list = (v) => (v ? String(v).split(':').map((s) => s.trim()).filter(Boolean) : []);

export default {
  PORT: num(process.env.MNONM_PORT, 8377),
  BIND: process.env.MNONM_BIND || '127.0.0.1',
  TOKEN: process.env.MNONM_TOKEN || '',
  PREVIEW_LINES: num(process.env.MNONM_PREVIEW_LINES, 30),
  MAX_CONTEXT: num(process.env.MNONM_MAX_CONTEXT, 200000),
  ALLOW_SPAWN: bool(process.env.MNONM_ALLOW_SPAWN),
  PROJECTS: list(process.env.MNONM_PROJECTS),
};
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/config.test.js
git commit -m "feat(habitat): config ALLOW_SPAWN + PROJECTS (whitelist de spawn)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: tmux — newTmuxSession

**Files:**
- Modify: `habitat/server/tmux.js`
- Test: `habitat/server/tmux.test.js`

**Interfaces:**
- Consumes: `sendKeys(name, text, exec)` (ya existe en tmux.js).
- Produces: `newTmuxSession(name, dir, exec = defaultExec)` → `Promise<boolean>`. Crea sesión detached en `dir` y lanza `claude` por send-keys. `true` si OK, `false` ante error.

- [ ] **Step 1: Escribir los tests (agregar al final de tmux.test.js)**

```js
test('newTmuxSession crea sesión detached en dir y lanza claude', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  const ok = await newTmuxSession('proj', '/home/u/proj', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['tmux', 'new-session', '-d', '-s', 'proj', '-c', '/home/u/proj']);
  // luego send-keys del comando claude + Enter (vía sendKeys)
  assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', 'proj', '-l', 'claude']);
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'proj', 'Enter']);
});

test('newTmuxSession ante error de new-session devuelve false', async () => {
  const exec = async () => { throw new Error('duplicate session'); };
  assert.equal(await newTmuxSession('proj', '/x', exec), false);
});
```

Y agregar `newTmuxSession` al import del tope del archivo:

```js
import { capturePane, listSessions, sendKeys, gitBranch, newTmuxSession } from './tmux.js';
```

> NOTA: ese import está en `tmux.test.js`. Reemplazar la línea de import existente
> (`import { capturePane, listSessions, sendKeys, gitBranch } from './tmux.js';`) por la de arriba.

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: FAIL — `newTmuxSession is not a function` / no exportada.

- [ ] **Step 3: Implementar en tmux.js**

Agregar al final del archivo (usa el `defaultExec` async ya definido y reusa `sendKeys`):

```js
// Crea una sesión tmux detached en `dir` y lanza claude dentro (vía shell de login,
// para heredar PATH/rc y disparar los hooks de ~/.claude/settings.json).
export async function newTmuxSession(name, dir, exec = defaultExec) {
  try {
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', dir]);
    await sendKeys(name, 'claude', exec);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: PASS (todos los tests de tmux, incluidos los 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/tmux.js habitat/server/tmux.test.js
git commit -m "feat(habitat): tmux newTmuxSession (crea sesión + lanza claude)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Server — GET /projects + POST /spawn

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `config.ALLOW_SPAWN`, `config.PROJECTS` (Task 1); `newTmuxSession`, `listSessions` (Task 2 + existente).
- Produces: `createApp({ config, store, tmux })` — `tmux` opcional = `{ listSessions, newTmuxSession }` (default: reales). Endpoints:
  - `GET /projects` → `200 { canSpawn, projects:[{name,dir}] }`.
  - `POST /spawn {dir}` → `200 {name}` | `400` | `403` | `409` | `500`.

- [ ] **Step 1: Escribir los tests (agregar al final de index.test.js)**

```js
const spawnConfig = (over) => ({ ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'], ...over });
const auth = { authorization: 'Bearer secret' };

test('GET /projects refleja canSpawn (off)', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.canSpawn, false);
  server.close();
});

test('GET /projects lista la whitelist cuando está habilitado', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const body = await r.json();
  assert.equal(body.canSpawn, true);
  assert.deepEqual(body.projects, [{ name: 'proj-api', dir: '/home/u/proj-api' }]);
  server.close();
});

test('POST /spawn deshabilitado -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /spawn dir fuera de whitelist -> 403', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/etc' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /spawn body inválido -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: '{ no json',
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn colisión -> 409', async () => {
  const tmux = { listSessions: async () => ['proj-api'], newTmuxSession: async () => true };
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /spawn OK -> 200 con name; invoca newTmuxSession', async () => {
  const seen = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async (name, dir) => { seen.push([name, dir]); return true; },
  };
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api');
  assert.deepEqual(seen, [['proj-api', '/home/u/proj-api']]);
  server.close();
});
```

- [ ] **Step 2: Correr los tests (deben fallar)**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `/projects` y `/spawn` devuelven 404 (rutas inexistentes) → asserts fallan.

- [ ] **Step 3: Implementar en index.js**

3a. Agregar `newTmuxSession` al import de tmux (la línea actual es
`import { capturePane, sendKeys, gitBranch } from './tmux.js';`), y también `listSessions`:

```js
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession } from './tmux.js';
```

3b. Cambiar la firma de `createApp` para aceptar `tmux` con default a las reales:

```js
export function createApp({ config, store, tmux = { listSessions, newTmuxSession } }) {
```

3c. Agregar los dos handlers dentro del `createServer(async (req, res) => {...})`, justo
**después** del bloque `GET /preview` y **antes** del bloque de estáticos (`// estáticos`):

```js
    if (req.method === 'GET' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      const canSpawn = config.ALLOW_SPAWN && config.PROJECTS.length > 0;
      const projects = config.PROJECTS.map((dir) => ({ name: basename(dir), dir }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, projects }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/spawn') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const dir = body && body.dir;
      if (typeof dir !== 'string' || !dir) { res.writeHead(400).end(); return; }
      if (!config.PROJECTS.includes(dir)) { res.writeHead(403).end(); return; }
      const name = basename(dir);
      const existing = await tmux.listSessions();
      if (existing.includes(name)) { res.writeHead(409).end(); return; }
      const ok = await tmux.newTmuxSession(name, dir);
      if (!ok) { res.writeHead(500).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name }));
      return;
    }
```

3d. Verificar que `basename` ya está importado de `node:path` al tope de index.js. La línea
actual es `import { dirname, join, extname, normalize, sep } from 'node:path';` — agregar `basename`:

```js
import { dirname, join, extname, normalize, sep, basename } from 'node:path';
```

- [ ] **Step 4: Correr los tests (deben pasar)**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (los 4 previos + los 7 nuevos).

- [ ] **Step 5: Correr TODA la suite del server**

Run: `cd habitat && node --test server/*.test.js`
Expected: PASS — toda la suite verde.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoints /projects y /spawn (crear sesión desde el panel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Front — SpawnMenu en el header

**Files:**
- Create: `habitat/client/src/composables/useProjects.ts`
- Create: `habitat/client/src/components/SpawnMenu.vue`
- Modify: `habitat/client/src/App.vue`
- Modify: `habitat/client/src/style.css` (estilos del menú)

**Interfaces:**
- Consumes: `GET /projects`, `POST /spawn` (Task 3).
- Produces: componente `SpawnMenu` montado en el header; usa el token de la query (igual que `usePreview`).

- [ ] **Step 1: Crear el composable useProjects.ts**

`habitat/client/src/composables/useProjects.ts`:

```ts
import { ref, onMounted } from 'vue'

// Token de la query, igual que usePreview/useSocket.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = () => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface Project {
  name: string
  dir: string
}

export function useProjects() {
  const canSpawn = ref(false)
  const projects = ref<Project[]>([])
  const error = ref('')

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

  async function spawn(dir: string): Promise<boolean> {
    error.value = ''
    try {
      const res = await fetch('/spawn', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ dir }),
      })
      if (res.ok) return true
      error.value =
        res.status === 409 ? 'ya hay una sesión para ese proyecto'
        : res.status === 403 ? 'no permitido'
        : 'no se pudo crear la sesión'
      return false
    } catch {
      error.value = 'no se pudo crear la sesión'
      return false
    }
  }

  onMounted(load)
  return { canSpawn, projects, error, spawn }
}
```

- [ ] **Step 2: Crear el componente SpawnMenu.vue**

`habitat/client/src/components/SpawnMenu.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const busy = ref(false)

async function pick(dir: string) {
  busy.value = true
  const ok = await spawn(dir)
  busy.value = false
  if (ok) open.value = false
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="open = !open" :disabled="busy">+ NUEVA SESIÓN</button>
    <div class="spawn-menu" v-if="open">
      <button
        v-for="p in projects"
        :key="p.dir"
        class="ctl spawn-item"
        :disabled="busy"
        @click="pick(p.dir)"
      >
        {{ p.name }}
      </button>
      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Montar SpawnMenu en el header de App.vue**

En `habitat/client/src/App.vue`, importar y colocar el componente en el header (después del bloque `.count`):

3a. Agregar al `<script setup>`:

```ts
import SpawnMenu from './components/SpawnMenu.vue'
```

3b. En el `<header>`, después de `</div>` del `.count`, agregar:

```html
    <SpawnMenu />
```

El header queda:

```html
  <header>
    <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
    <div class="count">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <SpawnMenu />
  </header>
```

- [ ] **Step 4: Estilos del menú (agregar al final de style.css)**

`habitat/client/src/style.css`:

```css
  /* ===== MENÚ DE NUEVA SESIÓN ===== */
  .spawn{position:relative}
  .spawn-menu{position:absolute; top:calc(100% + 8px); right:0; z-index:10;
    background:#1f1710; border:2px solid var(--line); box-shadow:var(--bevel), 4px 4px 0 #0b0703;
    padding:8px; display:flex; flex-direction:column; gap:6px; min-width:180px}
  .spawn-item{text-align:left; text-transform:none}
  .spawn-err{font-family:var(--f-body); font-size:14px; color:var(--red); padding:4px 2px}
```

- [ ] **Step 5: Build + typecheck**

Run: `cd habitat/client && npm run build`
Expected: `vue-tsc` sin errores; build a `../web` OK.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/composables/useProjects.ts habitat/client/src/components/SpawnMenu.vue habitat/client/src/App.vue habitat/client/src/style.css
git commit -m "feat(habitat): SpawnMenu — crear sesión desde el header

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: e2e + README

**Files:**
- Modify: `habitat/README.md`
- Test (manual/e2e): in-process, sin tmux

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: e2e in-process de /projects (script temporal)**

Crear un script en el scratchpad (no se commitea) que levante `createApp` in-process y verifique:
- flag off → `GET /projects` devuelve `canSpawn:false`.
- flag on + whitelist → `canSpawn:true` y `projects` con el `name` correcto.

```js
import { createStore } from '<abs>/habitat/server/state.js';
import { createApp } from '<abs>/habitat/server/index.js';
const base = { PORT:0, BIND:'127.0.0.1', TOKEN:'test', PREVIEW_LINES:5, MAX_CONTEXT:200000 };
const auth = { authorization: 'Bearer test' };

async function run(cfg) {
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await new Promise((r)=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const b = await r.json(); server.close(); return b;
}
const off = await run({ ...base, ALLOW_SPAWN:false, PROJECTS:[] });
const on  = await run({ ...base, ALLOW_SPAWN:true, PROJECTS:['/home/u/proj-api'] });
console.log('off.canSpawn', off.canSpawn === false ? 'PASS' : 'FAIL');
console.log('on.canSpawn', on.canSpawn === true ? 'PASS' : 'FAIL');
console.log('on.projects', on.projects[0]?.name === 'proj-api' ? 'PASS' : 'FAIL');
process.exit(0);
```

Run: `node <abs>/scratchpad/spawn-e2e.mjs`
Expected: 3 PASS.

- [ ] **Step 2: Documentar en README.md**

Agregar una sección a `habitat/README.md`:

```markdown
## Crear sesiones desde el panel (opcional)

Deshabilitado por default. Para habilitarlo, exportar antes de `npm start`:

    export MNONM_ALLOW_SPAWN=1
    export MNONM_PROJECTS="/home/tu/proyecto-a:/home/tu/proyecto-b"   # rutas absolutas, separadas por :

Con eso, el header muestra "+ NUEVA SESIÓN": elegís un proyecto y el server crea una sesión
tmux con nombre = basename del directorio y lanza `claude` dentro. El pod aparece cuando Claude
dispara `SessionStart`. El nombre tmux = basename habilita el preview y el chat sobre esa sesión.

> Crear sesiones spawnea procesos en tu máquina. El endpoint exige el mismo token, bind a
> loopback, el flag `MNONM_ALLOW_SPAWN`, y que el directorio esté en `MNONM_PROJECTS`.
```

- [ ] **Step 3: Commit**

```bash
git add habitat/README.md
git commit -m "docs(habitat): cómo habilitar la creación de sesiones (spawn)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Criterios de aceptación

- [ ] `MNONM_ALLOW_SPAWN=1` + `MNONM_PROJECTS=...` → aparece "+ NUEVA SESIÓN" en el header.
- [ ] Elegir un proyecto → se crea la sesión tmux y `claude` arranca; el pod aparece vía hook.
- [ ] Sin el flag → no aparece el botón y `POST /spawn` responde 403.
- [ ] `dir` fuera de la whitelist → 403; sesión ya existente → 409.
- [ ] `/projects` y `/spawn` sin token → 401.
- [ ] `cd habitat && node --test server/*.test.js` → toda la suite verde.
- [ ] `cd habitat/client && npm run build` → typecheck + build sin errores.
