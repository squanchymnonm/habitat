# Quest Book por sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un Quest Book por sesión (libro RPG overlay) que registra de forma acumulativa las quests/tasks (completas y pendientes), su contexto (prompt de origen, resumen de Claude, monstruo vencido + daño) y una línea de tiempo de eventos importantes.

**Architecture:** Lógica pura de acumulación/derivación en un módulo nuevo `questbook.js`; captura enganchada en `hooks-logic.js`; el libro vive como campo interno `_questbook` en la sesión (excluido del broadcast WS por `stripInternal`, persistido por `serializeSession`) y se sirve a pedido por `GET /questbook`. El cliente lo pide al abrir un libro overlay (`QuestBook.vue`) desde `DetailPanel.vue`, con assets ninja copiados a `public/assets/ui/`.

**Tech Stack:** Node.js ESM (server, tests con `node --test`), Vue 3 + TypeScript (cliente, tests con vitest). Server tests desde `habitat/`; client tests desde `habitat/client/`.

## Global Constraints

- `_questbook` es campo **interno** (prefijo `_`): NO debe difundirse por WS ni aparecer en el snapshot (lo excluye `stripInternal`/`snapOf`), pero SÍ se persiste (`serializeSession` copia todos los campos).
- Truncados: `synopsis` y `originPrompt` y labels de evento ≤ 200 chars; `claudeSummary` ≤ 400 chars. Cap de `events`: 50 más recientes.
- `quest = task individual`; el libro es **acumulativo**: nunca se borra una quest aunque salga del plan actual.
- Identidad de una quest = `content` del todo (campo `id`).
- No cambiar `quest: { total, done }` ni la lógica de combate/orbe/"dungeon cleared" existente.
- El resumen de Claude se obtiene de `transcript_path`; ante cualquier fallo de lectura → `''` (degradación silenciosa, nunca tira).
- Assets: copiar los PNG a `habitat/client/public/assets/ui/` (commiteados) y registrarlos en `habitat/scripts/import-assets.sh`. La UI los referencia desde `assets/ui/…`.
- El libro solo se muestra en el panel de detalle (no en rail/cards).

---

### Task 1: Módulo puro `questbook.js`

**Files:**
- Create: `habitat/server/questbook.js`
- Test: `habitat/server/questbook.test.js`

**Interfaces:**
- Produces:
  - `emptyBook(): { synopsis: '', quests: [], events: [] }`
  - `setSynopsis(book, prompt): void` — fija `synopsis` solo si está vacío (trunc 200).
  - `upsertQuests(book, todos, ctx): void` — `ctx = { originPrompt, now }`. Por cada todo `{content, status}`: si no hay quest con `id === content`, la agrega; si existe, solo actualiza `status`. Nunca borra.
  - `setClaudeSummary(book, questId, text): void` — setea `claudeSummary` (trunc 400) si está vacío.
  - `completeQuest(book, questId, { monster, damage, hits }): void` — `status='completed'` + estampa monster/damage/hits.
  - `pushEvent(book, event): void` — agrega `{type,label,detail,ts}` y recorta a 50.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `habitat/server/questbook.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent } from './questbook.js';

test('emptyBook devuelve la forma vacía', () => {
  assert.deepEqual(emptyBook(), { synopsis: '', quests: [], events: [] });
});

test('setSynopsis fija una sola vez y trunca a 200', () => {
  const b = emptyBook();
  setSynopsis(b, 'objetivo original');
  setSynopsis(b, 'otro prompt');
  assert.equal(b.synopsis, 'objetivo original');
  const b2 = emptyBook();
  setSynopsis(b2, 'x'.repeat(300));
  assert.equal(b2.synopsis.length, 200);
});

test('upsertQuests agrega nuevas con contexto y no duplica', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'pending' }], { originPrompt: 'P', now: 5 });
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { originPrompt: 'OTRO', now: 9 });
  assert.equal(b.quests.length, 1);
  assert.equal(b.quests[0].id, 'a');
  assert.equal(b.quests[0].title, 'a');
  assert.equal(b.quests[0].status, 'in_progress'); // actualizó estado
  assert.equal(b.quests[0].originPrompt, 'P');      // no pisa el contexto original
  assert.equal(b.quests[0].since, 5);
});

test('upsertQuests no borra quests que salen del plan (acumulativo)', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'completed' }], { now: 1 });
  upsertQuests(b, [{ content: 'b', status: 'pending' }], { now: 2 }); // plan reescrito sin 'a'
  assert.deepEqual(b.quests.map((q) => q.id), ['a', 'b']);
  assert.equal(b.quests[0].status, 'completed');
});

test('setClaudeSummary trunca a 400 y no pisa', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { now: 1 });
  setClaudeSummary(b, 'a', 'y'.repeat(500));
  assert.equal(b.quests[0].claudeSummary.length, 400);
  setClaudeSummary(b, 'a', 'nuevo');
  assert.equal(b.quests[0].claudeSummary.length, 400); // no pisó
});

test('completeQuest estampa estado + monstruo + daño', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { now: 1 });
  completeQuest(b, 'a', { monster: 'a', damage: 1234, hits: 7 });
  assert.equal(b.quests[0].status, 'completed');
  assert.equal(b.quests[0].monster, 'a');
  assert.equal(b.quests[0].damage, 1234);
  assert.equal(b.quests[0].hits, 7);
});

test('pushEvent agrega y respeta el cap de 50', () => {
  const b = emptyBook();
  for (let i = 0; i < 55; i++) pushEvent(b, { type: 'error', label: `e${i}`, ts: i });
  assert.equal(b.events.length, 50);
  assert.equal(b.events[0].label, 'e5');   // se descartaron los 5 más viejos
  assert.equal(b.events[49].label, 'e54');
  assert.equal(b.events[0].detail, '');    // default
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/questbook.test.js`
Expected: FAIL — `./questbook.js` no existe.

- [ ] **Step 3: Implementar `questbook.js`**

Crear `habitat/server/questbook.js`:

```js
// Lógica pura del Quest Book: acumula quests desde los todos y arma la línea de
// tiempo de eventos. Sin I/O ni imports del server: testeable en aislamiento.

const SYNOPSIS_MAX = 200;
const SUMMARY_MAX = 400;
const EVENTS_MAX = 50;

export function emptyBook() {
  return { synopsis: '', quests: [], events: [] };
}

export function setSynopsis(book, prompt) {
  if (book.synopsis) return; // solo la primera vez
  book.synopsis = String(prompt || '').slice(0, SYNOPSIS_MAX);
}

export function upsertQuests(book, todos, ctx = {}) {
  const { originPrompt = '', now = 0 } = ctx;
  for (const t of todos || []) {
    const id = t && t.content;
    if (!id) continue;
    const existing = book.quests.find((q) => q.id === id);
    if (existing) {
      if (t.status) existing.status = t.status;
    } else {
      book.quests.push({
        id,
        title: id,
        status: t.status || 'pending',
        originPrompt: String(originPrompt || '').slice(0, SYNOPSIS_MAX),
        claudeSummary: '',
        monster: null,
        damage: 0,
        hits: 0,
        since: now,
      });
    }
  }
}

export function setClaudeSummary(book, questId, text) {
  const q = book.quests.find((x) => x.id === questId);
  if (!q || q.claudeSummary) return; // no pisa
  q.claudeSummary = String(text || '').slice(0, SUMMARY_MAX);
}

export function completeQuest(book, questId, { monster = null, damage = 0, hits = 0 } = {}) {
  const q = book.quests.find((x) => x.id === questId);
  if (!q) return;
  q.status = 'completed';
  q.monster = monster;
  q.damage = damage;
  q.hits = hits;
}

export function pushEvent(book, event) {
  book.events.push({
    type: event.type,
    label: String(event.label || '').slice(0, SYNOPSIS_MAX),
    detail: String(event.detail || '').slice(0, SYNOPSIS_MAX),
    ts: event.ts || 0,
  });
  if (book.events.length > EVENTS_MAX) book.events = book.events.slice(-EVENTS_MAX);
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/questbook.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/questbook.js habitat/server/questbook.test.js
git commit -m "feat(habitat): módulo puro questbook.js (acumulación + eventos)"
```

---

### Task 2: `readLastAssistantText` en `transcript.js`

**Files:**
- Modify: `habitat/server/transcript.js` (agregar función)
- Test: `habitat/server/transcript.test.js` (crear o ampliar)

**Interfaces:**
- Produces: `readLastAssistantText(transcriptPath): string` — lee el JSONL, devuelve el texto del **último** mensaje de rol `assistant` (concatenando sus bloques `{type:'text'}`), truncado a 400. Si el archivo no existe/está vacío/sin texto → `''`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `habitat/server/transcript.test.js` (si ya existe, agregar estos tests al final, reutilizando los imports):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLastAssistantText } from './transcript.js';

function fixture(lines) {
  const p = join(tmpdir(), `qb-transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
  return p;
}

test('readLastAssistantText devuelve el último texto de asistente', () => {
  const p = fixture([
    { type: 'user', message: { content: [{ type: 'text', text: 'hola' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'primer plan' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'segundo plan' }, { type: 'tool_use', name: 'X' }] } },
  ]);
  assert.equal(readLastAssistantText(p), 'segundo plan');
  rmSync(p);
});

test('readLastAssistantText trunca a 400', () => {
  const p = fixture([{ type: 'assistant', message: { content: [{ type: 'text', text: 'z'.repeat(500) }] } }]);
  assert.equal(readLastAssistantText(p).length, 400);
  rmSync(p);
});

test('readLastAssistantText devuelve "" si no hay texto de asistente', () => {
  const p = fixture([{ type: 'user', message: { content: [{ type: 'text', text: 'solo user' }] } }]);
  assert.equal(readLastAssistantText(p), '');
  rmSync(p);
});

test('readLastAssistantText devuelve "" si el archivo no existe', () => {
  assert.equal(readLastAssistantText('/no/existe/transcript.jsonl'), '');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: FAIL — `readLastAssistantText` no está exportada.

- [ ] **Step 3: Implementar `readLastAssistantText`**

Agregar al final de `habitat/server/transcript.js` (mantener el `import { readFileSync } from 'node:fs'` existente al tope; ya está):

```js
// Último texto del asistente en el transcript (para el "resumen de Claude" del
// Quest Book). Concatena los bloques de texto del último mensaje assistant.
// Trunca a 400. Cualquier fallo de lectura/parseo => '' (nunca tira).
export function readLastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  let last = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => b && b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) last = text;
  }
  return last.slice(0, 400);
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: PASS (4 tests nuevos; si el archivo ya tenía tests de `readUsage`, también deben seguir pasando).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/transcript.js habitat/server/transcript.test.js
git commit -m "feat(habitat): readLastAssistantText para el resumen de Claude"
```

---

### Task 3: Captura en `hooks-logic.js`

**Files:**
- Modify: `habitat/server/hooks-logic.js`
- Modify: `habitat/server/index.js` (inyectar `readLastAssistantText` en `deps`)
- Test: `habitat/server/questbook-capture.test.js` (crear)

**Interfaces:**
- Consumes: `emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent` de `./questbook.js`; `readLastAssistantText` vía `deps.readLastAssistantText`.
- Produces: cada sesión gana `s._questbook` (forma de `emptyBook()`) y `s._currentPrompt` (string), poblados por los eventos de hooks.

- [ ] **Step 1: Escribir el test de integración que falla**

Crear `habitat/server/questbook-capture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = {
  readUsage: () => null,
  readLastAssistantText: () => 'resumen de claude',
  gitBranch: () => '',
  now: () => 1000,
  worktreeName: () => null,
};

function ev(store, payload) { return applyEvent(store, payload, deps); }

test('una secuencia prompt -> todo(in_progress) -> todo(completed) llena el libro', () => {
  const store = createStore();
  const id = 's1';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'arreglá los nombres' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'in_progress' }] }, transcript_path: '/x' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'completed' }] }, transcript_path: '/x' });

  const book = store.get(id)._questbook;
  assert.equal(book.synopsis, 'arreglá los nombres');
  assert.equal(book.quests.length, 1);
  const q = book.quests[0];
  assert.equal(q.id, 'tarea A');
  assert.equal(q.status, 'completed');
  assert.equal(q.originPrompt, 'arreglá los nombres');
  assert.equal(q.claudeSummary, 'resumen de claude');
  assert.equal(q.monster, 'tarea A');
  assert.ok(q.hits >= 0);
  assert.ok(book.events.some((e) => e.type === 'quest_completed' && e.label === 'tarea A'));
});

test('el libro es interno: no aparece en el snapshot del store', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'hola' });
  const snap = store.snapshot().find((s) => s.id === 's2');
  assert.equal(snap._questbook, undefined);
  assert.equal(snap._currentPrompt, undefined);
});

test('eventos de error y waiting se loguean', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's3', prompt: 'p' });
  ev(store, { hook_event_name: 'Notification', session_id: 's3', message: 'te necesita' });
  ev(store, { hook_event_name: 'StopFailure', session_id: 's3', message: 'falló X' });
  const types = store.get('s3')._questbook.events.map((e) => e.type);
  assert.ok(types.includes('waiting'));
  assert.ok(types.includes('error'));
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/questbook-capture.test.js`
Expected: FAIL — `_questbook` es `undefined` (todavía no se captura).

- [ ] **Step 3: Importar questbook y inicializar en `ensure()`**

En `habitat/server/hooks-logic.js`, cambiar el import del tope:

```js
import { newSession, questFromTodos, monsterFromTodos, randomMonster } from './state.js';
import { emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent } from './questbook.js';
```

Reemplazar la función `ensure` por:

```js
function ensure(store, payload) {
  let s = store.get(payload.session_id);
  if (!s) {
    s = newSession(payload.session_id, {});
    s._touched = new Set();
    store.upsert(s);
  }
  if (!s._touched) s._touched = new Set();
  if (!s._questbook) s._questbook = emptyBook();
  if (s._currentPrompt == null) s._currentPrompt = '';
  return s;
}
```

- [ ] **Step 4: Poblar synopsis/currentPrompt en `UserPromptSubmit`**

En el `case 'UserPromptSubmit':`, agregar al inicio del bloque (después de `s._resting = false;`):

```js
      s._currentPrompt = payload.prompt ? String(payload.prompt).slice(0, 200) : '';
      setSynopsis(s._questbook, s._currentPrompt);
```

- [ ] **Step 5: Loguear eventos en Notification / StopFailure / Stop**

En `case 'Notification':`, después de `setStatus(...)`:

```js
      pushEvent(s._questbook, { type: 'waiting', label: payload.message || 'te necesita', detail: '', ts: now() });
```

En `case 'StopFailure':`, después de `setStatus(...)`:

```js
      pushEvent(s._questbook, { type: 'error', label: payload.message || 'falló', detail: '', ts: now() });
```

En `case 'Stop':`, justo después de la línea `setStatus(s, done ? 'done' : 'idle', ...)`:

```js
      if (done) pushEvent(s._questbook, { type: 'dungeon_cleared', label: 'dungeon cleared', detail: '', ts: now() });
```

Y dentro del mismo `case 'Stop'`, en la rama donde se arma el `fightResult` del monstruo de turno (después de construir `fightResult = { ... }`), agregar:

```js
        pushEvent(s._questbook, {
          type: 'boss_defeated',
          label: s.monster.isBoss ? `boss vencido: ${s.monster.label}` : `vencido: ${s.monster.label}`,
          detail: loot.join(', '),
          ts: now(),
        });
```

(El tipo `boss_defeated` es el "bucket" de monstruo vencido con loot, sea boss o monstruo de turno; el `label` distingue.)

- [ ] **Step 6: Loguear evento `cleared` en la rama /clear**

En la rama `if (ev === 'SessionStart' && payload.source === 'clear' && payload.cwd)`, dentro del `if (prev)`, **justo antes** de `store.upsert(prev);` (y SIN resetear `_questbook`), agregar:

```js
      if (!prev._questbook) prev._questbook = emptyBook();
      pushEvent(prev._questbook, { type: 'cleared', label: 'memoria despejada', detail: '', ts: now() });
```

- [ ] **Step 7: Acumular quests + resumen + completar en `handleTodoWrite`**

Reemplazar la firma y cuerpo de `handleTodoWrite` por:

```js
function handleTodoWrite(s, payload, now, deps) {
  const todos = (payload.tool_input && payload.tool_input.todos) || [];
  const prevDone = s.quest ? s.quest.done : 0;
  const prevLabel = s.monster ? s.monster.label : null;
  s.quest = questFromTodos(todos);
  let fightResult = null;

  // Quest Book: acumular quests (no borra las que salen del plan).
  upsertQuests(s._questbook, todos, { originPrompt: s._currentPrompt, now: now() });

  // ¿se completó un todo? (subió done) -> cayó el monstruo anterior
  if (s.quest.done > prevDone && prevLabel) {
    const loot = s._touched && s._touched.size ? [...s._touched] : [prevLabel];
    fightResult = { id: s.id, result: {
      monster: prevLabel, hp: s.combat.tokens, hits: s.combat.hits, loot,
    } };
    // Quest Book: estampar monstruo + daño en la quest completada y loguear evento.
    completeQuest(s._questbook, prevLabel, { monster: prevLabel, damage: s.combat.tokens, hits: s.combat.hits });
    pushEvent(s._questbook, {
      type: 'quest_completed', label: prevLabel,
      detail: `${s.combat.tokens} dmg · ${s.combat.hits} golpes`, ts: now(),
    });
    s.combat = { hits: 0, tokens: 0 };
    s._touched = new Set();
  }

  const next = monsterFromTodos(todos);
  // si cambia el monstruo en curso, resetear combate
  if (next && (!s.monster || s.monster.label !== next.label)) {
    s.combat = { hits: 0, tokens: 0 };
    s._touched = new Set();
  }
  s.monster = next;
  // Quest Book: capturar el resumen de Claude cuando una quest entra en curso.
  if (next && deps && deps.readLastAssistantText) {
    setClaudeSummary(s._questbook, next.label, deps.readLastAssistantText(payload.transcript_path));
  }
  setStatus(s, 'working', 'planificando', now);
  return fightResult;
}
```

Y en el `case 'PreToolUse': case 'PostToolUse':`, cambiar la llamada:

```js
      if (payload.tool_name === 'TodoWrite') {
        fightResult = handleTodoWrite(s, payload, now, deps);
      } else {
```

(`deps` está disponible: es el 3er parámetro de `applyEvent`.)

- [ ] **Step 8: Inyectar `readLastAssistantText` en `index.js`**

En `habitat/server/index.js`, cambiar el import de transcript:

```js
import { readUsage, readLastAssistantText } from './transcript.js';
```

Y en el handler `/hooks`, agregar `readLastAssistantText` al objeto `deps`:

```js
        const { session, fightResult, removed } = applyEvent(store, payload, {
          readUsage, readLastAssistantText, gitBranch, now: () => Date.now(),
          worktreeName: config.WORKTREES_DIR ? (cwd) => worktreeName(config.WORKTREES_DIR, cwd) : () => null,
        });
```

- [ ] **Step 9: Correr los tests del feature y la suite del server**

Run: `cd habitat && node --test server/questbook-capture.test.js && npm test`
Expected: PASS (los 3 tests nuevos + toda la suite del server, sin regresiones).

- [ ] **Step 10: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/index.js habitat/server/questbook-capture.test.js
git commit -m "feat(habitat): capturar Quest Book desde los hooks"
```

---

### Task 4: Endpoint `GET /questbook`

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Produces: `GET /questbook?id=<session>` → `200` con el `_questbook` de la sesión (o `{ synopsis:'', quests:[], events:[] }` si la sesión no tiene libro), `404` si la sesión no existe, `401/403` por `authorize()`.

- [ ] **Step 1: Escribir el test que falla**

En `habitat/server/index.test.js`, agregar (reutilizar los helpers/imports existentes del archivo: `createApp`, `createStore`, `newSession`, `listen`, `auth`):

```js
test('GET /questbook devuelve el libro de la sesión', async () => {
  const store = createStore();
  const s = newSession('qb1', { name: 'luigi' });
  s._questbook = { synopsis: 'objetivo', quests: [{ id: 'a', title: 'a', status: 'completed' }], events: [] };
  store.upsert(s);
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=qb1`, { headers: { ...auth } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.synopsis, 'objetivo');
  assert.equal(body.quests[0].id, 'a');
  server.close();
});

test('GET /questbook 404 si la sesión no existe', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=nope`, { headers: { ...auth } });
  assert.equal(r.status, 404);
  server.close();
});

test('GET /questbook libro vacío si la sesión no tiene _questbook', async () => {
  const store = createStore();
  store.upsert(newSession('qb2', { name: 'mario' }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=qb2`, { headers: { ...auth } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(body, { synopsis: '', quests: [], events: [] });
  server.close();
});
```

(Si el archivo no importa `newSession`, agregalo: `import { createStore, newSession } from './state.js';`.)

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — la ruta `/questbook` no existe (devuelve 404 genérico para el primer test, y el de payload falla).

- [ ] **Step 3: Implementar la ruta**

En `habitat/server/index.js`, después del bloque `if (req.method === 'GET' && url.pathname === '/preview') { ... }`, agregar:

```js
    if (req.method === 'GET' && url.pathname === '/questbook') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id'));
      if (!s) { res.writeHead(404).end(); return; }
      const book = s._questbook || { synopsis: '', quests: [], events: [] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(book));
      return;
    }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (los 3 tests nuevos + el resto de la suite).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint GET /questbook on-demand"
```

---

### Task 5: Assets ninja (copiar + registrar)

**Files:**
- Create (binarios): `habitat/client/public/assets/ui/scroll-bg.png`, `book.png`, `quest-done.png`, `quest-pending.png`
- Modify: `habitat/scripts/import-assets.sh`

**Interfaces:**
- Produces: 4 PNG en `habitat/client/public/assets/ui/` servidos como `assets/ui/<nombre>.png`.

- [ ] **Step 1: Copiar los PNG a nuestra carpeta**

Desde la raíz del repo (`/home/mnonm/habitat-worktrees/RPG-Agents/luigi`):

```bash
P="Ninja Adventure - Asset Pack"
D="habitat/client/public/assets/ui"
cp "$P/Ui/Receptacle/Receptacle Rectangle/BackgroundScroll.png" "$D/scroll-bg.png"
cp "$P/Items/Object/Book.png" "$D/book.png"
cp "$P/Ui/Skill Icon/Items & Weapon/Scroll.png" "$D/quest-done.png"
cp "$P/Ui/Skill Icon/Items & Weapon/ScrollDisabled.png" "$D/quest-pending.png"
```

- [ ] **Step 2: Verificar que existen**

Run: `ls -1 habitat/client/public/assets/ui/{scroll-bg,book,quest-done,quest-pending}.png`
Expected: las 4 rutas listadas sin error.

- [ ] **Step 3: Registrar en `import-assets.sh`**

En `habitat/scripts/import-assets.sh`, en la sección UI (después de la línea `cp "$SRC/Items/Treasure/GoldCoin.png" "$DST/ui/coin.png"`), agregar:

```bash
cp "$SRC/Ui/Receptacle/Receptacle Rectangle/BackgroundScroll.png" "$DST/ui/scroll-bg.png"
cp "$SRC/Items/Object/Book.png" "$DST/ui/book.png"
cp "$SRC/Ui/Skill Icon/Items & Weapon/Scroll.png" "$DST/ui/quest-done.png"
cp "$SRC/Ui/Skill Icon/Items & Weapon/ScrollDisabled.png" "$DST/ui/quest-pending.png"
```

- [ ] **Step 4: Commit**

```bash
git add habitat/client/public/assets/ui/scroll-bg.png habitat/client/public/assets/ui/book.png habitat/client/public/assets/ui/quest-done.png habitat/client/public/assets/ui/quest-pending.png habitat/scripts/import-assets.sh
git commit -m "chore(habitat): assets ninja del Quest Book (scroll-bg, book, quest icons)"
```

---

### Task 6: Tipos + composable `useQuestBook`

**Files:**
- Modify: `habitat/client/src/types.ts`
- Create: `habitat/client/src/composables/useQuestBook.ts`
- Create: `habitat/client/src/composables/questIcons.ts`
- Test: `habitat/client/src/composables/useQuestBook.test.ts`

**Interfaces:**
- Produces:
  - Tipos `Quest`, `QuestEvent`, `QuestBook` en `types.ts`.
  - `useQuestBook()` → `{ book: Ref<QuestBook|null>, loading: Ref<boolean>, error: Ref<string>, load(id: string): Promise<void> }`.
  - `questIcon(status): string` → ruta del icono.

- [ ] **Step 1: Agregar tipos a `types.ts`**

Agregar al final de `habitat/client/src/types.ts`:

```ts
export interface Quest {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  originPrompt: string
  claudeSummary: string
  monster: string | null
  damage: number
  hits: number
  since: number
}

export interface QuestEvent {
  type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared'
  label: string
  detail: string
  ts: number
}

export interface QuestBook {
  synopsis: string
  quests: Quest[]
  events: QuestEvent[]
}
```

- [ ] **Step 2: Crear `questIcons.ts` y su test**

Crear `habitat/client/src/composables/questIcons.ts`:

```ts
import type { Quest } from '../types'

// Icono por estado de quest. pending e in_progress comparten el scroll "apagado"
// (in_progress se distingue con un glow CSS en el componente).
export function questIcon(status: Quest['status']): string {
  return status === 'completed' ? 'assets/ui/quest-done.png' : 'assets/ui/quest-pending.png'
}
```

Crear `habitat/client/src/composables/useQuestBook.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { questIcon } from './questIcons'
import { useQuestBook } from './useQuestBook'

describe('questIcon', () => {
  it('completed -> quest-done', () => { expect(questIcon('completed')).toBe('assets/ui/quest-done.png') })
  it('pending -> quest-pending', () => { expect(questIcon('pending')).toBe('assets/ui/quest-pending.png') })
  it('in_progress -> quest-pending', () => { expect(questIcon('in_progress')).toBe('assets/ui/quest-pending.png') })
})

describe('useQuestBook', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('carga el libro en éxito y pide la URL con id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ synopsis: 'x', quests: [], events: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const qb = useQuestBook()
    await qb.load('s1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/questbook?id=s1')
    expect(qb.book.value?.synopsis).toBe('x')
    expect(qb.loading.value).toBe(false)
    expect(qb.error.value).toBe('')
  })

  it('setea error en respuesta no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    const qb = useQuestBook()
    await qb.load('s1')
    expect(qb.error.value).toContain('404')
    expect(qb.book.value).toBeNull()
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useQuestBook.test.ts`
Expected: FAIL — `./useQuestBook` no existe.

- [ ] **Step 4: Implementar `useQuestBook.ts`**

Crear `habitat/client/src/composables/useQuestBook.ts`:

```ts
import { ref } from 'vue'
import type { QuestBook } from '../types'

// Token de la query, igual que useProjects/usePreview.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

// Pide el Quest Book on-demand (al abrir el libro). No es singleton: cada panel
// maneja su propia carga.
export function useQuestBook() {
  const book = ref<QuestBook | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function load(id: string) {
    loading.value = true
    error.value = ''
    book.value = null
    try {
      const res = await fetch(`/questbook?id=${encodeURIComponent(id)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = `HTTP ${res.status}`; return }
      book.value = (await res.json()) as QuestBook
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  return { book, loading, error, load }
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/composables/useQuestBook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useQuestBook.ts habitat/client/src/composables/questIcons.ts habitat/client/src/composables/useQuestBook.test.ts
git commit -m "feat(habitat): tipos QuestBook + composable useQuestBook + questIcon"
```

---

### Task 7: Componente `QuestBook.vue` + toggle en `DetailPanel`

**Files:**
- Create: `habitat/client/src/components/QuestBook.vue`
- Modify: `habitat/client/src/components/DetailPanel.vue`

**Interfaces:**
- Consumes: `useQuestBook()` y `questIcon()` (Task 6); tipos `QuestBook`/`Quest`/`QuestEvent`; `ago` de `../sprites`; assets de Task 5.
- Produces: el libro overlay y su botón de apertura en el panel de detalle.

- [ ] **Step 1: Crear `QuestBook.vue`**

Crear `habitat/client/src/components/QuestBook.vue`:

```vue
<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useQuestBook } from '../composables/useQuestBook'
import { questIcon } from '../composables/questIcons'
import { ago } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { book, loading, error, load } = useQuestBook()
const expanded = ref<string | null>(null)

watch(() => props.id, (id) => { if (id) load(id) }, { immediate: true })

const total = computed(() => book.value?.quests.length ?? 0)
const done = computed(() => book.value?.quests.filter((q) => q.status === 'completed').length ?? 0)

function toggle(id: string) { expanded.value = expanded.value === id ? null : id }
</script>

<template>
  <div class="qb-overlay" @click.self="emit('close')">
    <div class="qb-book">
      <button class="qb-close" @click="emit('close')" aria-label="cerrar">✕</button>

      <div v-if="loading" class="qb-msg">Abriendo el libro…</div>
      <div v-else-if="error" class="qb-msg">No se pudo abrir el libro ({{ error }})</div>
      <template v-else-if="book">
        <header class="qb-head">
          <div class="qb-syn">{{ book.synopsis || 'Sin sinopsis' }}</div>
          <div class="qb-prog">{{ done }}/{{ total }} quests</div>
        </header>

        <section class="qb-quests">
          <div v-if="!book.quests.length" class="qb-empty">Sin quests registradas.</div>
          <div v-for="q in book.quests" :key="q.id" class="qb-quest" :class="q.status">
            <div class="qb-qrow" @click="toggle(q.id)">
              <img class="qb-qicon" :class="{ prog: q.status === 'in_progress' }" :src="questIcon(q.status)" alt="" />
              <span class="qb-qtitle">{{ q.title }}</span>
            </div>
            <div v-if="expanded === q.id" class="qb-qdetail">
              <p v-if="q.originPrompt"><b>Pedido:</b> {{ q.originPrompt }}</p>
              <p v-if="q.claudeSummary"><b>Resumen:</b> {{ q.claudeSummary }}</p>
              <p v-if="q.monster"><b>Vencido:</b> {{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
            </div>
          </div>
        </section>

        <section class="qb-events">
          <div class="qb-label">Eventos</div>
          <div v-if="!book.events.length" class="qb-empty">Sin eventos.</div>
          <div v-for="(e, i) in [...book.events].reverse()" :key="i" class="qb-event" :class="e.type">
            <span class="qb-etime">{{ ago(e.ts) }}</span>
            <span class="qb-elabel">{{ e.label }}</span>
            <span v-if="e.detail" class="qb-edetail">{{ e.detail }}</span>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.qb-overlay { position: absolute; inset: 0; background: #0008; display: flex; justify-content: center; align-items: stretch; z-index: 20; }
.qb-book {
  position: relative; margin: 14px; flex: 1; max-width: 560px; overflow-y: auto;
  background: #2a1d0e url('/assets/ui/scroll-bg.png') top center / 100% auto no-repeat;
  border: 2px solid #c8a860; border-radius: 10px; box-shadow: 0 8px 26px #000a;
  color: #e8d4a8; font-family: var(--f-ui); padding: 16px 18px;
}
.qb-close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: #e8d4a8; font-size: 16px; cursor: pointer; }
.qb-msg { padding: 30px 6px; color: #cbb586; }
.qb-head { border-bottom: 1px solid #6b5836; padding-bottom: 10px; margin-bottom: 10px; }
.qb-syn { font-size: 14px; font-weight: bold; line-height: 1.35; }
.qb-prog { font-size: 11px; color: #cbb586; margin-top: 4px; }
.qb-quests { display: flex; flex-direction: column; gap: 4px; }
.qb-quest { border-radius: 6px; }
.qb-qrow { display: flex; align-items: center; gap: 8px; padding: 5px 4px; cursor: pointer; }
.qb-qrow:hover { background: #ffffff14; }
.qb-qicon { width: 18px; height: 18px; image-rendering: pixelated; }
.qb-qicon.prog { animation: qb-pulse 1.1s ease-in-out infinite; }
@keyframes qb-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.8); } }
.qb-quest.completed .qb-qtitle { color: #bda; text-decoration: line-through; opacity: 0.85; }
.qb-qtitle { font-size: 12px; }
.qb-qdetail { padding: 4px 8px 8px 30px; font-size: 11px; color: #d8c69e; }
.qb-qdetail p { margin: 3px 0; }
.qb-events { margin-top: 14px; border-top: 1px solid #6b5836; padding-top: 8px; }
.qb-label { font-size: 10px; text-transform: uppercase; color: #cbb586; margin-bottom: 6px; }
.qb-event { display: flex; gap: 8px; align-items: baseline; font-size: 11px; padding: 2px 0; }
.qb-etime { color: #9a8a6a; min-width: 64px; }
.qb-event.error .qb-elabel { color: #f9a; }
.qb-event.dungeon_cleared .qb-elabel, .qb-event.quest_completed .qb-elabel { color: #bda; }
.qb-edetail { color: #9a8a6a; }
.qb-empty { font-size: 11px; color: #9a8a6a; padding: 6px 2px; }
</style>
```

- [ ] **Step 2: Integrar el toggle en `DetailPanel.vue`**

En `habitat/client/src/components/DetailPanel.vue`:

1. En el `<script setup>`, agregar el import y el estado:

```ts
import QuestBook from './QuestBook.vue'
```

Y junto a los otros `ref` (después de `const loot = ref<FightResult | null>(null)`):

```ts
const bookOpen = ref(false)
watch(selectedId, () => { bookOpen.value = false }) // cerrar el libro al cambiar de sesión
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') bookOpen.value = false }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
```

(Agregar `onMounted, onUnmounted` al import de `vue` existente: `import { computed, ref, watch, onMounted, onUnmounted } from 'vue'`.)

2. En el `<template>`, en el `<div class="dhead crt">`, agregar el botón antes del botón `killsession` (o después; va dentro del dhead):

```html
        <button class="bookbtn" @click="bookOpen = !bookOpen" aria-label="quest book" title="Quest Book">
          <img src="/assets/ui/book.png" alt="" />
        </button>
```

3. Dentro del `<template v-if="store.selected">`, después del `<div ref="termEl" ...>` (o al final del bloque, hermano de la terminal), agregar el overlay:

```html
      <QuestBook v-if="bookOpen" :id="store.selected.id" @close="bookOpen = false" />
```

4. Agregar estilos en el `<style scoped>`:

```css
.bookbtn { align-self: flex-start; background: #2a1d0e; border: 1px solid #c8a860; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.bookbtn img { display: block; width: 18px; height: 18px; image-rendering: pixelated; }
.bookbtn:hover { background: #3a2a14; }
```

Nota: el `.dpanel` debe poder contener el overlay absoluto. Si `.dpanel` no tiene `position`, agregar `position: relative;` a su regla en el `<style scoped>` (el overlay usa `position:absolute; inset:0`).

- [ ] **Step 3: Typecheck y build del cliente**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: sin errores de tipos; build OK.

- [ ] **Step 4: Correr toda la suite del cliente (sin regresiones)**

Run: `cd habitat/client && npx vitest run`
Expected: PASS (incluye los tests de Task 6 y los previos).

- [ ] **Step 5: Verificación manual (smoke)**

Levantar la app, seleccionar una sesión que haya usado todos, clickear el botón 📖. Confirmar: se abre el libro pergamino sobre la terminal; muestra sinopsis + `X/Y`, la lista de quests con iconos (completadas tachadas, in_progress con glow), cada quest se expande mostrando pedido/resumen/monstruo, y la línea de eventos al pie. Cierra con ✕, click afuera y `Esc`. Si no se puede levantar la app en el entorno, dejar constancia en el reporte de que el smoke quedó pendiente.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/QuestBook.vue habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): libro overlay QuestBook.vue + toggle en el panel"
```

---

## Notas

- El libro pesado viaja solo on-demand (`GET /questbook`), nunca por WS: el campo `_questbook` queda fuera del broadcast por `snapOf`/`stripInternal`.
- `_questbook` se persiste a disco con el resto de la sesión (`serializeSession`), así que sobrevive reinicios del server.
- El tipo de evento `boss_defeated` es el bucket "monstruo vencido con loot" (boss o monstruo de turno); el `label` distingue el caso.
