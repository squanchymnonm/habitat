# Quest Book: diálogo pregunta↔respuesta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Quest Book registre el diálogo turno a turno (pregunta de Claude + respuesta del usuario) agrupado dentro de cada quest, con una quest "suelta" por sesión para que siempre haya contenido aunque no haya plan `TodoWrite`.

**Architecture:** Captura incremental en los hooks (Approach A): en `Stop` se lee el último mensaje del asistente del transcript y se abre un intercambio en la quest activa; en el siguiente `UserPromptSubmit` se cierra con el prompt del usuario. La lógica vive en el módulo puro `questbook.js`; `hooks-logic.js` orquesta. Se elimina la sección de eventos de combate del libro.

**Tech Stack:** Node.js (ESM, `node --test`), Vue 3 + TypeScript (Vitest, vue-tsc).

## Global Constraints

- `questbook.js` es **puro**: sin I/O, sin imports del server.
- Campos internos de sesión usan prefijo `_` (los excluye `stripInternal`, los persiste `serializeSession`).
- El diálogo se trunca a **~600 chars** por lado; la sinopsis sigue en 200.
- Cap global de intercambios por sesión: **100** (sumando todas las quests).
- Tests del server: `node --test` desde `habitat/`. Tests del cliente: `npm test` (Vitest) y typecheck con `npm run typecheck` desde `habitat/client/`.
- No cambiar la lógica de combate, `fightResult`, orbe ni `quest: { total, done }`.

---

### Task 1: `readLastAssistantText` acepta un corte configurable

**Files:**
- Modify: `habitat/server/transcript.js:33-56`
- Test: `habitat/server/transcript.test.js`

**Interfaces:**
- Produces: `readLastAssistantText(transcriptPath, max = 400): string` — devuelve el último texto de asistente del JSONL, truncado a `max`; `''` si no hay/archivo inexistente.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/transcript.test.js` (después del test "trunca a 400", usa el helper `fixture` ya existente en el archivo):

```js
test('readLastAssistantText respeta el parámetro max', () => {
  const p = fixture([{ type: 'assistant', message: { content: [{ type: 'text', text: 'z'.repeat(800) }] } }]);
  assert.equal(readLastAssistantText(p, 600).length, 600);
  assert.equal(readLastAssistantText(p).length, 400); // default sin cambios
  rmSync(p);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: FAIL — el `max=600` devuelve 400 (el parámetro se ignora).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/transcript.js`, cambiar la firma y la línea final de `readLastAssistantText`:

```js
export function readLastAssistantText(transcriptPath, max = 400) {
```

y la última línea (era `return last.slice(0, 400);`):

```js
  return last.slice(0, max);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: PASS (todos los tests de transcript).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/transcript.js habitat/server/transcript.test.js
git commit -m "feat(habitat): readLastAssistantText acepta corte configurable"
```

---

### Task 2: Funciones de diálogo y quest suelta en `questbook.js`

**Files:**
- Modify: `habitat/server/questbook.js`
- Test: `habitat/server/questbook.test.js`

**Interfaces:**
- Consumes: nada externo.
- Produces (firmas exactas):
  - `ensureLooseQuest(book, ctx): Quest` — `ctx = { now }`. Devuelve la quest suelta (`id: '__session__'`); la crea si no existe.
  - `activeQuestId(book): string | null` — id de la primera quest de plan (`!loose`) con `status === 'in_progress'`, o `null`.
  - `openExchange(book, questId, claudeText, ctx): { questId, index } | null` — `ctx = { now }`. Agrega `{ claude, you: '', ts }` a `quest.dialogue`, aplica el cap de 100, devuelve el puntero al intercambio recién agregado; `null` si `claudeText` vacío o la quest no existe.
  - `closeExchange(book, ptr, youText): void` — setea `you` (truncado a 600) en `ptr` si existe y está vacío.
  - `DIALOGUE_MAX = 600`, cap total `EXCHANGES_MAX = 100`.
- Además: las quests creadas por `upsertQuests` ahora incluyen `dialogue: []`.

- [ ] **Step 1: Write the failing tests**

Agregar al final de `habitat/server/questbook.test.js`. Primero, extender el import de la línea 3:

```js
import {
  emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent,
  ensureLooseQuest, activeQuestId, openExchange, closeExchange,
} from './questbook.js';
```

Luego los tests:

```js
test('upsertQuests inicializa dialogue vacío', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'pending' }], { now: 1 });
  assert.deepEqual(b.quests[0].dialogue, []);
});

test('ensureLooseQuest crea una vez y reusa, titulada con la sinopsis', () => {
  const b = emptyBook();
  setSynopsis(b, 'mi pedido inicial');
  const q1 = ensureLooseQuest(b, { now: 7 });
  const q2 = ensureLooseQuest(b, { now: 9 });
  assert.equal(q1.id, '__session__');
  assert.equal(q1.loose, true);
  assert.equal(q1.title, 'mi pedido inicial');
  assert.equal(q1.status, 'in_progress');
  assert.equal(b.quests.length, 1);  // no duplica
  assert.equal(q2, q1);              // misma referencia
});

test('ensureLooseQuest sin sinopsis usa "Sesión"', () => {
  const b = emptyBook();
  assert.equal(ensureLooseQuest(b, { now: 1 }).title, 'Sesión');
});

test('activeQuestId devuelve la quest de plan in_progress, ignorando la suelta', () => {
  const b = emptyBook();
  ensureLooseQuest(b, { now: 1 });               // loose, in_progress, NO debe ganar
  assert.equal(activeQuestId(b), null);
  upsertQuests(b, [{ content: 'tarea X', status: 'in_progress' }], { now: 2 });
  assert.equal(activeQuestId(b), 'tarea X');
});

test('openExchange agrega con you vacío y devuelve puntero; closeExchange rellena', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'lo que dijo claude', { now: 5 });
  assert.deepEqual(ptr, { questId: '__session__', index: 0 });
  assert.equal(q.dialogue[0].claude, 'lo que dijo claude');
  assert.equal(q.dialogue[0].you, '');
  assert.equal(q.dialogue[0].ts, 5);
  closeExchange(b, ptr, 'lo que respondí');
  assert.equal(q.dialogue[0].you, 'lo que respondí');
});

test('openExchange devuelve null si no hay texto o la quest no existe', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  assert.equal(openExchange(b, q.id, '', { now: 1 }), null);
  assert.equal(openExchange(b, 'noexiste', 'hola', { now: 1 }), null);
});

test('openExchange y closeExchange truncan a 600', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'c'.repeat(800), { now: 1 });
  assert.equal(q.dialogue[0].claude.length, 600);
  closeExchange(b, ptr, 'y'.repeat(800));
  assert.equal(q.dialogue[0].you.length, 600);
});

test('closeExchange no pisa un intercambio ya cerrado', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'pregunta', { now: 1 });
  closeExchange(b, ptr, 'primera');
  closeExchange(b, ptr, 'segunda');
  assert.equal(q.dialogue[0].you, 'primera');
});

test('openExchange respeta el cap global de 100 descartando el más viejo', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 0 });
  let ptr;
  for (let i = 0; i < 105; i++) ptr = openExchange(b, q.id, `c${i}`, { now: i });
  assert.equal(q.dialogue.length, 100);
  assert.equal(q.dialogue[0].claude, 'c5');   // se descartaron los 5 más viejos
  assert.equal(q.dialogue[99].claude, 'c104');
  // el puntero devuelto sigue apuntando al recién agregado pese al recorte
  assert.equal(q.dialogue[ptr.index].claude, 'c104');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && node --test server/questbook.test.js`
Expected: FAIL — las funciones nuevas no existen y `dialogue` es undefined.

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/questbook.js`: agregar las constantes nuevas debajo de las existentes, agregar `dialogue: []` al objeto creado en `upsertQuests`, y agregar las cuatro funciones nuevas.

Constantes (debajo de `const EVENTS_MAX = 50;`):

```js
const DIALOGUE_MAX = 600;
const EXCHANGES_MAX = 100;
```

En `upsertQuests`, dentro del `book.quests.push({ ... })`, agregar el campo (junto a `since: now`):

```js
        since: now,
        dialogue: [],
```

Funciones nuevas (al final del archivo, después de `pushEvent`):

```js
export function ensureLooseQuest(book, ctx = {}) {
  const { now = 0 } = ctx;
  let q = book.quests.find((x) => x.loose);
  if (q) return q;
  q = {
    id: '__session__',
    title: book.synopsis || 'Sesión',
    status: 'in_progress',
    loose: true,
    originPrompt: book.synopsis || '',
    claudeSummary: '',
    monster: null,
    damage: 0,
    hits: 0,
    since: now,
    dialogue: [],
  };
  book.quests.push(q);
  return q;
}

export function activeQuestId(book) {
  const q = book.quests.find((x) => !x.loose && x.status === 'in_progress');
  return q ? q.id : null;
}

function totalExchanges(book) {
  return book.quests.reduce((n, q) => n + (q.dialogue ? q.dialogue.length : 0), 0);
}

export function openExchange(book, questId, claudeText, ctx = {}) {
  const { now = 0 } = ctx;
  const text = String(claudeText || '');
  if (!text) return null;
  const q = book.quests.find((x) => x.id === questId);
  if (!q) return null;
  if (!q.dialogue) q.dialogue = [];
  q.dialogue.push({ claude: text.slice(0, DIALOGUE_MAX), you: '', ts: now });
  // Cap global: descartar el intercambio más viejo (de la quest más vieja con
  // diálogo) hasta volver bajo el tope. El recorte solo ocurre en open (Stop),
  // nunca entre un open y su close, así que el puntero que devolvemos abajo es
  // estable hasta su close.
  while (totalExchanges(book) > EXCHANGES_MAX) {
    const victim = book.quests.find((x) => x.dialogue && x.dialogue.length);
    if (!victim) break;
    victim.dialogue.shift();
  }
  return { questId, index: q.dialogue.length - 1 };
}

export function closeExchange(book, ptr, youText) {
  if (!ptr) return;
  const q = book.quests.find((x) => x.id === ptr.questId);
  if (!q || !q.dialogue) return;
  const ex = q.dialogue[ptr.index];
  if (!ex || ex.you) return;
  ex.you = String(youText || '').slice(0, DIALOGUE_MAX);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && node --test server/questbook.test.js`
Expected: PASS (incluidos los tests viejos: `emptyBook` sigue dando `{ synopsis:'', quests:[], events:[] }`).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/questbook.js habitat/server/questbook.test.js
git commit -m "feat(habitat): diálogo + quest suelta en questbook.js"
```

---

### Task 3: Capturar el diálogo en `hooks-logic.js` y quitar los eventos de combate

**Files:**
- Modify: `habitat/server/hooks-logic.js` (import línea 3; `UserPromptSubmit` ~146; `Notification` ~160; `StopFailure` ~165; `Stop` ~178; `handleTodoWrite` ~241; rama `/clear` ~89)
- Test: `habitat/server/questbook-capture.test.js`

**Interfaces:**
- Consumes: `ensureLooseQuest`, `activeQuestId`, `openExchange`, `closeExchange` (Task 2); `readLastAssistantText(path, 600)` (Task 1).
- Produces: efecto sobre `s._questbook.quests[*].dialogue`; puntero efímero `s._openExchange`. `s._questbook.events` deja de poblarse.

- [ ] **Step 1: Write/replace the failing tests**

Reemplazar **por completo** el contenido de `habitat/server/questbook-capture.test.js` con:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = {
  readUsage: () => null,
  readLastAssistantText: () => 'lo que preguntó claude',
  gitBranch: () => '',
  now: () => 1000,
  worktreeName: () => null,
};

function ev(store, payload) { return applyEvent(store, payload, deps); }

test('sin plan: el diálogo cae en la quest suelta titulada con la sinopsis', () => {
  const store = createStore();
  const id = 'd1';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'arreglá los nombres' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'sí, dale' });

  const book = store.get(id)._questbook;
  assert.equal(book.synopsis, 'arreglá los nombres');
  const loose = book.quests.find((q) => q.loose);
  assert.ok(loose, 'debe existir la quest suelta');
  assert.equal(loose.id, '__session__');
  assert.equal(loose.title, 'arreglá los nombres');
  assert.equal(loose.dialogue.length, 1);
  assert.equal(loose.dialogue[0].claude, 'lo que preguntó claude');
  assert.equal(loose.dialogue[0].you, 'sí, dale');
});

test('con plan in_progress: el diálogo del turno cae en esa quest, no en la suelta', () => {
  const store = createStore();
  const id = 'd2';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hacé la tarea' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'in_progress' }] }, transcript_path: '/x' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'perfecto' });

  const book = store.get(id)._questbook;
  const planQ = book.quests.find((q) => q.id === 'tarea A');
  assert.equal(planQ.dialogue.length, 1);
  assert.equal(planQ.dialogue[0].you, 'perfecto');
  assert.equal(book.quests.some((q) => q.loose), false, 'no se crea quest suelta si hay plan activo');
});

test('una pregunta sin responder todavía queda con you vacío', () => {
  const store = createStore();
  const id = 'd3';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'p' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });

  const loose = store.get(id)._questbook.quests.find((q) => q.loose);
  assert.equal(loose.dialogue.length, 1);
  assert.equal(loose.dialogue[0].you, '');
});

test('el primer prompt no abre intercambio (no hay turno previo de claude)', () => {
  const store = createStore();
  const id = 'd4';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hola' });
  const book = store.get(id)._questbook;
  assert.equal(book.quests.reduce((n, q) => n + q.dialogue.length, 0), 0);
});

test('ya no se loguean eventos de combate/estado en el libro', () => {
  const store = createStore();
  const id = 'd5';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'p' });
  ev(store, { hook_event_name: 'Notification', session_id: id, message: 'te necesita' });
  ev(store, { hook_event_name: 'StopFailure', session_id: id, message: 'falló X' });
  assert.equal(store.get(id)._questbook.events.length, 0);
});

test('el libro sigue siendo interno: no aparece en el snapshot', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'hola' });
  const snap = store.snapshot().find((s) => s.id === 's2');
  assert.equal(snap._questbook, undefined);
  assert.equal(snap._openExchange, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && node --test server/questbook-capture.test.js`
Expected: FAIL — el diálogo no se captura y los eventos de combate aún se loguean.

- [ ] **Step 3: Write the implementation**

En `habitat/server/hooks-logic.js`:

(a) Reemplazar el import de la línea 3:

```js
import { emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest,
  ensureLooseQuest, activeQuestId, openExchange, closeExchange } from './questbook.js';
```

(b) En el caso `UserPromptSubmit`, cerrar el intercambio pendiente. El bloque queda:

```js
    case 'UserPromptSubmit': {
      s._resting = false;
      s._currentPrompt = payload.prompt ? String(payload.prompt).slice(0, 200) : '';
      setSynopsis(s._questbook, s._currentPrompt);
      if (s._openExchange) {
        closeExchange(s._questbook, s._openExchange, payload.prompt || '');
        s._openExchange = null;
      }
      setStatus(s, 'working', 'procesando tu pedido', now);
      if (s.monster?.source !== 'todo') {
        s.monster = randomMonster(payload.prompt ? String(payload.prompt).slice(0, 80) : 'enemigo');
        s.combat = { hits: 0, tokens: 0 };
        s._touched = new Set();
      }
      break;
    }
```

(Nota: el `you` se cierra con `payload.prompt` completo, no con el `_currentPrompt` truncado a 200; el truncado a 600 lo hace `closeExchange`.)

(c) En el caso `Stop`, al final del bloque (después de la lógica de monstruo de turno, antes del `break;`), abrir el intercambio del cierre de turno:

```js
      const dialogueQuestId = activeQuestId(s._questbook)
        ?? ensureLooseQuest(s._questbook, { now: now() }).id;
      const claudeText = deps.readLastAssistantText
        ? deps.readLastAssistantText(payload.transcript_path, 600)
        : '';
      s._openExchange = openExchange(s._questbook, dialogueQuestId, claudeText, { now: now() });
      break;
```

(d) Quitar los `pushEvent(...)` de combate/estado. Eliminar estas líneas:
- En la rama `/clear` (~89): `pushEvent(prev._questbook, { type: 'cleared', ... });`
- En `Notification` (~162): `pushEvent(s._questbook, { type: 'waiting', ... });`
- En `StopFailure` (~167): `pushEvent(s._questbook, { type: 'error', ... });`
- En `Stop` (~181): `if (done) pushEvent(s._questbook, { type: 'dungeon_cleared', ... });` (quitar solo el `pushEvent`; conservar el cálculo de `done` y el `setStatus`).
- En `Stop` (~190-195): el bloque `pushEvent(s._questbook, { type: 'boss_defeated', ... });` (conservar el `fightResult`).
- En `handleTodoWrite` (~241-244): `pushEvent(s._questbook, { type: 'quest_completed', ... });` (conservar `completeQuest(...)` justo arriba).

`pushEvent` ya no se importa ni se usa en `hooks-logic.js` (sigue exportada en `questbook.js` para su test unitario).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && node --test server/questbook-capture.test.js server/hooks-logic.test.js`
Expected: PASS. Si `hooks-logic.test.js` tenía asserts sobre `events` de combate, ajustarlos igual que en `questbook-capture.test.js` (deben dejar de esperar esos eventos).

- [ ] **Step 5: Run the full server suite**

Run: `cd habitat && node --test`
Expected: PASS (toda la suite del server).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/questbook-capture.test.js
git commit -m "feat(habitat): capturar diálogo turno a turno; quitar eventos de combate del libro"
```

---

### Task 4: Tipos del cliente (`types.ts`)

**Files:**
- Modify: `habitat/client/src/types.ts:84-107`

**Interfaces:**
- Produces: `QuestExchange`, `Quest.dialogue: QuestExchange[]`, `Quest.loose?: boolean`, `QuestBook.events?` opcional.

- [ ] **Step 1: Update the types**

Reemplazar el bloque de tipos del Quest Book (`Quest`, `QuestEvent`, `QuestBook`) por:

```ts
export interface QuestExchange {
  claude: string
  you: string
  ts: number
}

export interface Quest {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  loose?: boolean
  originPrompt: string
  claudeSummary: string
  monster: string | null
  damage: number
  hits: number
  since: number
  dialogue: QuestExchange[]
}

// Deprecado: el libro ya no genera eventos de combate. Se conserva el tipo y el
// campo opcional por compatibilidad del payload.
export interface QuestEvent {
  type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared'
  label: string
  detail: string
  ts: number
}

export interface QuestBook {
  synopsis: string
  quests: Quest[]
  events?: QuestEvent[]
}
```

- [ ] **Step 2: Verify typecheck (will fail in QuestBook.vue — expected, fixed in Task 5)**

Run: `cd habitat/client && npm run typecheck`
Expected: errores SOLO en `QuestBook.vue` (usa `book.events` que ahora es opcional). `types.ts` en sí compila. Si hay errores en otros archivos, resolverlos acá. No commitear todavía: el commit va junto con Task 5 para no dejar el typecheck roto.

---

### Task 5: UI — diálogo dentro de cada quest, sin sección de eventos

**Files:**
- Modify: `habitat/client/src/components/QuestBook.vue`
- Test: `habitat/client/src/composables/useQuestBook.test.ts` (solo si asume `events`)

**Interfaces:**
- Consumes: `Quest.dialogue`, `Quest.loose`, `QuestExchange` (Task 4); `questIcon` (sin cambios).

- [ ] **Step 1: Reescribir el `<script setup>` para contar solo quests de plan y manejar expand de intercambios**

Reemplazar el bloque `<script setup>` de `QuestBook.vue` por:

```ts
import { ref, watch, computed } from 'vue'
import { useQuestBook } from '../composables/useQuestBook'
import { questIcon } from '../composables/questIcons'
import { ago } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { book, loading, error, load } = useQuestBook()
const expanded = ref<string | null>(null)
// intercambios de Claude expandidos: clave `${questId}:${index}`
const openText = ref<Set<string>>(new Set())

watch(() => props.id, (id) => { if (id) load(id) }, { immediate: true })

// El progreso X/Y cuenta solo quests de plan (no la quest suelta de la sesión).
const planQuests = computed(() => book.value?.quests.filter((q) => !q.loose) ?? [])
const total = computed(() => planQuests.value.length)
const done = computed(() => planQuests.value.filter((q) => q.status === 'completed').length)

function toggle(id: string) { expanded.value = expanded.value === id ? null : id }
function exKey(qid: string, i: number) { return `${qid}:${i}` }
function toggleText(key: string) {
  const next = new Set(openText.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  openText.value = next
}
```

- [ ] **Step 2: Reescribir el `<template>` — diálogo en el detalle, sin sección de eventos**

Reemplazar el `<section class="qb-quests">` por la versión con diálogo, y **eliminar** por completo la `<section class="qb-events">`:

```html
        <section class="qb-quests">
          <div v-if="!book.quests.length" class="qb-empty">Sin quests registradas.</div>
          <div v-for="q in book.quests" :key="q.id" class="qb-quest" :class="q.status">
            <div class="qb-qrow" @click="toggle(q.id)">
              <img class="qb-qicon" :class="{ prog: q.status === 'in_progress' }" :src="questIcon(q.status)" alt="" />
              <span class="qb-qtitle">{{ q.title }}</span>
            </div>
            <div v-if="expanded === q.id" class="qb-qdetail">
              <p v-if="q.originPrompt && !q.loose"><b>Pedido:</b> {{ q.originPrompt }}</p>

              <div v-if="!q.dialogue.length" class="qb-empty">Sin diálogo todavía.</div>
              <div v-for="(ex, i) in q.dialogue" :key="i" class="qb-ex">
                <div class="qb-ex-claude" @click="toggleText(exKey(q.id, i))">
                  <span class="qb-ex-tag">🗨️ Claude</span>
                  <span class="qb-ex-time">{{ ago(ex.ts) }}</span>
                  <span class="qb-ex-text" :class="{ clamp: !openText.has(exKey(q.id, i)) }">{{ ex.claude }}</span>
                </div>
                <div class="qb-ex-you">
                  <span class="qb-ex-tag">✍️ Vos</span>
                  <span class="qb-ex-text">{{ ex.you || '…esperando tu respuesta' }}</span>
                </div>
              </div>

              <p v-if="q.monster" class="qb-ex-loot"><b>Vencido:</b> {{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
            </div>
          </div>
        </section>
```

- [ ] **Step 3: Reemplazar los estilos de eventos por estilos de diálogo**

En el `<style scoped>`, **eliminar** las reglas `.qb-events`, `.qb-label`, `.qb-event`, `.qb-etime`, `.qb-event.error .qb-elabel`, `.qb-event.dungeon_cleared ...`, `.qb-edetail`. Agregar:

```css
.qb-ex { margin: 6px 0; padding-left: 4px; border-left: 2px solid #6b5836; }
.qb-ex-claude { cursor: pointer; }
.qb-ex-you { margin-top: 2px; }
.qb-ex-tag { font-size: 10px; color: #cbb586; margin-right: 6px; }
.qb-ex-time { font-size: 10px; color: #9a8a6a; margin-right: 6px; }
.qb-ex-text { font-size: 11px; color: #e8d4a8; white-space: pre-wrap; }
.qb-ex-text.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qb-ex-you .qb-ex-text { color: #bda; }
.qb-ex-loot { margin: 6px 0 0; font-size: 11px; color: #d8c69e; }
```

- [ ] **Step 4: Ajustar el test del composable si asume `events`**

Run: `cd habitat/client && npm test`
Expected: si `useQuestBook.test.ts` construye un `QuestBook` mock con `events` y/o `quests` sin `dialogue`, actualizar el mock para incluir `dialogue: []` en cada quest y dejar `events` fuera u opcional. Si no lo asume, pasa sin cambios.

- [ ] **Step 5: Typecheck y build del cliente**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: PASS, sin errores (incluye `types.ts` de Task 4).

- [ ] **Step 6: Smoke manual**

Levantar el server (`cd habitat && npm start`) y el cliente (`cd habitat/client && npm run dev`), abrir el panel de una sesión, clickear 📖 y verificar: la quest suelta aparece con el diálogo (Claude/Vos), "ver más" expande el texto de Claude, no hay sección de "Eventos" al pie, y `X/Y` solo cuenta quests de plan.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/components/QuestBook.vue habitat/client/src/composables/useQuestBook.test.ts
git commit -m "feat(habitat): UI del diálogo en el Quest Book; quitar sección de eventos"
```

---

## Self-Review

**Spec coverage:**
- "Captura turno a turno (Stop + UserPromptSubmit)" → Task 3. ✔
- "Quest suelta `__session__` cuando no hay plan in_progress" → Task 2 (`ensureLooseQuest`, `activeQuestId`), Task 3 (uso en `Stop`). ✔
- "Modelo híbrido: plan-quests intactas + suelta" → Task 2/3 (no se toca `upsertQuests`/`completeQuest`/combate). ✔
- "Fidelidad ~600 + expandible" → Task 1 (`max`), Task 2 (`DIALOGUE_MAX`), Task 5 (clamp + toggle). ✔
- "Cap 100" → Task 2. ✔
- "Eliminar sección de eventos de combate" → Task 3 (quitar `pushEvent`), Task 5 (quitar `<section qb-events>`). ✔
- "X/Y solo quests de plan" → Task 5 (`planQuests`). ✔
- "Tipos `QuestExchange`/`dialogue`/`events?`" → Task 4. ✔
- "`questbook.js` puro" → Task 2 no agrega imports. ✔

**Placeholder scan:** sin TBD/TODO; todo el código está escrito; los tests traen asserts concretos. ✔

**Type consistency:** `ensureLooseQuest`/`activeQuestId`/`openExchange`/`closeExchange` usadas en Task 3 con las firmas definidas en Task 2; `{ questId, index }` consistente entre `openExchange` y `closeExchange`; `Quest.dialogue`/`QuestExchange` consistentes entre Task 2 (server), Task 4 (tipos) y Task 5 (UI). ✔
