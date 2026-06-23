# Pods UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar la UX de los pods del hábitat: `/clear` conserva posición y foco, se pueden reordenar arrastrando (orden compartido por el server), el color del proyecto se ve dentro de la sesión abierta y el pod abierto queda marcado de forma inequívoca.

**Architecture:** El server (Node, `node:http` + `node:test`) es la fuente de verdad del orden de sesiones (`Map` con orden de inserción, ya persistido a disco). El cliente (Vue 3 + Pinia, tests con Vitest) refleja el estado vía un socket WS único y manda mutaciones por endpoints HTTP. El rekey de `/clear` pasa a ser un mensaje WS atómico; el reorden se hace con `vuedraggable` + un endpoint `POST /sessions/order`.

**Tech Stack:** Node 20 (`node:http`, `node:test`), Vue 3.5, Pinia 2, Vitest 2, vuedraggable@next (SortableJS).

## Global Constraints

- Server tests: `cd habitat && node --test server/<archivo>.test.js` (runner `node:test`).
- Client tests: `cd habitat/client && npx vitest run src/<ruta>` (Vitest).
- Client build/typecheck: `cd habitat/client && npm run build` (corre `vue-tsc --noEmit` + `vite build`).
- No usar `!important` en CSS.
- Mensajes WS server→cliente se tipan en `client/src/types.ts` (`ServerMessage`) y se manejan en `client/src/composables/useSocket.ts`.
- Endpoints de escritura pasan por `authorize(req, res)` (token + IP local). El reorden NO requiere `ALLOW_SPAWN` (es no destructivo, igual que `/status`).
- Las claves internas de sesión empiezan con `_` y se filtran con `snapOf`/`stripInternal`.

---

### Task 1: `/clear` conserva posición y foco (mensaje `rekey`)

Hoy `/clear` cambia el `id` del pod y el server emite `session`(id nuevo) + `remove`(id viejo). El front hace `push` al final y pierde el foco. Lo convertimos en un mensaje `rekey` atómico que reemplaza el pod en su lugar y migra la selección.

**Files:**
- Modify: `habitat/server/hooks-logic.js:89`
- Modify: `habitat/server/index.js:83-91`
- Modify: `habitat/server/hooks-logic.test.js` (dos tests de `/clear`)
- Modify: `habitat/client/src/types.ts` (`ServerMessage`)
- Modify: `habitat/client/src/stores/sessions.ts`
- Modify: `habitat/client/src/composables/useSocket.ts`
- Test: `habitat/client/src/stores/sessions.test.ts`

**Interfaces:**
- Produces (server): `applyEvent(...)` en el caso `/clear` devuelve `{ session, fightResult: null, rekey: { from: string, to: string } }` (sin `removed`).
- Produces (WS): `{ type: 'rekey', from: string, to: string, session: Session }`.
- Produces (store): `rekey(from: string, to: string, session: Session): void`.

- [ ] **Step 1: Actualizar los tests de `/clear` en el server para esperar `rekey`**

En `habitat/server/hooks-logic.test.js`, en el test `'/clear reusa el pod (misma tmux), lo rekeyea y recarga stamina; no deja pod caído'` reemplazar la desestructuración y la aserción de `removed`:

```js
  const { session, rekey } = applyEvent(store, {
    session_id: 's2', cwd: '/home/u/api', source: 'clear', hook_event_name: 'SessionStart',
  }, deps(null));

  assert.equal(store.all().length, 1, 'un solo pod, sin caídos');
  assert.equal(store.get('s1'), undefined, 'el id viejo ya no existe');
  assert.deepEqual(rekey, { from: 's1', to: 's2' }, 'rekey atómico: viejo -> nuevo');
  assert.equal(session.id, 's2', 'rekeyeado al nuevo session_id');
```

En el test `'/clear bajo worktree reusa el pod (match por tmux, no por basename)'` hacer el mismo cambio:

```js
  const { session, rekey } = applyEvent(store, {
    session_id: 's2', cwd, source: 'clear', hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: wt });

  assert.equal(store.all().length, 1, 'un solo pod, sin duplicado');
  assert.equal(store.get('s1'), undefined, 'el id viejo ya no existe');
  assert.deepEqual(rekey, { from: 's1', to: 's2' }, 'rekey atómico: viejo -> nuevo');
  assert.equal(session.id, 's2', 'rekeyeado al nuevo session_id');
  assert.equal(session.tmux, 'rpg-feature-x', 'misma tmux');
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: FAIL — `rekey` es `undefined` (todavía se devuelve `removed`).

- [ ] **Step 3: Cambiar el valor de retorno del branch `/clear` en `hooks-logic.js`**

En `habitat/server/hooks-logic.js:89` reemplazar:

```js
      return { session: prev, fightResult: null, removed: oldId };
```

por:

```js
      return { session: prev, fightResult: null, rekey: { from: oldId, to: prev.id } };
```

- [ ] **Step 4: Correr los tests del server y verificar que pasan**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: PASS.

- [ ] **Step 5: Emitir el mensaje `rekey` en `index.js`**

En `habitat/server/index.js`, en el handler de `/hooks` (líneas ~83-91), reemplazar el bloque:

```js
        const { session, fightResult, removed } = applyEvent(store, payload, {
          readUsage, gitBranch, now: () => Date.now(),
          worktreeName: config.WORKTREES_DIR ? (cwd) => worktreeName(config.WORKTREES_DIR, cwd) : () => null,
        });
        if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
        if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
        if (removed) hub.broadcast({ type: 'remove', id: removed }); // pod provisional adoptado por la sesión real
        store.persist(); // respaldo a disco: sobrevive reinicios del server
```

por:

```js
        const { session, fightResult, removed, rekey } = applyEvent(store, payload, {
          readUsage, gitBranch, now: () => Date.now(),
          worktreeName: config.WORKTREES_DIR ? (cwd) => worktreeName(config.WORKTREES_DIR, cwd) : () => null,
        });
        if (rekey) {
          // /clear cambia el id del pod: lo mandamos como rekey atómico para que el front
          // lo reemplace en su lugar y conserve la selección (sin push al final ni perder foco).
          hub.broadcast({ type: 'rekey', from: rekey.from, to: rekey.to, session: snapOf(session) });
        } else {
          if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
          if (removed) hub.broadcast({ type: 'remove', id: removed }); // pod provisional adoptado por la sesión real
        }
        if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
        store.persist(); // respaldo a disco: sobrevive reinicios del server
```

- [ ] **Step 6: Agregar el tipo `rekey` a `ServerMessage`**

En `habitat/client/src/types.ts`, en la unión `ServerMessage` (después de la línea `| { type: 'remove'; id: string }`), agregar:

```ts
  | { type: 'rekey'; from: string; to: string; session: Session }
```

- [ ] **Step 7: Escribir los tests del store para `rekey`**

En `habitat/client/src/stores/sessions.test.ts`, agregar dentro del `describe('sessions store — selección', ...)`:

```ts
  it('rekey conserva la posición del pod y migra la selección', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b'), mk('c')])
    s.select('b')
    s.rekey('b', 'b2', { ...mk('b2'), name: 'b' })
    expect(s.list.map((x) => x.id)).toEqual(['a', 'b2', 'c'])
    expect(s.selectedId).toBe('b2')
  })

  it('rekey de un pod no seleccionado no cambia la selección', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b')])
    s.select('a')
    s.rekey('b', 'b2', mk('b2'))
    expect(s.selectedId).toBe('a')
    expect(s.list.map((x) => x.id)).toEqual(['a', 'b2'])
  })
```

- [ ] **Step 8: Correr los tests del store y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/stores/sessions.test.ts`
Expected: FAIL — `s.rekey is not a function`.

- [ ] **Step 9: Implementar `rekey` en el store**

En `habitat/client/src/stores/sessions.ts`, agregar la función (después de `remove`):

```ts
  // /clear cambia el id del pod (rekey). Lo reemplazamos en su MISMA posición y
  // migramos la selección, para no mandarlo al final ni perder el foco.
  function rekey(from: string, to: string, session: Session) {
    const i = list.value.findIndex((s) => s.id === from)
    if (i === -1) {
      upsert(session)
      return
    }
    list.value[i] = session
    if (selectedId.value === from) selectedId.value = to
  }
```

Y agregar `rekey` al objeto retornado por el store:

```ts
  return { list, selected, selectedId, selectTick, needCount, lastFight, setAll, upsert, remove, rekey, fight, select }
```

- [ ] **Step 10: Correr los tests del store y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/stores/sessions.test.ts`
Expected: PASS.

- [ ] **Step 11: Manejar el mensaje `rekey` en el socket**

En `habitat/client/src/composables/useSocket.ts`, en `ws.onmessage`, agregar después de la línea de `'remove'`:

```ts
    else if (msg.type === 'rekey') store.rekey(msg.from, msg.to, msg.session)
```

- [ ] **Step 12: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK, sin errores de tipos.

- [ ] **Step 13: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/index.js habitat/server/hooks-logic.test.js \
        habitat/client/src/types.ts habitat/client/src/stores/sessions.ts \
        habitat/client/src/stores/sessions.test.ts habitat/client/src/composables/useSocket.ts
git commit -m "feat(habitat): /clear conserva posición y foco del pod (rekey atómico)"
```

---

### Task 2: Marca del pod abierto (barra dorada + prioridad CSS)

El borde dorado de `.pod.selected` queda pisado por las clases de estado (`.working`, etc.) porque vienen después en el CSS. Lo arreglamos por orden de reglas y sumamos una barra dorada lateral como señal de "abierto" independiente del estado, conservando el ring de color de estado.

**Files:**
- Modify: `habitat/client/src/style.css:67-78`

**Interfaces:**
- Produces: ninguna API; cambios puramente visuales sobre la clase `.pod.selected`.

- [ ] **Step 1: Quitar la regla que pisa el ring de estado en selección**

En `habitat/client/src/style.css`, eliminar la línea 68:

```css
  .pod.selected .ring{box-shadow:inset 0 0 0 2px var(--gold)}
```

(El ring debe seguir mostrando el color de estado; la marca de "abierto" será la barra dorada.)

- [ ] **Step 2: Agregar la barra dorada y la prioridad de borde después de las reglas de estado**

En `habitat/client/src/style.css`, justo después de la regla `.pod.offline{...}` (línea ~80), agregar:

```css
  /* Pod abierto: barra dorada lateral (señal inequívoca, independiente del estado) y
     borde dorado que gana sobre el color de estado. El ring sigue mostrando el estado. */
  .pod.selected{border-color:var(--gold)}
  .pod.selected::after{content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
    background:var(--gold); box-shadow:var(--glow-gold); pointer-events:none; z-index:4}
```

- [ ] **Step 3: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK.

- [ ] **Step 4: Verificación visual**

Run: `cd habitat/client && npm run dev` y abrir la app (o usar el server real con sesiones).
Expected: un pod seleccionado muestra barra dorada a la izquierda + borde dorado, incluso cuando su estado es `working`/`waiting` (el ring interno conserva el color de estado teal/coral). Cerrar el dev server al terminar.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/style.css
git commit -m "feat(habitat): marca el pod abierto con barra dorada y borde prioritario"
```

---

### Task 3: Color del proyecto en la sesión abierta (DetailPanel)

El header del `DetailPanel` toma un tinte de fondo con el color del proyecto, reusando el mismo `color-mix` que el pod.

**Files:**
- Modify: `habitat/client/src/components/DetailPanel.vue`
- Modify: `habitat/client/src/style.css` (regla `.dpanel .dhead`)

**Interfaces:**
- Consumes: `colorForProject(name: string): string` de `useProjects` (devuelve `''` si no hay color).

- [ ] **Step 1: Exponer `colorForProject` y computar el tinte en DetailPanel**

En `habitat/client/src/components/DetailPanel.vue`, cambiar la desestructuración de `useProjects`:

```ts
const { canSpawn, kill, colorForProject } = useProjects()
```

Y agregar el computed (después de la línea `const { fit } = useTerminal(termEl, selectedId)`):

```ts
const headTint = computed(() => {
  const c = store.selected ? colorForProject(store.selected.project) : ''
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})
```

`computed` ya está importado de `vue` en este archivo.

- [ ] **Step 2: Aplicar el tinte al header**

En el template de `DetailPanel.vue`, agregar `:style="headTint"` al div del header:

```html
      <div class="dhead crt" :style="headTint">
```

- [ ] **Step 3: Dar al header padding y bordes redondeados para que el tinte lea como banda**

En `habitat/client/src/style.css`, reemplazar la regla de `.dpanel .dhead` (línea ~144):

```css
  .dpanel .dhead{display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap}
```

por:

```css
  .dpanel .dhead{display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap; padding:12px; border-radius:8px}
```

- [ ] **Step 4: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK, sin errores de tipos.

- [ ] **Step 5: Verificación visual**

Run: `cd habitat/client && npm run dev` y seleccionar una sesión de un proyecto con color asignado.
Expected: el header del panel (cara + nombre + estado) tiene un tinte de fondo del color del proyecto, consistente con el pod. Proyectos sin color: header sin tinte. Cerrar el dev server al terminar.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/DetailPanel.vue habitat/client/src/style.css
git commit -m "feat(habitat): el header de la sesión abierta toma el color del proyecto"
```

---

### Task 4: Reorden de sesiones en el server (`reorder` + endpoint)

El server es la fuente de verdad del orden. Agregamos `store.reorder(ids)` (reconstruye el `Map`) y el endpoint `POST /sessions/order` que reordena y difunde.

**Files:**
- Modify: `habitat/server/state.js` (objeto retornado por `createStore`)
- Modify: `habitat/server/index.js` (nueva ruta antes de los estáticos)
- Test: `habitat/server/state.test.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Produces (store): `reorder(ids: string[]): void` — reordena el `Map` según `ids`; las sesiones existentes no mencionadas quedan al final preservando su orden; ids inexistentes se ignoran; persiste.
- Produces (HTTP): `POST /sessions/order` body `{ order: string[] }` → 200; difunde `{ type: 'reorder', order }`.

- [ ] **Step 1: Escribir los tests de `reorder` en state.test.js**

En `habitat/server/state.test.js`, agregar (el archivo ya importa `createStore` y `newSession`; si no, importarlos de `./state.js`):

```js
test('reorder deja el Map en el orden pedido; sobrevivientes al final', () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.upsert(newSession('c'));
  store.reorder(['c', 'a']); // 'b' no mencionado
  assert.deepEqual(store.all().map((s) => s.id), ['c', 'a', 'b']);
});

test('reorder ignora ids inexistentes', () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.reorder(['x', 'b', 'a']);
  assert.deepEqual(store.all().map((s) => s.id), ['b', 'a']);
});
```

Verificar que al tope del archivo estén los imports (`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, `import { createStore, newSession } from './state.js';`); si falta alguno, agregarlo.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/state.test.js`
Expected: FAIL — `store.reorder is not a function`.

- [ ] **Step 3: Implementar `reorder` en el store**

En `habitat/server/state.js`, dentro del objeto retornado por `createStore` (junto a `upsert`, `remove`, etc.), agregar:

```js
    reorder: (ids) => {
      // Reconstruye el Map en el orden pedido. Las sesiones existentes que no estén en
      // `ids` (carrera con un alta reciente) quedan al final. Ids inexistentes se ignoran.
      const next = new Map();
      for (const id of ids) if (map.has(id)) next.set(id, map.get(id));
      for (const [id, s] of map) if (!next.has(id)) next.set(id, s);
      map.clear();
      for (const [id, s] of next) map.set(id, s);
      persist();
    },
```

- [ ] **Step 4: Correr los tests del store y verificar que pasan**

Run: `cd habitat && node --test server/state.test.js`
Expected: PASS.

- [ ] **Step 5: Escribir el test del endpoint en index.test.js**

En `habitat/server/index.test.js`, agregar (usa el `auth`, `config`, `listen` y `WebSocket` ya presentes en el archivo):

```js
test('POST /sessions/order sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: ['a'] }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /sessions/order reordena el store y difunde reorder', async () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.upsert(newSession('c'));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const reorderMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'reorder') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ order: ['c', 'a', 'b'] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(store.all().map((s) => s.id), ['c', 'a', 'b']);
  const m = await reorderMsg;
  assert.deepEqual(m.order, ['c', 'a', 'b']);
  ws.close();
  server.close();
});

test('POST /sessions/order con body inválido -> 400', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ order: 'no-es-array' }),
  });
  assert.equal(res.status, 400);
  server.close();
});
```

Verificar que `newSession` esté importado en `index.test.js` (lo está: `import { createStore, newSession } from './state.js';`).

- [ ] **Step 6: Correr los tests del endpoint y verificar que fallan**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `/sessions/order` no existe (404 en vez de 200/400).

- [ ] **Step 7: Implementar la ruta `POST /sessions/order` en index.js**

En `habitat/server/index.js`, agregar el handler junto a las otras rutas POST (por ejemplo justo después del bloque `POST /kill` y antes del comentario `// estáticos`):

```js
    if (req.method === 'POST' && url.pathname === '/sessions/order') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const order = body && body.order;
      if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) { res.writeHead(400).end(); return; }
      store.reorder(order);
      hub.broadcast({ type: 'reorder', order }); // sincroniza el orden a todos los clientes
      res.writeHead(200).end();
      return;
    }
```

- [ ] **Step 8: Correr los tests del endpoint y verificar que pasan**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add habitat/server/state.js habitat/server/state.test.js habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): orden de sesiones en el server (reorder + POST /sessions/order)"
```

---

### Task 5: Plumbing de reorden en el cliente (tipo + store + socket + POST)

El cliente aplica el reorden localmente y lo persiste vía HTTP; el broadcast sincroniza otras pestañas/dispositivos.

**Files:**
- Modify: `habitat/client/src/types.ts` (`ServerMessage`)
- Modify: `habitat/client/src/stores/sessions.ts`
- Modify: `habitat/client/src/composables/useSocket.ts`
- Create: `habitat/client/src/composables/useSessionOrder.ts`
- Test: `habitat/client/src/stores/sessions.test.ts`

**Interfaces:**
- Consumes (WS): `{ type: 'reorder'; order: string[] }`.
- Produces (store): `reorder(ids: string[]): void` — ordena `list` según `ids`; los pods no mencionados quedan al final preservando su orden; no toca `selectedId`.
- Produces (composable): `postOrder(ids: string[]): Promise<boolean>` desde `useSessionOrder.ts`.

- [ ] **Step 1: Agregar el tipo `reorder` a `ServerMessage`**

En `habitat/client/src/types.ts`, en la unión `ServerMessage` (después del caso `projects`), agregar:

```ts
  | { type: 'reorder'; order: string[] }
```

- [ ] **Step 2: Escribir los tests del store para `reorder`**

En `habitat/client/src/stores/sessions.test.ts`, agregar dentro del `describe`:

```ts
  it('reorder ordena la lista según los ids y no toca la selección', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b'), mk('c')])
    s.select('a')
    s.reorder(['c', 'a', 'b'])
    expect(s.list.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(s.selectedId).toBe('a')
  })

  it('reorder deja los ids no mencionados al final preservando su orden', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b'), mk('c')])
    s.reorder(['c'])
    expect(s.list.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/stores/sessions.test.ts`
Expected: FAIL — `s.reorder is not a function`.

- [ ] **Step 4: Implementar `reorder` en el store**

En `habitat/client/src/stores/sessions.ts`, agregar (después de `rekey`):

```ts
  // Ordena la lista según `ids`. Los pods no mencionados (carrera con un alta) quedan al
  // final preservando su orden relativo. No toca la selección.
  function reorder(ids: string[]) {
    const pos = new Map(ids.map((id, i) => [id, i]))
    const rank = (id: string) => (pos.has(id) ? (pos.get(id) as number) : Number.MAX_SAFE_INTEGER)
    list.value = [...list.value].sort((a, b) => rank(a.id) - rank(b.id))
  }
```

Y agregarlo al objeto retornado:

```ts
  return { list, selected, selectedId, selectTick, needCount, lastFight, setAll, upsert, remove, rekey, reorder, fight, select }
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/stores/sessions.test.ts`
Expected: PASS.

- [ ] **Step 6: Manejar el mensaje `reorder` en el socket**

En `habitat/client/src/composables/useSocket.ts`, en `ws.onmessage`, agregar después de la línea de `'projects'`:

```ts
    else if (msg.type === 'reorder') store.reorder(msg.order)
```

- [ ] **Step 7: Crear el composable `useSessionOrder.ts`**

Crear `habitat/client/src/composables/useSessionOrder.ts`:

```ts
// POST del nuevo orden de sesiones al server. El broadcast WS sincroniza otros clientes.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const jsonHeaders = (): Record<string, string> => {
  const t = token()
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }
}

export async function postOrder(ids: string[]): Promise<boolean> {
  try {
    const res = await fetch('/sessions/order', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ order: ids }),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 8: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK, sin errores de tipos.

- [ ] **Step 9: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/stores/sessions.ts \
        habitat/client/src/stores/sessions.test.ts habitat/client/src/composables/useSocket.ts \
        habitat/client/src/composables/useSessionOrder.ts
git commit -m "feat(habitat): plumbing de reorden en el cliente (reorder + postOrder)"
```

---

### Task 6: Drag de pods con vuedraggable

Integramos `vuedraggable` en `SessionRail` para reordenar arrastrando, con soporte táctil (long-press) y sin romper el tap de selección.

**Files:**
- Modify: `habitat/client/package.json` (dependencia)
- Modify: `habitat/client/src/components/SessionRail.vue`
- Modify: `habitat/client/src/style.css` (clase del fantasma de arrastre)

**Interfaces:**
- Consumes: `postOrder(ids: string[])` de `useSessionOrder.ts`; `store.list`, `store.reorder(ids)` del store.

- [ ] **Step 1: Instalar vuedraggable**

Run:
```bash
cd habitat/client && npm install vuedraggable@next
```
Expected: agrega `vuedraggable` (4.x, compatible Vue 3) a `dependencies` en `package.json`.

- [ ] **Step 2: Reescribir SessionRail.vue con draggable**

Reemplazar el contenido de `habitat/client/src/components/SessionRail.vue` por:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { useSessions } from '../stores/sessions'
import { postOrder } from '../composables/useSessionOrder'
import type { Session } from '../types'
import SessionPod from './SessionPod.vue'

const store = useSessions()

// vuedraggable v-model: al soltar nos entrega el nuevo orden. Lo aplicamos local
// (optimista) y lo persistimos; el broadcast WS sincroniza otros clientes.
const draggableList = computed<Session[]>({
  get: () => store.list,
  set: (val) => {
    const ids = val.map((s) => s.id)
    store.reorder(ids)
    postOrder(ids)
  },
})
</script>

<template>
  <draggable
    class="rail"
    tag="div"
    v-model="draggableList"
    item-key="id"
    :animation="150"
    :delay="200"
    :delay-on-touch-only="true"
    ghost-class="pod-ghost"
  >
    <template #header>
      <div v-if="!store.list.length" class="empty">
        No hay sesiones abiertas.<br />
        Arrancá una con <code>mono &lt;proyecto&gt;</code> en el server.
      </div>
    </template>
    <template #item="{ element }">
      <SessionPod :session="element" />
    </template>
  </draggable>
</template>
```

(`:delay="200"` + `:delay-on-touch-only` exige long-press en touch para no chocar con el scroll; en desktop el drag arranca al mover. Un click sin movimiento sigue disparando la selección del pod.)

- [ ] **Step 3: Agregar el estilo del fantasma de arrastre**

En `habitat/client/src/style.css`, después del bloque de `.pod.selected::after` (Task 2), agregar:

```css
  .pod-ghost{opacity:.4; border-color:var(--gold)}
```

- [ ] **Step 4: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build OK, sin errores de tipos (vuedraggable trae tipos; si `vue-tsc` se queja del import, verificar que `vuedraggable@next` quedó instalado).

- [ ] **Step 5: Verificación visual (desktop)**

Run: `cd habitat/client && npm run dev` (o el server real con ≥2 sesiones).
Expected:
- Arrastrar un pod lo reordena con animación; al soltar el orden persiste (recargar la página lo conserva).
- Un click simple sobre un pod sigue seleccionándolo (no se dispara drag).
- El pod abierto conserva su barra dorada tras reordenar.
Cerrar el dev server al terminar.

- [ ] **Step 6: Verificación visual (táctil)**

En un dispositivo/emulador táctil (o DevTools device mode): un toque corto selecciona; un long-press (~200ms) inicia el arrastre y permite reordenar sin que la lista scrollee.
Expected: ambos gestos funcionan sin conflicto.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/package.json habitat/client/package-lock.json \
        habitat/client/src/components/SessionRail.vue habitat/client/src/style.css
git commit -m "feat(habitat): reordenar pods arrastrando (vuedraggable, desktop + táctil)"
```

---

## Notas de verificación final

Tras todas las tasks, correr la suite completa:

- Server: `cd habitat && npm test`
- Cliente: `cd habitat/client && npm run test && npm run build`

Expected: todo verde.
