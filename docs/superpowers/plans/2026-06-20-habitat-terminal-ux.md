# Hábitat — Terminal real + UX del drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el preview de solo-lectura por una terminal real interactiva (xterm.js + node-pty/tmux), limpiar la tipografía, hacer el drawer redimensionable y mostrar siempre un monstruo cuando el agente trabaja.

**Architecture:** El server abre un WebSocket `/term` que spawnea un PTY corriendo `tmux attach-session` contra la sesión y hace de puente bidireccional (stdout→WS, WS→stdin, resize). El cliente monta xterm.js en el drawer sobre ese WS — los colores ANSI y la navegación por teclado son nativos. La lógica de monstruos vive en `hooks-logic.js` (server, testeable con `node --test`).

**Tech Stack:** Node 18+ (ESM), `ws`, `node-pty` (server); Vue 3 + Vite, `@xterm/xterm` + `@xterm/addon-fit` (cliente); tmux.

## Global Constraints

- ESM en todo el server (`"type": "module"`). Imports con extensión `.js`.
- Las rutas HTTP nuevas se gatean con `config.TOKEN` (query `?token=` o header `Authorization: Bearer`) + check de loopback (`authorize()`). Las rutas WS (`/ws`, `/term`) validan SOLO token, no loopback — `/ws` se dejó así a propósito para acceso remoto por VPN; el bind default es `127.0.0.1`.
- Inyección de dependencias para lo no-determinístico (igual que `exec` en `tmux.js` y `readUsage`/`now` en `hooks-logic.js`): el módulo de terminal recibe un factory `spawnPty` para poder testear con un PTY falso.
- Tests con `node --test` (server). Cliente: verificación corriendo la app.
- Commits frecuentes, uno por tarea.
- El build del cliente sale a `../web` (`vite build`); el server sirve `web/`.

---

### Task 1: Monstruo genérico al trabajar (#4)

Lógica pura en el server. Hoy `s.monster` solo se setea desde todos (`monsterFromTodos`); trabajando sin todos queda `null` y no se ve nada. Asignar un monstruo genérico estable cuando la sesión pasa a `working` sin monstruo, y limpiarlo al terminar.

**Files:**
- Modify: `habitat/server/hooks-logic.js`
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: `hashType(text)` de `state.js` (ya existe; firma `(string) => string`).
- Produces: comportamiento observable en `applyEvent` — tras un evento que deja `status==='working'`, `session.monster` nunca es `null`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `habitat/server/hooks-logic.test.js`:

```javascript
test('working sin todos asigna monstruo genérico estable', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  assert.ok(r.session.monster, 'debe haber monstruo al trabajar');
  assert.equal(r.session.monster.isBoss, false);
  const t1 = r.session.monster.type;
  const r2 = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' }, deps(null));
  assert.equal(r2.session.monster.type, t1, 'el type del genérico es estable entre golpes');
});

test('UserPromptSubmit ya muestra monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.ok(r.session.monster);
});

test('los todos tienen prioridad sobre el monstruo genérico', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null)); // genérico
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'arreglar auth', status: 'in_progress' }] } }, deps(null));
  assert.equal(r.session.monster.label, 'arreglar auth');
});

test('Stop a idle y SessionEnd limpian el monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.session.monster, null);
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd' }, deps(null));
  assert.equal(r.session.monster, null);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: FAIL — los 4 nuevos fallan (`monster` es `null`).

- [ ] **Step 3: Implementar**

En `habitat/server/hooks-logic.js`, cambiar el import de la línea 2:

```javascript
import { newSession, questFromTodos, monsterFromTodos, hashType } from './state.js';
```

Agregar el helper (después de `setStatus`, ~línea 25):

```javascript
function ensureMonster(s) {
  if (!s.monster) {
    s.monster = { type: hashType(s.name || s.id), isBoss: false, label: s.action || 'trabajando' };
  }
}
```

En el case `UserPromptSubmit` (después de `recomputeStamina();`):

```javascript
      ensureMonster(s);
```

En el case `Stop`, después del `setStatus(...)`:

```javascript
      s.monster = null;
```

En el case `SessionEnd`, después del `setStatus(...)`:

```javascript
      s.monster = null;
```

En `handleHit`, reemplazar la línea `if (!s.monster) return;` por:

```javascript
  ensureMonster(s);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: PASS — todos los tests (viejos y nuevos) pasan.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): monstruo genérico estable cuando el agente trabaja sin todos"
```

---

### Task 2: Server — puente PTY `/term` (#2 + #5, server side)

WebSocket `/term?id=<id>` que spawnea un PTY con `tmux attach-session` y hace de puente: stdout del PTY → cliente, input binario del cliente → PTY, mensaje JSON `{type:'resize'}` → `pty.resize`. PTY inyectable para tests.

**Files:**
- Create: `habitat/server/term.js`
- Test: `habitat/server/term.test.js`
- Modify: `habitat/server/index.js`
- Modify: `habitat/package.json` (+ `node-pty`)

**Interfaces:**
- Consumes: `store.get(id)` → sesión con `.name`/`.tmux`; `config.TOKEN`.
- Produces:
  - `attachTerm(httpServer, store, { token, spawnPty }) => { close() }` — registra un `WebSocketServer` en path `/term`.
  - `spawnPty(target, { cols, rows }) => { onData(cb), onExit(cb), write(data), resize(cols,rows), kill() }` — factory inyectable; default usa node-pty + tmux.
  - Protocolo WS: cliente manda **binario** (keystrokes) → `pty.write`; cliente manda **texto JSON** `{type:'resize',cols,rows}` → `pty.resize`. Server manda los datos del PTY como texto al cliente.

- [ ] **Step 1: Instalar node-pty**

Run: `cd habitat && npm install node-pty`
Expected: se agrega a `dependencies` en `package.json` y compila el binding nativo. Si falla la compilación, instalar toolchain (`build-essential`, `python3`) y reintentar.

- [ ] **Step 2: Escribir el test que falla**

Create `habitat/server/term.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachTerm } from './term.js';

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

// PTY falso: registra writes/resizes y permite empujar data hacia el cliente.
function fakePtyFactory(log) {
  return (target, opts) => {
    log.target = target;
    log.opts = opts;
    let onData = () => {};
    log.push = (s) => onData(s);
    return {
      onData: (cb) => { onData = cb; },
      onExit: () => {},
      write: (d) => log.writes.push(d),
      resize: (c, r) => log.resizes.push([c, r]),
      kill: () => { log.killed = true; },
    };
  };
}

test('attachTerm: stdout del pty llega al cliente; input binario va a write; resize va a resize', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const log = { writes: [], resizes: [] };
  const hub = attachTerm(server, store, { token: '', spawnPty: fakePtyFactory(log) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1`);
  await new Promise((r) => ws.once('open', r));
  assert.equal(log.target, 'api'); // attacheó a la sesión por nombre

  // pty -> cliente
  const got = new Promise((r) => ws.once('message', (d) => r(d.toString())));
  log.push('hola\r\n');
  assert.equal(await got, 'hola\r\n');

  // cliente (binario) -> pty.write
  ws.send(Buffer.from('ls\r'));
  // cliente (texto json) -> pty.resize
  ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(log.writes.join(''), 'ls\r');
  assert.deepEqual(log.resizes, [[80, 24]]);

  ws.close(); hub.close(); server.close();
});

test('attachTerm: token inválido cierra con 1008', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const hub = attachTerm(server, store, { token: 'secret', spawnPty: fakePtyFactory({ writes: [], resizes: [] }) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1&token=wrong`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});

test('attachTerm: id desconocido cierra con 1008', async () => {
  const store = createStore();
  const server = createServer();
  const hub = attachTerm(server, store, { token: '', spawnPty: fakePtyFactory({ writes: [], resizes: [] }) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=nope`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/term.test.js`
Expected: FAIL — `Cannot find module './term.js'`.

- [ ] **Step 4: Implementar `term.js`**

Create `habitat/server/term.js` con este contenido completo:

```javascript
import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Factory por defecto: PTY real que attachea a la sesión tmux por nombre.
// window-size=latest hace que la ventana tome el tamaño del último cliente activo,
// para no encoger la terminal real del usuario de forma permanente.
function defaultSpawnPty(target, { cols, rows }) {
  // import perezoso: node-pty es binario nativo; sólo se carga al usar la terminal real.
  const pty = require('node-pty');
  return pty.spawn('tmux', ['attach-session', '-t', target], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    env: process.env,
  });
}

export function attachTerm(httpServer, store, { token, spawnPty = defaultSpawnPty } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/term' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    if (token) {
      const q = url.searchParams.get('token');
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (q !== token && hdr !== token) { ws.close(1008, 'unauthorized'); return; }
    }
    const s = store.get(url.searchParams.get('id'));
    if (!s) { ws.close(1008, 'unknown session'); return; }

    const target = s.tmux || s.name;
    let pty;
    try {
      pty = spawnPty(target, { cols: 80, rows: 24 });
    } catch {
      ws.close(1011, 'pty failed');
      return;
    }

    pty.onData((d) => { if (ws.readyState === 1) ws.send(d); });
    if (pty.onExit) pty.onExit(() => { if (ws.readyState === 1) ws.close(); });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { pty.write(data); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg && msg.type === 'resize') pty.resize(msg.cols, msg.rows);
    });

    ws.on('close', () => { try { pty.kill(); } catch {} });
  });

  return {
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
```

Nota: `require` no existe en ESM nativo; por eso el `createRequire(import.meta.url)` al inicio del archivo. Carga `node-pty` perezosamente dentro de `defaultSpawnPty` para que los tests (que inyectan `spawnPty`) no necesiten el binario nativo.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd habitat && node --test server/term.test.js`
Expected: PASS — los 3 tests pasan (usan el PTY falso, no node-pty real).

- [ ] **Step 6: Wirear `/term` en `index.js`**

En `habitat/server/index.js`:

Agregar el import (junto a `attachWs`):

```javascript
import { attachTerm } from './term.js';
```

Dentro de `createApp`, después de `hub = attachWs(...)` (antes del `return`):

```javascript
  attachTerm(server, store, { token: config.TOKEN });
```

- [ ] **Step 7: Correr toda la suite del server**

Run: `cd habitat && npm test`
Expected: PASS — toda la suite verde.

- [ ] **Step 8: Commit**

```bash
git add habitat/server/term.js habitat/server/term.test.js habitat/server/index.js habitat/package.json habitat/package-lock.json
git commit -m "feat(habitat): WebSocket /term — puente PTY (tmux attach) para terminal real"
```

---

### Task 3: Cliente — terminal xterm en el drawer (#2 + #5, client side)

Montar xterm.js sobre el WS `/term`, reemplazando el `<pre>` de preview y eliminando ChatPanel/usePreview.

**Files:**
- Modify: `habitat/client/package.json` (+ `@xterm/xterm`, `@xterm/addon-fit`)
- Create: `habitat/client/src/composables/useTerminal.ts`
- Modify: `habitat/client/src/components/SessionDrawer.vue`
- Modify: `habitat/client/vite.config.ts` (proxy de `/term`)
- Delete: `habitat/client/src/components/ChatPanel.vue`, `habitat/client/src/composables/usePreview.ts`

**Interfaces:**
- Consumes: WS `/term?id=&token=` de Task 2 (binario=keystrokes, JSON `{type:'resize'}`).
- Produces: `useTerminal(container: Ref<HTMLElement|null>, id: Ref<string|null>) => { fit(): void }` — crea/destruye la terminal al cambiar `id`, expone `fit()` para reajustar (lo usa Task 4).

- [ ] **Step 1: Instalar deps del cliente**

Run: `cd habitat/client && npm install @xterm/xterm @xterm/addon-fit`
Expected: ambas en `dependencies`.

- [ ] **Step 2: Crear el composable `useTerminal.ts`**

Create `habitat/client/src/composables/useTerminal.ts`:

```typescript
import { watch, onUnmounted, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const enc = new TextEncoder()

// Monta una terminal xterm sobre el WS /term mientras `id` esté seteado.
export function useTerminal(container: Ref<HTMLElement | null>, id: Ref<string | null | undefined>) {
  let term: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null

  function teardown() {
    if (ws) { ws.close(); ws = null }
    if (term) { term.dispose(); term = null }
    fitAddon = null
  }

  function sendResize() {
    if (ws && ws.readyState === 1 && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }

  function fit() {
    if (fitAddon) { fitAddon.fit(); sendResize() }
  }

  function setup(sessionId: string) {
    const el = container.value
    if (!el) return
    term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      theme: { background: '#160e07' },
      cursorBlink: true,
    })
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()

    const tok = token()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/term?id=${encodeURIComponent(sessionId)}${tok ? `&token=${tok}` : ''}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => sendResize()
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') term?.write(e.data)
      else term?.write(new Uint8Array(e.data))
    }
    term.onData((d) => { if (ws && ws.readyState === 1) ws.send(enc.encode(d)) })
  }

  watch(
    id,
    (cur) => {
      teardown()
      if (cur) {
        // esperar a que el contenedor exista en el DOM
        requestAnimationFrame(() => cur && setup(cur))
      }
    },
    { immediate: true },
  )

  onUnmounted(teardown)
  return { fit }
}
```

- [ ] **Step 3: Reescribir `SessionDrawer.vue` (sin ChatPanel, con xterm)**

Modify `habitat/client/src/components/SessionDrawer.vue` — reemplazar `<script setup>` y `<template>`:

```vue
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL } from '../types'
import { faceFor, ago } from '../sprites'
import { useTerminal } from '../composables/useTerminal'

const store = useSessions()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit } = useTerminal(termEl, selectedId)

function close() {
  store.select(null)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !store.selected) return
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
defineExpose({ fit })
</script>

<template>
  <div class="scrim" :class="{ open: store.selected }" @click="close"></div>
  <aside class="drawer" :class="{ open: store.selected }" :aria-hidden="!store.selected">
    <template v-if="store.selected">
      <div class="dhead">
        <img class="face" :src="faceFor(store.selected.name)" alt="" />
        <div class="dinfo">
          <div class="dname">
            {{ store.selected.name }}
            <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span>
          </div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
        </div>
        <button class="closex" aria-label="cerrar" @click="close">×</button>
      </div>
      <div class="dmeta">
        <div class="action">{{ store.selected.action }}</div>
        <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
      </div>
      <div ref="termEl" class="term" aria-label="terminal de la sesión"></div>
    </template>
  </aside>
</template>
```

Nota: el Escape ahora cierra el drawer sólo si la terminal no captura la tecla — para no romper los menús de Claude (que usan Esc). Mantener el botón × como cierre confiable. (El handler `onKey` quedó intencionalmente sin cerrar en Escape; el cierre es por × o click en el scrim.)

- [ ] **Step 4: Borrar archivos obsoletos**

Run:
```bash
rm habitat/client/src/components/ChatPanel.vue habitat/client/src/composables/usePreview.ts
```

- [ ] **Step 5: Proxy de `/term` en dev**

Modify `habitat/client/vite.config.ts` — en `server.proxy` agregar (y quitar `/preview` que ya no se usa):

```typescript
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8377', ws: true },
      '/term': { target: 'ws://127.0.0.1:8377', ws: true },
    },
```

- [ ] **Step 6: Build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK, sin referencias colgadas a `ChatPanel`/`usePreview`. Si TypeScript se queja de imports muertos, removerlos.

- [ ] **Step 7: Verificar a mano (terminal real)**

Run (dos terminales):
```bash
# 1) backend
cd habitat && npm start
# 2) crear/usar una sesión tmux con claude corriendo, abrir el navegador en la URL que imprime el server
```
Verificar:
- El drawer muestra una terminal con **colores** (no texto plano).
- Tecleás y aparece en la sesión; las **flechas** navegan un menú de Claude y **Enter** selecciona.
- Cerrar/reabrir el drawer no duplica terminales.

- [ ] **Step 8: Commit**

```bash
git add habitat/client/package.json habitat/client/package-lock.json habitat/client/src/composables/useTerminal.ts habitat/client/src/components/SessionDrawer.vue habitat/client/vite.config.ts
git rm habitat/client/src/components/ChatPanel.vue habitat/client/src/composables/usePreview.ts
git commit -m "feat(habitat): terminal real con xterm.js en el drawer (colores + interactiva)"
```

---

### Task 4: Resize lateral del drawer (#3)

Handle de drag en el borde izquierdo; ancho persistido en `localStorage`; `fit()` de la terminal al cambiar ancho.

**Files:**
- Modify: `habitat/client/src/components/SessionDrawer.vue`
- Modify: `habitat/client/src/style.css`

**Interfaces:**
- Consumes: `fit()` expuesto por `useTerminal` (Task 3).
- Produces: ancho del drawer controlado por `style` inline + clave `localStorage` `habitat.drawerWidth`.

- [ ] **Step 1: Estado de ancho + drag en `SessionDrawer.vue`**

En `<script setup>` de `SessionDrawer.vue`, agregar tras `const { fit } = useTerminal(...)`:

```typescript
const MIN_W = 380
const MAX_W = 1400
const width = ref(Number(localStorage.getItem('habitat.drawerWidth')) || 720)

function startResize(e: MouseEvent) {
  e.preventDefault()
  const onMove = (m: MouseEvent) => {
    const w = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - m.clientX))
    width.value = w
    fit()
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem('habitat.drawerWidth', String(width.value))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
```

- [ ] **Step 2: Aplicar ancho + handle en el `<template>`**

En `SessionDrawer.vue`, cambiar la línea del `<aside>` para bindear el ancho y agregar el handle como primer hijo dentro del `<aside>`:

```vue
  <aside class="drawer" :class="{ open: store.selected }" :aria-hidden="!store.selected" :style="{ width: width + 'px' }">
    <div class="dragx" @mousedown="startResize"></div>
    <template v-if="store.selected">
```

- [ ] **Step 3: Estilos del handle y ajuste del drawer en `style.css`**

En `habitat/client/src/style.css`, en la regla `.drawer` quitar el `width:clamp(...)` (ahora lo fija el `:style` inline) y agregar:

```css
  .drawer{position:fixed; top:0; right:0; height:100%; background:#1a1428; border-left:3px solid var(--line);
    transform:translateX(100%); transition:transform .2s steps(6); z-index:21; display:flex; flex-direction:column; padding:32px}
  .drawer.open{transform:none}
  .dragx{position:absolute; left:0; top:0; width:8px; height:100%; cursor:ew-resize; z-index:22;
    background:linear-gradient(90deg, rgba(201,143,46,.35), transparent)}
  .dragx:hover{background:linear-gradient(90deg, rgba(201,143,46,.6), transparent)}
```

(Asegurar que el `.term` use el espacio: ya tiene `flex:1; overflow:auto`. Agregar `min-height:0` para que flexbox no lo desborde:)

```css
  .term{margin-top:18px; background:#160e07; border:2px solid var(--line); box-shadow:var(--bevel);
    padding:8px; flex:1; min-height:0; overflow:hidden}
```

- [ ] **Step 4: Build**

Run: `cd habitat/client && npm run build`
Expected: build OK.

- [ ] **Step 5: Verificar a mano**

Arrastrar el borde izquierdo del drawer: el ancho cambia, la terminal **reflowea** (cols/rows se ajustan), y al recargar la página el ancho se conserva.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/SessionDrawer.vue habitat/client/src/style.css
git commit -m "feat(habitat): drawer redimensionable lateral con persistencia + refit de la terminal"
```

---

### Task 5: Tipografía limpia (#1)

Quitar el pixel font; una familia legible del sistema en toda la app.

**Files:**
- Modify: `habitat/client/src/style.css`

**Interfaces:**
- Ninguna nueva. Cambios sólo de presentación.

- [ ] **Step 1: Reemplazar el `@font-face` y las vars de fuente**

En `habitat/client/src/style.css`, borrar el bloque `@font-face{ font-family:'NinjaAdventure'; ... }` (líneas ~2-6) y cambiar las tres vars de fuente en `:root`:

```css
    --f-logo:'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
    --f-ui:'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
    --f-body:'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
```

- [ ] **Step 2: Quitar el parche de word-spacing**

En la regla `body`, quitar `word-spacing:5px;` (era compensación del pixel font). Dejar `letter-spacing` en `normal` o un valor chico:

```css
  body{
    font-family:var(--f-body); color:var(--ink); font-size:15px;
    letter-spacing:0;
```

- [ ] **Step 3: Reajustar tamaños inflados**

Los tamaños chicos en `px` que existían para compensar el pixel font ahora se ven minúsculos con un sans real. Subir los micro-tamaños a valores legibles en estas reglas (buscar y ajustar):
- `.brand b` `font-size:13px` → `16px`
- `.brand small`, `.demo-badge`, `.count`, `button.ctl`, `.chip`, `.since`, `footer` que estén en `7-11px` → subir a `11-13px` (mínimo legible).
- `.pcount`, `.pdmg`, `.ploot .ttl`, `.bloot .ttl`, `.hpwrap`, `.hpval` (overlays de combate) → mínimo `11px`.

Criterio: ningún texto por debajo de `11px`. Mantener la jerarquía (títulos > cuerpo > metadatos).

- [ ] **Step 4: Build**

Run: `cd habitat/client && npm run build`
Expected: build OK.

- [ ] **Step 5: Verificar a mano**

Abrir la app: todos los textos se leen con claridad (pods, header, chips, drawer). No hay glifos pixelados cortados. La terminal mantiene su monospace.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/style.css
git commit -m "style(habitat): tipografía legible (sans del sistema) — saca el pixel font"
```

---

## Notas de integración / riesgos

- **node-pty nativo:** si `npm install node-pty` falla, instalar toolchain (`build-essential`, `python3`) antes de continuar la Task 2. Es prerequisito real, no opcional.
- **Sizing tmux:** el default usa `window-size=latest` implícito de tmux moderno; si la terminal real del usuario se encoge al abrir la web, evaluar `tmux set -g window-size latest` o attachear a una sesión agrupada (`new-session -t`). Ajuste menor en `defaultSpawnPty`.
- **Tras la Task 3, `/preview`, `capturePane` y `sendKeys` quedan sin consumidores** desde el front. No se eliminan en este plan (otros usos/tests dependen de ellos); limpieza opcional fuera de alcance.
```
