# Hábitat RPG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend Node que alimenta una GUI pixel-art donde cada sesión de Claude Code es un personaje en una grilla, y al expandir un pod se ve una batalla RPG cuyos datos (stamina, daño, loot) son telemetría real de la sesión.

**Architecture:** Servicio Node único: servidor HTTP que sirve la GUI estática y recibe POST de hooks de Claude Code, servidor WebSocket que empuja el estado al front, lector de transcript para tokens, y lector de tmux para el preview. El estado vive en un `Store` en memoria (fuente de verdad), con un contrato de sesión estable. El front parte de los mocks aprobados: la grilla (`habitat-prototipo.html`) y la escena de batalla en el drawer (`habitat-batalla-mock.html`).

**Tech Stack:** Node 18, `ws` (WebSocket), HTTP nativo (`node:http`), tests con `node:test` + `node:assert/strict` (sin frameworks externos). JavaScript plano (sin TypeScript).

## Global Constraints

- **Sin TypeScript.** JavaScript plano, módulos ES (`"type": "module"` en package.json) o CommonJS — usar **ESM** (`import`/`export`) de forma consistente en todo el proyecto.
- **Node 18.19.1**, npm 9. WebSocket NO es nativo en Node 18 → dependencia `ws`. No agregar otras dependencias salvo `ws`.
- **Tests con `node:test`**, ejecutados con `node --test`. Sin Jest/Mocha/Vitest.
- **Contrato de sesión estable** (Task 2 §5 del diseño): NO renombrar campos. Campos internos no-contrato van prefijados con `_` (ej. `_lastTotal`).
- **Seguridad (Ley 1):** el endpoint de hooks y el WS exigen Bearer token (`HABITAT_TOKEN`); bind a loopback/VPN; nunca exponer a internet; payloads de hook tratados como no confiables.
- **Ubicación del componente:** `habitat/` en la raíz del repo (`habitat/server/`, `habitat/web/`, `habitat/hook/`).
- **Commits frecuentes**, uno por tarea como mínimo. Terminar mensajes de commit con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Estados válidos:** `'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline'`.

---

### Task 1: Scaffold del proyecto + config

**Files:**
- Create: `habitat/package.json`
- Create: `habitat/server/config.js`
- Test: `habitat/server/config.test.js`

**Interfaces:**
- Produces: módulo `config.js` con export `default` `{ PORT, BIND, TOKEN, PREVIEW_LINES, MAX_CONTEXT }`. Todos los valores leen de `process.env` con defaults.

- [ ] **Step 1: Crear package.json**

```json
{
  "name": "habitat",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "start": "node server/index.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Instalar dependencias**

Run: `cd habitat && npm install`
Expected: crea `node_modules/` y `package-lock.json`, sin errores.

- [ ] **Step 3: Escribir el test de config**

`habitat/server/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config tiene defaults sensatos', async () => {
  const { default: config } = await import('./config.js');
  assert.equal(typeof config.PORT, 'number');
  assert.equal(typeof config.BIND, 'string');
  assert.equal(typeof config.PREVIEW_LINES, 'number');
  assert.equal(typeof config.MAX_CONTEXT, 'number');
  assert.ok(config.MAX_CONTEXT > 0);
  assert.equal(config.BIND, '127.0.0.1'); // loopback por default (Ley 1)
});
```

- [ ] **Step 4: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/config.test.js`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 5: Implementar config.js**

`habitat/server/config.js`:

```js
const num = (v, d) => (v == null || v === '' ? d : Number(v));

export default {
  PORT: num(process.env.HABITAT_PORT, 8377),
  BIND: process.env.HABITAT_BIND || '127.0.0.1',
  TOKEN: process.env.HABITAT_TOKEN || '',
  PREVIEW_LINES: num(process.env.HABITAT_PREVIEW_LINES, 30),
  MAX_CONTEXT: num(process.env.HABITAT_MAX_CONTEXT, 200000),
};
```

- [ ] **Step 6: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/config.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add habitat/package.json habitat/package-lock.json habitat/server/config.js habitat/server/config.test.js
git commit -m "feat(habitat): scaffold + config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Store de sesiones + helpers RPG

**Files:**
- Create: `habitat/server/state.js`
- Test: `habitat/server/state.test.js`

**Interfaces:**
- Produces:
  - `newSession(id, fields)` → objeto `Session` con defaults RPG: `{ id, name:'', project:'', branch:'', status:'idle', action:'', since:0, stamina:100, quest:undefined, monster:null, combat:{hits:0,tokens:0}, _lastTotal:0 }` mezclado con `fields`.
  - `createStore()` → `{ get(id), all(), upsert(session), remove(id), snapshot() }`. `snapshot()` devuelve array de sesiones **sin** los campos prefijados con `_`.
  - `hashType(text)` → `string` (string corto estable para variar sprite del monstruo).
  - `monsterFromTodos(todos)` → `{ type, isBoss, label } | null`. `todos` es el array de `tool_input.todos` de TodoWrite (`{content, status, activeForm}`). Toma el primer `status==='in_progress'`; `isBoss` si su índice es el último del array.
  - `questFromTodos(todos)` → `{ total, done }`.

- [ ] **Step 1: Escribir los tests**

`habitat/server/state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSession, createStore, hashType, monsterFromTodos, questFromTodos } from './state.js';

test('newSession aplica defaults RPG', () => {
  const s = newSession('abc', { name: 'api' });
  assert.equal(s.id, 'abc');
  assert.equal(s.name, 'api');
  assert.equal(s.status, 'idle');
  assert.equal(s.stamina, 100);
  assert.equal(s.monster, null);
  assert.deepEqual(s.combat, { hits: 0, tokens: 0 });
  assert.equal(s._lastTotal, 0);
});

test('store upsert/get/remove/all', () => {
  const store = createStore();
  store.upsert(newSession('a', { name: 'a' }));
  assert.equal(store.get('a').name, 'a');
  store.upsert(newSession('a', { name: 'a2' }));
  assert.equal(store.get('a').name, 'a2');
  assert.equal(store.all().length, 1);
  store.remove('a');
  assert.equal(store.get('a'), undefined);
});

test('snapshot oculta campos internos (_)', () => {
  const store = createStore();
  store.upsert(newSession('a', {}));
  const snap = store.snapshot();
  assert.equal(snap.length, 1);
  assert.equal('_lastTotal' in snap[0], false);
  assert.equal('stamina' in snap[0], true);
});

test('hashType es estable y no vacío', () => {
  assert.equal(hashType('crear modelo User'), hashType('crear modelo User'));
  assert.ok(hashType('x').length > 0);
  assert.notEqual(hashType('a'), hashType('b'));
});

test('monsterFromTodos toma el in_progress y marca boss en el último', () => {
  const todos = [
    { content: 'plan', status: 'completed' },
    { content: 'modelo', status: 'in_progress' },
    { content: 'review', status: 'pending' },
  ];
  const m = monsterFromTodos(todos);
  assert.equal(m.label, 'modelo');
  assert.equal(m.isBoss, false);
  assert.equal(typeof m.type, 'string');

  const last = [
    { content: 'a', status: 'completed' },
    { content: 'review', status: 'in_progress' },
  ];
  assert.equal(monsterFromTodos(last).isBoss, true);
});

test('monsterFromTodos sin in_progress devuelve null', () => {
  assert.equal(monsterFromTodos([{ content: 'a', status: 'completed' }]), null);
  assert.equal(monsterFromTodos([]), null);
});

test('questFromTodos cuenta total y done', () => {
  const todos = [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'in_progress' },
  ];
  assert.deepEqual(questFromTodos(todos), { total: 3, done: 2 });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/state.test.js`
Expected: FAIL — `Cannot find module './state.js'`.

- [ ] **Step 3: Implementar state.js**

`habitat/server/state.js`:

```js
export function hashType(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'm' + (h % 100000).toString(36);
}

export function newSession(id, fields = {}) {
  return {
    id,
    name: '',
    project: '',
    branch: '',
    status: 'idle',
    action: '',
    since: 0,
    stamina: 100,
    quest: undefined,
    monster: null,
    combat: { hits: 0, tokens: 0 },
    _lastTotal: 0,
    ...fields,
  };
}

export function questFromTodos(todos = []) {
  return {
    total: todos.length,
    done: todos.filter((t) => t.status === 'completed').length,
  };
}

export function monsterFromTodos(todos = []) {
  const idx = todos.findIndex((t) => t.status === 'in_progress');
  if (idx === -1) return null;
  const label = todos[idx].content || todos[idx].activeForm || '';
  return { type: hashType(label), isBoss: idx === todos.length - 1, label };
}

export function createStore() {
  const map = new Map();
  return {
    get: (id) => map.get(id),
    all: () => [...map.values()],
    upsert: (session) => { map.set(session.id, session); return session; },
    remove: (id) => { map.delete(id); },
    snapshot: () => [...map.values()].map(stripInternal),
  };
}

function stripInternal(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/state.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/state.js habitat/server/state.test.js
git commit -m "feat(habitat): store de sesiones + helpers RPG (monster/quest/hash)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Lector de transcript (tokens)

**Files:**
- Create: `habitat/server/transcript.js`
- Test: `habitat/server/transcript.test.js`
- Test fixture: `habitat/server/fixtures/transcript-sample.jsonl`

**Interfaces:**
- Produces: `readUsage(transcriptPath)` → `{ contextTokens, totalTokens } | null`.
  - `contextTokens` = del **último** turno `assistant` con `usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (ocupación de la ventana de context → para stamina).
  - `totalTokens` = suma acumulada sobre TODOS los turnos `assistant` de `input_tokens + output_tokens + cache_creation_input_tokens` (monótona creciente → el delta entre lecturas es el daño del paso). Excluye `cache_read` (no es gasto nuevo).
  - Devuelve `null` si el archivo no existe o no hay ningún `usage`.

- [ ] **Step 1: Crear el fixture**

`habitat/server/fixtures/transcript-sample.jsonl` (3 turnos assistant; copiar tal cual, una línea por objeto):

```jsonl
{"type":"user","message":{"role":"user","content":"hola"}}
{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_creation_input_tokens":50,"cache_read_input_tokens":1000,"output_tokens":20}}}
{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":1200,"output_tokens":80}}}
{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":300,"cache_creation_input_tokens":10,"cache_read_input_tokens":1500,"output_tokens":40}}}
```

- [ ] **Step 2: Escribir los tests**

`habitat/server/transcript.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readUsage } from './transcript.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, 'fixtures', 'transcript-sample.jsonl');

test('readUsage: contextTokens del último turno', () => {
  const u = readUsage(sample);
  // último turno: 300 + 1500 + 10
  assert.equal(u.contextTokens, 1810);
});

test('readUsage: totalTokens acumulado (in+out+cache_creation, sin cache_read)', () => {
  const u = readUsage(sample);
  // (100+20+50) + (200+80+0) + (300+40+10) = 170 + 280 + 350
  assert.equal(u.totalTokens, 800);
});

test('readUsage: archivo inexistente devuelve null', () => {
  assert.equal(readUsage('/no/existe.jsonl'), null);
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: FAIL — `Cannot find module './transcript.js'`.

- [ ] **Step 4: Implementar transcript.js**

`habitat/server/transcript.js`:

```js
import { readFileSync } from 'node:fs';

export function readUsage(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  let total = 0;
  let lastContext = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const u = obj.message && obj.message.usage;
    if (!u) continue;
    const inp = u.input_tokens || 0;
    const out = u.output_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    total += inp + out + cc;
    lastContext = inp + cr + cc;
  }
  if (lastContext === null) return null;
  return { contextTokens: lastContext, totalTokens: total };
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/transcript.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/transcript.js habitat/server/transcript.test.js habitat/server/fixtures/transcript-sample.jsonl
git commit -m "feat(habitat): lector de transcript (contextTokens/totalTokens)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Mapeo evento de hook → estado + mecánica RPG

**Files:**
- Create: `habitat/server/hooks-logic.js`
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: `createStore`, `newSession`, `monsterFromTodos`, `questFromTodos`, `hashType` (Task 2); forma de `readUsage` (Task 3).
- Produces: `applyEvent(store, payload, deps)` → `{ session, fightResult }`.
  - `payload`: objeto del hook (`{ session_id, cwd, hook_event_name, tool_name, tool_input, message, transcript_path, ... }`).
  - `deps`: `{ readUsage, maxContext, now }` — inyectados para testear (readUsage mock, `now` función que devuelve epoch ms).
  - Devuelve la `Session` mutada (siempre) y `fightResult` (`{ id, result:{ monster, hp, hits, loot } }` o `null`).
  - **Reglas** (tabla §5 del diseño):
    - `SessionStart` → status `idle`, deriva `name`/`project` del `cwd` (basename), `monster=null`.
    - `UserPromptSubmit` → `working`, action "procesando tu pedido". Limpia `_resting` y recomputa stamina si hay transcript.
    - `PostToolUse`/`PreToolUse` con `tool_name==='TodoWrite'` → `working`, set `quest` (questFromTodos) y `monster` (monsterFromTodos). Al cambiar el monstruo (label distinto al anterior), resetea `combat`.
    - `PreToolUse`/`PostToolUse` con otra tool y `monster!=null` → **golpe**: `combat.hits++`; si hay `readUsage`, `damage = max(0, totalTokens - _lastTotal)`, `combat.tokens += damage`, `combat.lastDamage = damage`, `_lastTotal = totalTokens`, `stamina = staminaFromContext(contextTokens, maxContext)`. action = `tool_name`.
    - Detección de **todo completado** → emitir `fightResult`. Ver Step de tracking abajo: se compara el `quest.done` previo; si subió, el último monstruo cayó. `loot` = `_touched` (archivos tocados, ver regla de Write/Edit) o `[monster.label]` si vacío. Resetea `combat` y `_touched`.
    - Write/Edit/MultiEdit (en PreToolUse) con `tool_input.file_path` → push a `session._touched` (set).
    - `StopFailure` → `error`, action = `message` o "falló".
    - `PreCompact` → `working`, `_resting=true`, `stamina=5`.
    - `Notification` → `waiting`, action = `message`.
    - `Stop` → si `quest && quest.done >= quest.total && quest.total>0` → `done`; si no `idle`.
    - `SessionEnd` → `offline`.
  - `staminaFromContext(ctx, max)` = `Math.max(0, Math.round(100 * (1 - ctx / max)))`.

- [ ] **Step 1: Escribir los tests**

`habitat/server/hooks-logic.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = (usage) => ({
  readUsage: () => usage,
  maxContext: 200000,
  now: () => 1000,
});

test('SessionStart registra sesión idle y deriva name del cwd', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.id, 's1');
  assert.equal(session.status, 'idle');
  assert.equal(session.name, 'proj-api');
});

test('TodoWrite setea quest y monster', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  const { session } = applyEvent(store, {
    session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'review', status: 'pending' },
    ] },
  }, deps(null));
  assert.deepEqual(session.quest, { total: 3, done: 1 });
  assert.equal(session.monster.label, 'b');
  assert.equal(session.monster.isBoss, false);
});

test('golpe acumula daño = delta de totalTokens y baja stamina', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'b', status: 'in_progress' }] } }, deps(null));
  // primer golpe: total 1000, _lastTotal era 0 -> damage 1000
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    deps({ contextTokens: 40000, totalTokens: 1000 }));
  assert.equal(r.session.combat.hits, 1);
  assert.equal(r.session.combat.tokens, 1000);
  assert.equal(r.session.combat.lastDamage, 1000);
  assert.equal(r.session.stamina, 80); // 100*(1-40000/200000)
  // segundo golpe: total 1500 -> damage 500
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read' },
    deps({ contextTokens: 50000, totalTokens: 1500 }));
  assert.equal(r.session.combat.tokens, 1500);
  assert.equal(r.session.combat.lastDamage, 500);
  assert.equal(r.session.stamina, 75);
});

test('Write/Edit acumula loot en _touched', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'b', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'src/Auth.php' } }, deps({ contextTokens: 10, totalTokens: 10 }));
  assert.deepEqual([...r.session._touched], ['src/Auth.php']);
});

test('completar un todo emite fightResult con hp=tokens y loot', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tests', status: 'in_progress' }, { content: 'review', status: 'pending' }] } }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: 'tests/AuthTest.php' } }, deps({ contextTokens: 10, totalTokens: 8000 }));
  // ahora el primer todo pasa a completed
  const { fightResult } = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tests', status: 'completed' }, { content: 'review', status: 'in_progress' }] } }, deps(null));
  assert.ok(fightResult);
  assert.equal(fightResult.result.monster, 'tests');
  assert.equal(fightResult.result.hp, 8000);
  assert.deepEqual(fightResult.result.loot, ['tests/AuthTest.php']);
});

test('Notification -> waiting; StopFailure -> error', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'Notification', message: 'pide permiso' }, deps(null));
  assert.equal(r.session.status, 'waiting');
  assert.equal(r.session.action, 'pide permiso');
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'StopFailure', message: 'boom' }, deps(null));
  assert.equal(r.session.status, 'error');
});

test('PreCompact descansa (stamina baja); Stop con dungeon completo -> done', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreCompact' }, deps(null));
  assert.equal(r.session.stamina, 5);
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'a', status: 'completed' }] } }, deps(null));
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.session.status, 'done');
});

test('SessionEnd -> offline', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd' }, deps(null));
  assert.equal(r.session.status, 'offline');
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: FAIL — `Cannot find module './hooks-logic.js'`.

- [ ] **Step 3: Implementar hooks-logic.js**

`habitat/server/hooks-logic.js`:

```js
import { basename } from 'node:path';
import { newSession, questFromTodos, monsterFromTodos } from './state.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function staminaFromContext(ctx, max) {
  return Math.max(0, Math.round(100 * (1 - ctx / max)));
}

function ensure(store, payload) {
  let s = store.get(payload.session_id);
  if (!s) {
    s = newSession(payload.session_id, {});
    s._touched = new Set();
    store.upsert(s);
  }
  if (!s._touched) s._touched = new Set();
  return s;
}

function setStatus(s, status, action, now) {
  if (s.status !== status) s.since = now();
  s.status = status;
  if (action != null) s.action = String(action).slice(0, 200);
}

export function applyEvent(store, payload, deps) {
  const { readUsage, maxContext, now } = deps;
  const ev = payload.hook_event_name;
  const s = ensure(store, payload);
  let fightResult = null;

  const recomputeStamina = () => {
    if (!payload.transcript_path) return;
    const u = readUsage(payload.transcript_path);
    if (u) s.stamina = staminaFromContext(u.contextTokens, maxContext);
  };

  switch (ev) {
    case 'SessionStart': {
      if (payload.cwd) { s.name = basename(payload.cwd); s.project = s.name; }
      setStatus(s, 'idle', 'sesión iniciada', now);
      s.monster = null;
      break;
    }
    case 'UserPromptSubmit': {
      s._resting = false;
      setStatus(s, 'working', 'procesando tu pedido', now);
      recomputeStamina();
      break;
    }
    case 'Notification': {
      setStatus(s, 'waiting', payload.message || 'te necesita', now);
      break;
    }
    case 'StopFailure': {
      setStatus(s, 'error', payload.message || 'falló', now);
      break;
    }
    case 'PreCompact': {
      s._resting = true;
      s.stamina = 5;
      setStatus(s, 'working', 'descansando (compactando)', now);
      break;
    }
    case 'Stop': {
      const done = s.quest && s.quest.total > 0 && s.quest.done >= s.quest.total;
      setStatus(s, done ? 'done' : 'idle', done ? 'dungeon cleared' : 'a la espera', now);
      break;
    }
    case 'SessionEnd': {
      setStatus(s, 'offline', 'sesión cerrada', now);
      break;
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      if (payload.tool_name === 'TodoWrite') {
        fightResult = handleTodoWrite(s, payload, now);
      } else {
        handleHit(s, payload, deps);
      }
      break;
    }
    default:
      break;
  }
  return { session: s, fightResult };
}

function handleTodoWrite(s, payload, now) {
  const todos = (payload.tool_input && payload.tool_input.todos) || [];
  const prevDone = s.quest ? s.quest.done : 0;
  const prevLabel = s.monster ? s.monster.label : null;
  s.quest = questFromTodos(todos);
  let fightResult = null;

  // ¿se completó un todo? (subió done) -> cayó el monstruo anterior
  if (s.quest.done > prevDone && prevLabel) {
    const loot = s._touched && s._touched.size ? [...s._touched] : [prevLabel];
    fightResult = { id: s.id, result: {
      monster: prevLabel, hp: s.combat.tokens, hits: s.combat.hits, loot,
    } };
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
  setStatus(s, 'working', 'planificando', now);
  return fightResult;
}

function handleHit(s, payload, deps) {
  const { readUsage, maxContext, now } = deps;
  setStatus(s, 'working', payload.tool_name || 'trabajando', now);
  if (EDIT_TOOLS.has(payload.tool_name) && payload.tool_input && payload.tool_input.file_path) {
    s._touched.add(payload.tool_input.file_path);
  }
  if (!s.monster) return;
  s.combat.hits++;
  if (payload.transcript_path) {
    const u = readUsage(payload.transcript_path);
    if (u) {
      const damage = Math.max(0, u.totalTokens - s._lastTotal);
      s.combat.tokens += damage;
      s.combat.lastDamage = damage;
      s._lastTotal = u.totalTokens;
      s._resting = false;
      s.stamina = staminaFromContext(u.contextTokens, maxContext);
    }
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): mapeo evento de hook -> estado + mecánica RPG

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Servidor WebSocket

**Files:**
- Create: `habitat/server/ws.js`
- Test: `habitat/server/ws.test.js`

**Interfaces:**
- Consumes: `createStore` (Task 2). Librería `ws`.
- Produces: `attachWs(httpServer, store, { token })` → `{ broadcast(msg), close() }`.
  - Al conectar un cliente: valida token (query `?token=` o header `Authorization: Bearer`). Si `token` configurado y no coincide → cierra el socket (code 1008). Si `token===''` → no exige (modo VPN sin token).
  - Tras validar, envía `{ type:'snapshot', sessions: store.snapshot() }`.
  - `broadcast(msg)` envía `JSON.stringify(msg)` a todos los clientes abiertos.

- [ ] **Step 1: Escribir los tests**

`habitat/server/ws.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachWs } from './ws.js';

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}
function nextMsg(ws) {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))));
}

test('al conectar manda snapshot; broadcast llega', async () => {
  const store = createStore();
  store.upsert(newSession('a', { name: 'api' }));
  const server = createServer();
  const hub = attachWs(server, store, { token: '' });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.once('open', r));
  const snap = await nextMsg(ws);
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.sessions[0].name, 'api');

  const p = nextMsg(ws);
  hub.broadcast({ type: 'session', session: { id: 'b' } });
  const m = await p;
  assert.equal(m.type, 'session');
  assert.equal(m.session.id, 'b');

  ws.close(); hub.close(); server.close();
});

test('token inválido cierra la conexión', async () => {
  const store = createStore();
  const server = createServer();
  const hub = attachWs(server, store, { token: 'secret' });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=wrong`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/ws.test.js`
Expected: FAIL — `Cannot find module './ws.js'`.

- [ ] **Step 3: Implementar ws.js**

`habitat/server/ws.js`:

```js
import { WebSocketServer } from 'ws';

export function attachWs(httpServer, store, { token }) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    if (token) {
      const url = new URL(req.url, 'http://x');
      const q = url.searchParams.get('token');
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (q !== token && hdr !== token) { ws.close(1008, 'unauthorized'); return; }
    }
    ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot() }));
  });

  return {
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const c of wss.clients) if (c.readyState === 1) c.send(data);
    },
    close() { wss.close(); },
  };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/ws.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/ws.js habitat/server/ws.test.js
git commit -m "feat(habitat): servidor WebSocket (snapshot + broadcast + token)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: tmux (capture-pane + ls)

**Files:**
- Create: `habitat/server/tmux.js`
- Test: `habitat/server/tmux.test.js`

**Interfaces:**
- Produces:
  - `capturePane(name, lines, exec)` → `Promise<string>`. `exec` inyectable (default un wrapper de `child_process.execFile`) para testear sin tmux. Devuelve las últimas `lines` líneas; si falla, `''`.
  - `listSessions(exec)` → `Promise<string[]>`. Parsea `tmux ls -F '#{session_name}'`. Si falla (no hay server tmux), `[]`.

- [ ] **Step 1: Escribir los tests**

`habitat/server/tmux.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePane, listSessions } from './tmux.js';

const fakeExec = (out, err) => (file, args) => Promise.resolve(err ? Promise.reject(err) : out)
  .then((v) => v);

test('capturePane devuelve las últimas N líneas', async () => {
  const exec = async () => 'l1\nl2\nl3\nl4\nl5\n';
  const out = await capturePane('sess', 2, exec);
  assert.equal(out, 'l4\nl5');
});

test('capturePane ante error devuelve cadena vacía', async () => {
  const exec = async () => { throw new Error('no tmux'); };
  assert.equal(await capturePane('sess', 5, exec), '');
});

test('listSessions parsea nombres', async () => {
  const exec = async () => 'api\nweb\ninfra\n';
  assert.deepEqual(await listSessions(exec), ['api', 'web', 'infra']);
});

test('listSessions ante error devuelve []', async () => {
  const exec = async () => { throw new Error('no server'); };
  assert.deepEqual(await listSessions(exec), []);
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: FAIL — `Cannot find module './tmux.js'`.

- [ ] **Step 3: Implementar tmux.js**

`habitat/server/tmux.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export async function capturePane(name, lines, exec = defaultExec) {
  try {
    const out = await exec('tmux', ['capture-pane', '-p', '-t', name]);
    const arr = String(out).replace(/\n+$/, '').split('\n');
    return arr.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function listSessions(exec = defaultExec) {
  try {
    const out = await exec('tmux', ['ls', '-F', '#{session_name}']);
    return String(out).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/tmux.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/tmux.js habitat/server/tmux.test.js
git commit -m "feat(habitat): integración tmux (capture-pane + ls)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Servidor HTTP (static + endpoint de hooks) y wiring

**Files:**
- Create: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `config` (Task 1), `createStore` (Task 2), `readUsage` (Task 3), `applyEvent` (Task 4), `attachWs` (Task 5), `capturePane` (Task 6).
- Produces: `createApp({ config, store })` → `{ server, hub }` (no llama `listen`; el arranque real lo hace al final del archivo si `import.meta.url` es el entry point).
  - **`POST /hooks`**: valida `Authorization: Bearer <TOKEN>` si `TOKEN` configurado; lee el JSON del body; valida que venga de localhost (`req.socket.remoteAddress` ∈ `127.0.0.1`/`::1`/`::ffff:127.0.0.1`); llama `applyEvent(store, payload, { readUsage, maxContext, now })`; hace `hub.broadcast({type:'session', session: snapshotOf(session)})` y, si hay `fightResult`, también lo emite; responde `204`.
  - **`GET /preview?id=<id>`**: devuelve `{ lines: <texto> }` con `capturePane(session.tmux||session.name, PREVIEW_LINES)`.
  - **`GET /*`**: sirve estáticos de `habitat/web/` (index.html por default). Content-Type básico por extensión.

- [ ] **Step 1: Escribir los tests**

`habitat/server/index.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { createApp } from './index.js';

const config = { PORT: 0, BIND: '127.0.0.1', TOKEN: 'secret', PREVIEW_LINES: 5, MAX_CONTEXT: 200000 };

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

test('POST /hooks sin token -> 401', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/x' }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /hooks con token crea la sesión en el store', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/home/u/api' }),
  });
  assert.equal(res.status, 204);
  assert.equal(store.get('s1').name, 'api');
  server.close();
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Implementar index.js**

`habitat/server/index.js`:

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import config from './config.js';
import { createStore } from './state.js';
import { readUsage } from './transcript.js';
import { applyEvent } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { capturePane } from './tmux.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function snapOf(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => res(b));
    req.on('error', rej);
  });
}

export function createApp({ config, store }) {
  let hub;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/hooks') {
      if (config.TOKEN) {
        const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
        if (hdr !== config.TOKEN) { res.writeHead(401).end(); return; }
      }
      const ip = req.socket.remoteAddress;
      if (!LOCAL.has(ip)) { res.writeHead(403).end(); return; }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const { session, fightResult } = applyEvent(store, payload, {
        readUsage, maxContext: config.MAX_CONTEXT, now: () => Date.now(),
      });
      hub.broadcast({ type: 'session', session: snapOf(session) });
      if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/preview') {
      const s = store.get(url.searchParams.get('id'));
      const lines = s ? await capturePane(s.tmux || s.name, config.PREVIEW_LINES) : '';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lines }));
      return;
    }

    // estáticos
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(WEB, p));
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
  });

  hub = attachWs(server, store, { token: config.TOKEN });
  return { server, get hub() { return hub; } };
}

// arranque real
if (import.meta.url === `file://${process.argv[1]}`) {
  const store = createStore();
  const { server } = createApp({ config, store });
  server.listen(config.PORT, config.BIND, () => {
    console.log(`hábitat en http://${config.BIND}:${config.PORT}`);
  });
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Correr TODA la suite**

Run: `cd habitat && node --test`
Expected: PASS — todos los tests de Tasks 1-7 verdes.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): servidor HTTP (hooks + preview + static) y wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Script de hook + README de configuración

**Files:**
- Create: `habitat/hook/habitat-hook`
- Create: `habitat/README.md`

**Interfaces:**
- Produces: script `habitat-hook` (bash) que lee el JSON del hook por stdin y lo POSTea al servicio con el Bearer token. Se registra en `~/.claude/settings.json` como command hook para los eventos del diseño §5.

- [ ] **Step 1: Crear el script de hook**

`habitat/hook/habitat-hook`:

```bash
#!/usr/bin/env bash
# Lee el JSON del hook por stdin y lo reenvía al servicio hábitat.
# Requiere HABITAT_TOKEN y (opcional) HABITAT_URL en el entorno.
set -euo pipefail
URL="${HABITAT_URL:-http://127.0.0.1:8377/hooks}"
TOKEN="${HABITAT_TOKEN:-}"
payload="$(cat)"
curl -fsS -m 3 -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  --data-binary "$payload" >/dev/null 2>&1 || true
```

- [ ] **Step 2: Hacerlo ejecutable**

Run: `chmod +x habitat/hook/habitat-hook`
Expected: sin salida; `ls -l` muestra `x`.

- [ ] **Step 3: Verificar el script contra el servicio corriendo**

Run (en una terminal arrancar el server, en otra probar):
```bash
cd habitat && HABITAT_TOKEN=test npm start &
sleep 1
echo '{"session_id":"smoke","hook_event_name":"SessionStart","cwd":"/home/u/smoke"}' \
  | HABITAT_TOKEN=test HABITAT_URL=http://127.0.0.1:8377/hooks habitat/hook/habitat-hook
curl -s http://127.0.0.1:8377/preview?id=smoke
```
Expected: el `curl` responde `{"lines":""}` (sesión existe, sin tmux) — confirma que el hook llegó y creó la sesión. Matar el server al terminar (`kill %1`).

- [ ] **Step 4: Escribir el README con la configuración de hooks**

`habitat/README.md` (incluir, además de cómo correr, el snippet exacto de `~/.claude/settings.json`):

```markdown
# Hábitat

Monitor pixel-art de sesiones de Claude Code. Ver `docs/superpowers/specs/2026-06-19-habitat-rpg-design.md`.

## Correr
    cd habitat
    npm install
    HABITAT_TOKEN=<tu-token> npm start
    # GUI en http://127.0.0.1:8377  (bind loopback; exponer solo por VPN)

## Hooks (command hook)
Agregar a `~/.claude/settings.json`. `habitat-hook` debe estar en PATH o usar ruta absoluta.
Exportar `HABITAT_TOKEN` (y `HABITAT_URL` si el server no está en el default) en el entorno del wrapper de arranque.

    {
      "hooks": {
        "SessionStart":     [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "Notification":     [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PreCompact":       [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "Stop":             [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }]
      }
    }

> Verificar contra https://docs.claude.com/en/docs/claude-code/hooks el esquema vigente
> de cada evento y el nombre de campos (`tool_name`, `tool_input.todos`, `transcript_path`).
> `StopFailure` puede no existir como evento separado según versión — en ese caso el error
> llega como `Stop` con un campo de fallo; ajustar `hooks-logic.js` si difiere.
```

- [ ] **Step 5: Commit**

```bash
git add habitat/hook/habitat-hook habitat/README.md
git commit -m "feat(habitat): script de hook (command) + README de config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Frontend — grilla por WebSocket (reemplazo de CAPA MOCK)

**Files:**
- Create: `habitat/web/index.html` (copia de `habitat-prototipo.html`)
- Modify: bloque `CAPA MOCK` dentro de `habitat/web/index.html`

**Interfaces:**
- Consumes: WS del servidor (`snapshot`/`session`/`remove`/`fightResult`), contrato §5+RPG.
- Produces: `SESSIONS` alimentado por WS; `render()`/`sprData()`/`faceFor()`/`pickKey()` intactos.

- [ ] **Step 1: Copiar el prototipo a web/**

Run: `cp habitat-prototipo.html habitat/web/index.html`
Expected: archivo copiado.

- [ ] **Step 2: Localizar el bloque CAPA MOCK**

Run: `grep -n "CAPA MOCK\|let SESSIONS\|b-add\|b-cycle\|setInterval" habitat/web/index.html`
Expected: ver las líneas del bloque mock y los botones demo (referencia: `spec` líneas ~159-258 del prototipo original).

- [ ] **Step 3: Reemplazar la generación mock por el cliente WebSocket**

Sustituir el bloque que define `SESSIONS`, `mkSession`, los listeners de botones demo y el `setInterval`/seed inicial, por el cliente WS. **Mantener** `hash`, `pick`, `pickKey`, `sprData`, `faceFor`, `render`, `STATUS_LABEL`, `SPRITES`, `FACES`, `ACTIONS` y el manejo del drawer. Dejar los botones demo solo si la URL tiene `?demo=1`.

Código del cliente WS (insertar donde estaba la capa mock):

```js
let SESSIONS = [];
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const WS_TOKEN = params.get('token') || '';

function upsertSession(s) {
  const i = SESSIONS.findIndex((x) => x.id === s.id);
  if (i === -1) SESSIONS.push(s); else SESSIONS[i] = s;
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/${WS_TOKEN ? '?token=' + encodeURIComponent(WS_TOKEN) : ''}`;
  const ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') SESSIONS = msg.sessions;
    else if (msg.type === 'session') upsertSession(msg.session);
    else if (msg.type === 'remove') SESSIONS = SESSIONS.filter((s) => s.id !== msg.id);
    else if (msg.type === 'fightResult') { onFightResult(msg); }
    render();
  };
  ws.onclose = () => setTimeout(connectWS, 1500); // reconexión
}

function onFightResult(msg) {
  // Task 10 implementa el overlay de loot en el drawer. Por ahora, no-op seguro.
  if (window.handleFightResult) window.handleFightResult(msg);
}

if (DEMO) {
  // dejar el seed mock original detrás del flag (pegar acá el mock previo si se quiere)
} else {
  connectWS();
}
render();
```

- [ ] **Step 4: Verificar a mano contra el server**

Run:
```bash
cd habitat && HABITAT_TOKEN=test npm start &
sleep 1
echo '{"session_id":"s1","hook_event_name":"SessionStart","cwd":"/home/u/api"}' | HABITAT_TOKEN=test habitat/hook/habitat-hook
echo '{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"crear modelo","status":"in_progress"},{"content":"review","status":"pending"}]}}' | HABITAT_TOKEN=test habitat/hook/habitat-hook
```
Abrir `http://127.0.0.1:8377` en el browser. Expected: aparece un pod `api` en estado `working`. Recargar → el snapshot lo trae de nuevo. `kill %1` al terminar.

- [ ] **Step 5: Commit**

```bash
git add habitat/web/index.html
git commit -m "feat(habitat): front grilla por WebSocket (reemplaza CAPA MOCK)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Frontend — escena de batalla en el drawer

**Files:**
- Modify: `habitat/web/index.html` (sección del drawer + estilos del batalla-mock)
- Reference: `habitat-batalla-mock.html` (fuente del stage, CSS y lógica de animación)

**Interfaces:**
- Consumes: campos RPG de la `Session` (`stamina`, `quest`, `monster`, `combat`) y el mensaje `fightResult`.
- Produces: el drawer renderiza el stage de batalla de la sesión seleccionada; `window.handleFightResult(msg)` muestra el overlay de loot.

- [ ] **Step 1: Portar estilos y markup del stage al drawer**

Copiar al `<style>` de `index.html` las reglas del stage de `habitat-batalla-mock.html` (`.stage, .ground, .fighter, .hero, .mon, .mon.boss, .dmg, .monname, .loot`, keyframes `idle2/idle2b/die/dmgfloat/flinch`). Adaptar el ancho: el drawer es un panel lateral → el `.stage` usa `width:100%` (no 580px fijo) y el `.hero/.mon` se posicionan en %. Reusar el CSS existente, no crear arte nuevo.

- [ ] **Step 2: Construir el stage al abrir el drawer**

En la función que abre el drawer (donde hoy se arma `dinfo` + preview), agregar el stage alimentado por la sesión. Insertar:

```js
function battleHTML(s) {
  const q = s.quest || { total: 0, done: 0 };
  const m = s.monster;
  const stam = Math.max(0, Math.min(100, s.stamina ?? 100));
  const counter = q.total ? `DUNGEON ${q.done + (m ? 1 : 0)}/${q.total}` : 'CAMPAMENTO';
  const monName = m ? (m.label + (m.isBoss ? '  (BOSS)' : '')) : '';
  return `
    <div class="hpwrap">STAMINA (= CONTEXT)
      <div class="hpbar"><div class="hpfill" style="width:${stam}%"></div><div class="hpval">${stam}%</div></div>
    </div>
    <div class="stage" data-id="${s.id}">
      <div class="ground"></div>
      <div class="fighter hero ${s.status === 'working' ? 'atk' : ''}"></div>
      ${m ? `<div class="fighter mon ${m.isBoss ? 'boss' : ''}" data-type="${m.type}"></div>
             <div class="monname">${monName}</div>` : ''}
      <div class="loot" id="drawer-loot"></div>
    </div>`;
}
```

Llamar `battleHTML(s)` al construir el contenido del drawer y asignar los sprites: héroe = `faceFor`/`SPRITES[pickKey(s.name)]` (pose attack si `working`); monstruo = elegir sprite por `m.type` (hash) del set de monstruos embebido. Reusar la convención de `sprData` para los backgrounds.

- [ ] **Step 3: Daño flotante en cada update de combate**

Cuando llega un `session` con `combat.lastDamage` mayor al previo de esa sesión y el drawer de esa sesión está abierto, spawnear el número de daño (portar `spawnDmg` del mock, apuntando al `.mon` del `.stage[data-id=...]`). Guardar el último `lastDamage` visto por id para no repetir.

```js
const lastDmgSeen = {};
function maybeFloatDamage(s) {
  const d = s.combat && s.combat.lastDamage;
  if (d == null) return;
  if (lastDmgSeen[s.id] === s.combat.tokens) return; // mismo acumulado, no repetir
  lastDmgSeen[s.id] = s.combat.tokens;
  const stage = document.querySelector(`.stage[data-id="${s.id}"]`);
  if (stage) spawnDmg(stage, d, s.monster && s.monster.isBoss);
}
```

Llamar `maybeFloatDamage(msg.session)` dentro del handler `type === 'session'` (antes de `render()` si el drawer reusa nodos, o después de reconstruirlo).

- [ ] **Step 4: Overlay de loot con fightResult**

```js
window.handleFightResult = function (msg) {
  const stage = document.querySelector(`.stage[data-id="${msg.id}"]`);
  if (!stage) return;
  const mon = stage.querySelector('.mon');
  if (mon) mon.classList.add('dying');
  const loot = stage.querySelector('#drawer-loot');
  if (!loot) return;
  const r = msg.result;
  loot.innerHTML = `<div class="ttl">★ MONSTRUO VENCIDO ★</div>
    <div class="mn">${r.monster}</div>
    <div class="stat">HP: <b>${r.hp.toLocaleString('es-AR')}</b> tokens · ${r.hits} golpes</div>
    <div class="lootline">LOOT: <span>${r.loot.join(', ')}</span></div>`;
  loot.classList.add('show');
  setTimeout(() => { loot.classList.remove('show'); if (mon) mon.classList.remove('dying'); }, 2600);
};
```

- [ ] **Step 5: Burbuja "te necesita" y flinch de error**

Cuando la sesión del drawer está en `waiting`, agregar la clase `needs` al contenedor (porta `.bubble`/`.pod.needs` del mock). Cuando llega un `session` con `status==='error'` para el drawer abierto, agregar `flinch` al `.hero` por 700ms (porta `@keyframes flinch`).

- [ ] **Step 6: Verificación manual end-to-end**

Run:
```bash
cd habitat && HABITAT_TOKEN=test npm start &
sleep 1
H="HABITAT_TOKEN=test habitat/hook/habitat-hook"
echo '{"session_id":"s1","hook_event_name":"SessionStart","cwd":"/home/u/api"}' | eval $H
echo '{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"tests de auth","status":"in_progress"},{"content":"review","status":"pending"}]}}' | eval $H
echo '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash"}' | eval $H
echo '{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"tests de auth","status":"completed"},{"content":"review","status":"in_progress"}]}}' | eval $H
```
Abrir `http://127.0.0.1:8377`, clic en el pod `api`. Expected: drawer con stage, monstruo "tests de auth", contador de dungeon, y al completar el todo aparece el overlay de loot. `kill %1` al terminar.

- [ ] **Step 7: Commit**

```bash
git add habitat/web/index.html
git commit -m "feat(habitat): escena de batalla en el drawer (stamina/daño/loot)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Criterios de aceptación (verificación final, §13 del spec base)

- [ ] Dos sesiones tmux con claude → dos pods con personaje y proyecto/rama.
- [ ] Tool use → pod pasa a "trabajando" con la acción.
- [ ] `Notification` → pod "te necesita" (salto + anillo coral + globo).
- [ ] Resolver y `Stop` → vuelve a "quieta" (o "lista" si dungeon completo).
- [ ] `SessionEnd` → "caída".
- [ ] Sin token → hook y WS rechazados.
- [ ] Clic en pod → preview real de tmux + escena de batalla.
- [ ] Recargar → snapshot completo y consistente.
- [ ] Correr `cd habitat && node --test` → toda la suite verde.
