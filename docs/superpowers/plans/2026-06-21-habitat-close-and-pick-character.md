# Cerrar sesiones y elegir personaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cerrar una sesión desde la GUI del Hábitat (matar tmux+claude y quitar el pod) y elegir el personaje del héroe al crear la sesión.

**Architecture:** Server Node ESM con endpoints HTTP detrás de `authorize()` (token + loopback) e inyección de `tmux` en `createApp`; estado en `createStore` (respaldado a disco). Las sesiones nacen del hook `SessionStart` (keyed por `session_id`), así que el personaje elegido se transporta del `/spawn` al hook vía un "pending char" keyed por nombre. Front Vue 3 + Pinia que recibe estado por WS.

**Tech Stack:** Node.js (`node:test`, sin libs de test externas), `ws`, Vue 3 + Pinia + TypeScript + Vite.

## Global Constraints

- Módulos ESM (`import`/`export`), `"type": "module"`. No CommonJS.
- Tests del server: `node:test` + `node:assert/strict`, archivos `*.test.js` co-locados. Se corren con `npm test` (= `node --test`) desde `habitat/`.
- Comentarios y mensajes de UI en español (calcar el estilo existente).
- Toda superficie HTTP/WS nueva pasa por `authorize(req, res)` (token + loopback) primero.
- Cerrar y elegir personaje se gatean con el flag existente `config.ALLOW_SPAWN` (no se agrega config nueva).
- La lista de personajes válidos en el server (`CHARACTERS`) DEBE quedar idéntica a `CHARS`/`CHARACTERS` en `habitat/client/src/sprites.ts`.
- Front: typecheck con `npm run typecheck` (`vue-tsc --noEmit`); build con `npm run build` (sale a `../web`).
- `cwd` del shell: usar rutas absolutas. El working dir base es `/home/mnonm/proyectos/RPG-Agents`.

---

### Task 1: `killTmuxSession` en tmux.js

**Files:**
- Modify: `habitat/server/tmux.js`
- Test: `habitat/server/tmux.test.js`

**Interfaces:**
- Produces: `killTmuxSession(name: string, exec?) => Promise<boolean>` — corre `tmux kill-session -t <name>`; `true` si ok, `false` si `exec` tira.

- [ ] **Step 1: Escribir el test que falla**

En `habitat/server/tmux.test.js`, agregar `killTmuxSession` al import de la línea 3:

```js
import { capturePane, listSessions, sendKeys, gitBranch, newTmuxSession, killTmuxSession } from './tmux.js';
```

Y al final del archivo:

```js
test('killTmuxSession arma kill-session -t name', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args]); return ''; };
  const ok = await killTmuxSession('proj', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['tmux', 'kill-session', '-t', 'proj']);
});

test('killTmuxSession ante error devuelve false', async () => {
  const exec = async () => { throw new Error('no session'); };
  assert.equal(await killTmuxSession('proj', exec), false);
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/tmux.test.js`
Expected: FAIL (`killTmuxSession is not a function` / import no resuelve).

- [ ] **Step 3: Implementar**

En `habitat/server/tmux.js`, al final del archivo (después de `newTmuxSession`):

```js
// Mata la sesión tmux (y con ella claude+shell). Best-effort: si la sesión ya no
// existe, exec tira y devolvemos false, pero el endpoint igual limpia el pod.
export async function killTmuxSession(name, exec = defaultExec) {
  try {
    await exec('tmux', ['kill-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/tmux.test.js`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 5: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/tmux.js habitat/server/tmux.test.js
git commit -m "feat(habitat): killTmuxSession para cerrar sesiones tmux"
```

---

### Task 2: Pending char en el store

**Files:**
- Modify: `habitat/server/state.js` (función `createStore`)
- Test: `habitat/server/state.test.js`

**Interfaces:**
- Produces (en el objeto que devuelve `createStore`):
  - `setPendingChar(name: string, char: string) => void`
  - `takePendingChar(name: string) => string | undefined` — devuelve el char y lo borra (one-shot).
- Es un `Map` en memoria, NO se persiste a disco.

- [ ] **Step 1: Escribir el test que falla**

Al final de `habitat/server/state.test.js`:

```js
test('pending char: set y take (one-shot)', () => {
  const store = createStore();
  store.setPendingChar('api', 'Knight');
  assert.equal(store.takePendingChar('api'), 'Knight');
  assert.equal(store.takePendingChar('api'), undefined); // one-shot: el segundo take no reusa
});

test('pending char: take de inexistente -> undefined', () => {
  const store = createStore();
  assert.equal(store.takePendingChar('nope'), undefined);
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/state.test.js`
Expected: FAIL (`store.setPendingChar is not a function`).

- [ ] **Step 3: Implementar**

En `habitat/server/state.js`, dentro de `createStore`, después de `const map = new Map();` (línea 46):

```js
  // Personaje elegido en /spawn, keyed por nombre de proyecto. SessionStart lo consume
  // (one-shot). En memoria: la ventana spawn->SessionStart es de ~1-2s, no se persiste.
  const pendingChars = new Map();
```

Y en el objeto `return { ... }`, agregar (después de `persist,`):

```js
    setPendingChar: (name, char) => { pendingChars.set(name, char); },
    takePendingChar: (name) => { const c = pendingChars.get(name); pendingChars.delete(name); return c; },
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/state.js habitat/server/state.test.js
git commit -m "feat(habitat): pending char one-shot en el store"
```

---

### Task 3: Hook SessionStart consume pending char + SessionEnd no-op

**Files:**
- Modify: `habitat/server/hooks-logic.js` (función `applyEvent`, case `SessionStart`)
- Modify: `habitat/server/index.js` (handler `POST /hooks`, guard de `session` null)
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: `store.takePendingChar(name)` (Task 2), `store.get(id)`.
- Produces: `applyEvent` puede devolver `{ session: null, fightResult: null }` cuando llega `SessionEnd` de una sesión inexistente. Los consumidores (index `/hooks`) deben tolerar `session === null`.
- En `SessionStart`, si hay pending char, queda en `session.char` (string).

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `habitat/server/hooks-logic.test.js`:

```js
test('SessionStart consume pending char y lo asigna a s.char (one-shot)', () => {
  const store = createStore();
  store.setPendingChar('proj-api', 'Knight');
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.char, 'Knight');
  assert.equal(store.takePendingChar('proj-api'), undefined); // ya fue consumido
});

test('SessionStart sin pending char deja char undefined', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.char, undefined);
});

test('SessionEnd sobre sesión inexistente no la crea (no-op)', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 'ghost', hook_event_name: 'SessionEnd',
  }, deps(null));
  assert.equal(session, null);
  assert.equal(store.get('ghost'), undefined);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/hooks-logic.test.js`
Expected: FAIL (`session.char` undefined donde se espera 'Knight'; `SessionEnd` crea la sesión así que `session` no es null).

- [ ] **Step 3a: Implementar el no-op de SessionEnd**

En `habitat/server/hooks-logic.js`, dentro de `applyEvent`, justo después de `const ev = payload.hook_event_name;` (línea 35) y ANTES de `const s = ensure(store, payload);`:

```js
  // SessionEnd de una sesión que ya no existe (p.ej. la matamos desde la GUI): no la
  // recreamos sólo para marcarla offline. ensure() crearía un pod zombie.
  if (ev === 'SessionEnd' && !store.get(payload.session_id)) {
    return { session: null, fightResult: null };
  }
```

- [ ] **Step 3b: Implementar el consumo de pending char**

En el mismo archivo, en el `case 'SessionStart':`, después del bloque `if (payload.cwd) { ... }` y antes de `setStatus(s, 'idle', ...)`:

```js
      const pendingChar = store.takePendingChar(s.name);
      if (pendingChar) s.char = pendingChar;
```

- [ ] **Step 3c: Guard de session null en /hooks**

En `habitat/server/index.js`, handler `POST /hooks` (línea ~54), cambiar:

```js
        hub.broadcast({ type: 'session', session: snapOf(session) });
```

por:

```js
        if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
```

(El `store.persist()` y el `if (fightResult)` quedan igual; con `session` null no hay nada que anunciar.)

- [ ] **Step 4: Correr y ver que pasan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/hooks-logic.test.js server/index.test.js`
Expected: PASS (no se rompe ningún test existente de hooks ni de /hooks).

- [ ] **Step 5: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/hooks-logic.js habitat/server/index.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): SessionStart asigna char elegido; SessionEnd no resucita pods"
```

---

### Task 4: Lista canónica `CHARACTERS` + `/spawn` acepta `char`

**Files:**
- Create: `habitat/server/characters.js`
- Modify: `habitat/server/index.js` (import + handler `POST /spawn`)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Produces: `characters.js` exporta `CHARACTERS: string[]` (16 nombres).
- `POST /spawn { dir, char? }`: si `char` viene y no está en `CHARACTERS` → `400`. Si es válido, `store.setPendingChar(name, char)` antes de `newTmuxSession`. El resto del contrato (`200 { name }`, 409, 403) no cambia.

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/index.test.js`, después del test `POST /spawn OK -> 200 con name` (línea ~143):

```js
test('POST /spawn con char inválido -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'NoExiste' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn con char válido -> setPendingChar(name, char) y 200', async () => {
  const store = createStore();
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const { server } = createApp({ config: spawnConfig(), store, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  assert.equal(store.takePendingChar('proj-api'), 'Knight');
  server.close();
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/index.test.js`
Expected: FAIL (char inválido devuelve 200 en vez de 400; pending char no seteado).

- [ ] **Step 3a: Crear characters.js**

Crear `habitat/server/characters.js`:

```js
// Lista canónica de personajes jugables del Hábitat.
// DEBE quedar alineada con CHARACTERS en habitat/client/src/sprites.ts
// (mismo contrato duplicado client/server que types.ts <-> state.js).
export const CHARACTERS = [
  'Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed',
  'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman',
];
```

- [ ] **Step 3b: Validar char en /spawn**

En `habitat/server/index.js`:

1. Agregar el import (después de la línea 11, los imports de tmux):

```js
import { CHARACTERS } from './characters.js';
```

2. En el handler `POST /spawn`, después de la validación de whitelist `if (!config.PROJECTS.includes(dir)) { ... }` (línea ~85) y antes de `const name = basename(dir);`:

```js
      const char = body && body.char;
      if (char != null && !CHARACTERS.includes(char)) { res.writeHead(400).end(); return; }
```

3. Después del chequeo de colisión `if (existing.includes(name)) { res.writeHead(409).end(); return; }` (línea ~88) y antes de `const ok = await tmux.newTmuxSession(...)`:

```js
      if (char) store.setPendingChar(name, char);
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/index.test.js`
Expected: PASS (incluidos los tests viejos de /spawn).

- [ ] **Step 5: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/characters.js habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): /spawn acepta y valida el personaje elegido"
```

---

### Task 5: Endpoint `POST /kill`

**Files:**
- Modify: `habitat/server/index.js` (import tmux, default deps, handler nuevo)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `tmux.killTmuxSession` (Task 1), `store.remove`, `store.get`, `hub.broadcast`.
- Produces: `POST /kill { id }` → `403` sin ALLOW_SPAWN, `400` body inválido, `404` id desconocido, `200` + broadcast `{ type: 'remove', id }` + `store.remove(id)` en el caso OK.

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/index.test.js`, asegurar que el import de la línea 4 incluya `newSession`:

```js
import { createStore, newSession } from './state.js';
```

Agregar al final del archivo:

```js
test('POST /kill deshabilitado -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'x' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /kill body sin id -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /kill id desconocido -> 404', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope' }),
  });
  assert.equal(r.status, 404);
  server.close();
});

test('POST /kill OK -> 200, mata tmux, remueve del store y broadcast remove', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'proj-api' }));
  const killed = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async (n) => { killed.push(n); return true; },
  };
  const { server } = createApp({ config: spawnConfig(), store, tmux });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const removeMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'remove') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's1' }),
  });
  assert.equal(res.status, 200);
  const m = await removeMsg;
  assert.equal(m.id, 's1');
  assert.equal(store.get('s1'), undefined);
  assert.deepEqual(killed, ['proj-api']);
  ws.close();
  server.close();
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/index.test.js`
Expected: FAIL (`/kill` no existe → cae a estáticos → 404 en todos, y el OK nunca emite remove).

- [ ] **Step 3a: Importar killTmuxSession y sumarlo a las deps default**

En `habitat/server/index.js`:

1. Cambiar el import de tmux (línea 11) para incluir `killTmuxSession`:

```js
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession, killTmuxSession } from './tmux.js';
```

2. Cambiar la firma de `createApp` (línea ~32) para sumar `killTmuxSession` al default de `tmux`:

```js
export function createApp({ config, store, tmux = { listSessions, newTmuxSession, killTmuxSession } }) {
```

- [ ] **Step 3b: Agregar el handler /kill**

En `habitat/server/index.js`, justo después del bloque `POST /spawn` (después de su `return;`, línea ~93) y antes del comentario `// estáticos`:

```js
    if (req.method === 'POST' && url.pathname === '/kill') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const id = body && body.id;
      if (typeof id !== 'string' || !id) { res.writeHead(400).end(); return; }
      const s = store.get(id);
      if (!s) { res.writeHead(404).end(); return; }
      await tmux.killTmuxSession(s.tmux || s.name); // best-effort: ignoramos el resultado
      store.remove(id); // ya persiste a disco
      hub.broadcast({ type: 'remove', id });
      res.writeHead(200).end();
      return;
    }
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Correr TODA la suite del server**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && npm test`
Expected: PASS (todos los `server/*.test.js`).

- [ ] **Step 6: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint POST /kill cierra la sesión y quita el pod"
```

---

### Task 6: Front — `sprites.ts` override de personaje + tipo `char`

**Files:**
- Modify: `habitat/client/src/sprites.ts`
- Modify: `habitat/client/src/types.ts`

**Interfaces:**
- Produces:
  - `export const CHARACTERS: string[]` en `sprites.ts`.
  - `heroIdle(name: string, char?: string) => string` y `faceFor(name: string, char?: string) => string` — usan `char` si es válido, si no caen a `charFor(name)`.
  - `Session.char?: string` en `types.ts`.

- [ ] **Step 1: Agregar `char` al tipo Session**

En `habitat/client/src/types.ts`, dentro de `interface Session`, después de `tmux?: string` (línea 31):

```ts
  char?: string // personaje elegido al crear; si no, se deriva por hash del nombre
```

- [ ] **Step 2: Exportar CHARACTERS y agregar el override en sprites.ts**

En `habitat/client/src/sprites.ts`, cambiar la línea 2 para exportar y renombrar `CHARS` → `CHARACTERS`:

```ts
export const CHARACTERS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']
```

Reemplazar las funciones `charFor`/`heroIdle`/`faceFor` (líneas 15-23) por:

```ts
export function charFor(name: string): string {
  return CHARACTERS[hash('spr' + name) % CHARACTERS.length]
}
// Personaje a usar: el elegido (si es válido) o el derivado del nombre.
function resolveChar(name: string, char?: string): string {
  return char && CHARACTERS.includes(char) ? char : charFor(name)
}
export function heroIdle(name: string, char?: string): string {
  return `assets/char/${resolveChar(name, char)}/idle.png`
}
export function faceFor(name: string, char?: string): string {
  return `assets/char/${resolveChar(name, char)}/face.png`
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat/client && npm run typecheck`
Expected: PASS (sin errores de TS).

- [ ] **Step 4: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/client/src/sprites.ts habitat/client/src/types.ts
git commit -m "feat(habitat): sprites soportan personaje explícito; tipo Session.char"
```

---

### Task 7: Front — `useProjects` singleton + `kill` + `spawn(dir, char)`

**Files:**
- Modify: `habitat/client/src/composables/useProjects.ts`

**Interfaces:**
- Consumes: endpoints `GET /projects`, `POST /spawn { dir, char? }`, `POST /kill { id }`.
- Produces: `useProjects()` devuelve `{ canSpawn, projects, error, spawn, kill }` con estado **compartido a nivel de módulo** (un solo fetch de `/projects`).
  - `spawn(dir: string, char?: string) => Promise<boolean>`
  - `kill(id: string) => Promise<boolean>`

- [ ] **Step 1: Reescribir useProjects.ts**

Reemplazar el contenido completo de `habitat/client/src/composables/useProjects.ts` por:

```ts
import { ref } from 'vue'

// Token de la query, igual que usePreview/useSocket.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface Project {
  name: string
  dir: string
}

// Estado compartido a nivel de módulo (singleton, como useSocket): /projects se
// pide una sola vez y canSpawn/kill se comparten entre SpawnMenu, pods y drawer.
const canSpawn = ref(false)
const projects = ref<Project[]>([])
const error = ref('')
let loaded = false

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

async function spawn(dir: string, char?: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/spawn', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ dir, char }),
    })
    if (res.ok) return true
    error.value =
      res.status === 409 ? 'ya hay una sesión para ese proyecto'
      : res.status === 403 ? 'no permitido'
      : res.status === 400 ? 'pedido inválido'
      : 'no se pudo crear la sesión'
    return false
  } catch {
    error.value = 'no se pudo crear la sesión'
    return false
  }
}

// Cierra una sesión: el server mata el proceso y quita el pod; el pod desaparece
// solo al llegar el broadcast `remove` por WS (no removemos localmente).
async function kill(id: string): Promise<boolean> {
  try {
    const res = await fetch('/kill', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
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
  return { canSpawn, projects, error, spawn, kill }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat/client && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/client/src/composables/useProjects.ts
git commit -m "feat(habitat): useProjects singleton con kill y spawn(dir, char)"
```

---

### Task 8: Front — `SpawnMenu` wizard proyecto → personaje

**Files:**
- Modify: `habitat/client/src/components/SpawnMenu.vue`

**Interfaces:**
- Consumes: `useProjects()` → `{ canSpawn, projects, error, spawn }`; `CHARACTERS` y `faceFor` de `sprites.ts`.
- Comportamiento: click "+ NUEVA SESIÓN" → lista de proyectos → al elegir uno, grilla de 16 caras + tile "Auto" (spawnea sin char) + "← volver" → click en una cara llama `spawn(dir, char)`.

- [ ] **Step 1: Reescribir SpawnMenu.vue**

Reemplazar el contenido completo de `habitat/client/src/components/SpawnMenu.vue` por:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import { CHARACTERS, faceFor } from '../sprites'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const step = ref<'proj' | 'char'>('proj')
const pickedDir = ref('')
const busy = ref(false)

function toggle() {
  open.value = !open.value
  step.value = 'proj'
  pickedDir.value = ''
}
function pickProject(dir: string) {
  pickedDir.value = dir
  step.value = 'char'
}
function back() {
  step.value = 'proj'
  pickedDir.value = ''
}
async function create(char?: string) {
  busy.value = true
  const ok = await spawn(pickedDir.value, char)
  busy.value = false
  if (ok) {
    open.value = false
    step.value = 'proj'
    pickedDir.value = ''
  }
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="toggle" :disabled="busy">+ NUEVA SESIÓN</button>
    <div class="spawn-menu" v-if="open">
      <!-- Paso 1: elegir proyecto -->
      <template v-if="step === 'proj'">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="pickProject(p.dir)"
        >
          {{ p.name }}
        </button>
      </template>

      <!-- Paso 2: elegir personaje -->
      <template v-else>
        <button class="ctl spawn-back" :disabled="busy" @click="back">← volver</button>
        <div class="spawn-chars">
          <button
            v-for="c in CHARACTERS"
            :key="c"
            class="spawn-char"
            :disabled="busy"
            :title="c"
            @click="create(c)"
          >
            <img :src="faceFor('', c)" alt="" />
          </button>
          <button class="ctl spawn-auto" :disabled="busy" @click="create()">Auto</button>
        </div>
      </template>

      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.spawn-chars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 6px;
}
.spawn-char {
  background: transparent;
  border: 2px solid #3a3a4a;
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
}
.spawn-char:hover {
  border-color: #e7c14a;
}
.spawn-char img {
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
  display: block;
}
.spawn-auto {
  grid-column: span 4;
}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat/client && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/client/src/components/SpawnMenu.vue
git commit -m "feat(habitat): SpawnMenu wizard para elegir personaje al crear"
```

---

### Task 9: Front — botón cerrar en pod y drawer + render del personaje

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`
- Modify: `habitat/client/src/components/SessionDrawer.vue`

**Interfaces:**
- Consumes: `useProjects()` → `{ canSpawn, kill }`; `heroIdle(name, char)` / `faceFor(name, char)`.
- Comportamiento: × en el pod (al hover, `v-if="canSpawn"`, `@click.stop`) y botón "✕ CERRAR SESIÓN" en el drawer; ambos con `confirm(...)` antes de `kill(id)`. El sprite del héroe/cara usa `session.char`.

- [ ] **Step 1: SessionPod.vue — import, acción y botón**

En `habitat/client/src/components/SessionPod.vue`:

1. Después del import de stores (línea 3), agregar:

```ts
import { useProjects } from '../composables/useProjects'
```

2. Después de `const store = useSessions()` (línea 10), agregar:

```ts
const { canSpawn, kill } = useProjects()
function requestClose() {
  if (confirm(`¿Cerrar la sesión "${props.session.name}"? Se perderá el trabajo en curso.`)) {
    kill(props.session.id)
  }
}
```

3. En el template, dentro de `<div class="pod" ...>`, después de `<div class="badge err">!</div>` (línea 90), agregar:

```html
    <button v-if="canSpawn" class="killx" aria-label="cerrar sesión" @click.stop="requestClose">×</button>
```

4. Cambiar el `:src` del héroe (línea 105) de `:src="heroIdle(session.name)"` a:

```html
        :src="heroIdle(session.name, session.char)"
```

5. En el bloque `<style scoped>`, agregar:

```css
.killx {
  position: absolute;
  top: 6px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: #5a1f1f;
  border: 1px solid #a44;
  color: #f9c;
  font-size: 13px;
  line-height: 16px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 5;
}
.pod:hover .killx,
.pod:focus .killx {
  opacity: 1;
}
```

- [ ] **Step 2: SessionDrawer.vue — import, acción y botón**

En `habitat/client/src/components/SessionDrawer.vue`:

1. Después del import de `useTerminal` (línea 6), agregar:

```ts
import { useProjects } from '../composables/useProjects'
```

2. Después de `const store = useSessions()` (línea 8), agregar:

```ts
const { canSpawn, kill } = useProjects()
function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) {
    kill(s.id)
  }
}
```

3. En el template, cambiar la cara (línea 51) de `:src="faceFor(store.selected.name)"` a:

```html
        <img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" />
```

4. En el template, dentro de `<div class="dmeta">` (después de la línea `<div class="since">...`, línea 62), agregar el botón:

```html
        <button v-if="canSpawn" class="killsession" @click="closeSession">✕ CERRAR SESIÓN</button>
```

5. Agregar al final un bloque de estilo (el componente no tiene `<style scoped>` propio; agregarlo después de `</template>`):

```vue
<style scoped>
.killsession {
  margin-top: 8px;
  background: #5a1f1f;
  border: 1px solid #a44;
  color: #f9c;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.killsession:hover {
  background: #7a2a2a;
}
</style>
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat/client && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/client/src/components/SessionPod.vue habitat/client/src/components/SessionDrawer.vue
git commit -m "feat(habitat): botón cerrar sesión en pod y drawer; render del personaje"
```

---

### Task 10: Build del front + gate final

**Files:**
- Modify (generado): `habitat/web/**` (output del build de Vite)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Build del cliente**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat/client && npm run build`
Expected: PASS (vue-tsc sin errores + vite build escribe en `../web`).

- [ ] **Step 2: Suite completa del server (gate final)**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && npm test`
Expected: PASS (todos los `server/*.test.js`).

- [ ] **Step 3: Smoke manual (opcional pero recomendado)**

Con `HABITAT_ALLOW_SPAWN=1` y `HABITAT_PROJECTS` seteado, levantar el server (`npm start` desde `habitat/`), abrir la GUI y verificar: (a) "+ NUEVA SESIÓN" muestra proyectos → grilla de personajes → crea con el sprite elegido; (b) × en el pod y botón en el drawer cierran la sesión tras confirmar y el pod desaparece.

- [ ] **Step 4: Commit del build**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/web
git commit -m "build(habitat): regenerar bundle del front con cerrar/elegir personaje"
```

---

## Self-Review (hecho)

**Cobertura del spec:**
- F1 killTmuxSession → Task 1. Endpoint /kill (403/400/404/200 + broadcast) → Task 5. Anti-zombie SessionEnd → Task 3. Gate ALLOW_SPAWN → Tasks 4/5 + `canSpawn` en front (Tasks 8/9). Botón pod + drawer + confirmación → Task 9. Canal `remove` ya cableado → consumido sin cambios.
- F2 problema de asociación (pending char) → Tasks 2/3. CHARACTERS canónico + validación /spawn → Task 4. `char` en Session/sprites → Task 6. Wizard → Task 8. Render con char → Task 9.

**Placeholders:** ninguno; todo el código va completo.

**Consistencia de tipos/nombres:** `setPendingChar`/`takePendingChar` (Tasks 2→3→4), `killTmuxSession` (Tasks 1→5), `CHARACTERS` server (Task 4) y client (Task 6), `heroIdle(name, char)`/`faceFor(name, char)` (Tasks 6→8→9), `spawn(dir, char)`/`kill(id)` (Tasks 7→8→9) — alineados.
