# Rediseño del spawn de monstruos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar el spawn de monstruos del uso de `TodoWrite` para que las sesiones sin todos tengan un monstruo aleatorio por turno que nace al mandar un prompt y muere al terminar el turno.

**Architecture:** Dos fuentes de monstruo distinguidas por un campo `source`. Los monstruos de quest (`source: 'todo'`) mantienen la lógica actual (nacen/mueren por todos y sobreviven entre turnos). Los monstruos de turno (`source: 'turn'`) son aleatorios, nacen en `UserPromptSubmit` y mueren en `Stop`, soltando loot solo si hubo pelea. La regla de prioridad: si hay un monstruo de quest activo, el monstruo de turno no lo pisa.

**Tech Stack:** Node.js (ESM), `node:test` + `node:assert/strict`. Sin dependencias nuevas.

## Global Constraints

- Runner de tests: `node --test`, ejecutado desde el directorio `habitat/`.
- `Math.random()` es válido en el código del server (la restricción de aleatoriedad aplica solo a scripts de Workflow, no a la app).
- El cálculo de daño usa `_lastTotal` (acumulado de tokens del transcript); **nunca** resetearlo al limpiar el combate del turno — solo se resetean `combat` y `_touched`.
- No tocar el cliente: un `type` aleatorio mapea a sprite igual que cualquier otro (`MONSTERS[hash('mon' + type) % len]`).
- El spec de referencia: `docs/superpowers/specs/2026-06-23-monster-spawn-redesign-design.md`.

---

### Task 1: Modelo de monstruo con `source` (`state.js`)

**Files:**
- Modify: `habitat/server/state.js` (función `monsterFromTodos`, ~línea 35; agregar `randomMonster`)
- Test: `habitat/server/state.test.js`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - `monsterFromTodos(todos)` → `{ type, isBoss, label, source: 'todo' } | null` (agrega `source`).
  - `randomMonster(label = '')` → `{ type: string, isBoss: false, label, source: 'turn' }` con `type` aleatorio (prefijo `'t'`).

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/state.test.js`, agregar al final:

```js
import { randomMonster } from './state.js'; // añadir al import existente de ./state.js

test('monsterFromTodos marca source todo', () => {
  const m = monsterFromTodos([{ content: 'modelo', status: 'in_progress' }]);
  assert.equal(m.source, 'todo');
});

test('randomMonster es de turno, no boss, con type aleatorio', () => {
  const a = randomMonster('arreglar login');
  assert.equal(a.source, 'turn');
  assert.equal(a.isBoss, false);
  assert.equal(a.label, 'arreglar login');
  assert.equal(typeof a.type, 'string');
  const b = randomMonster('arreglar login');
  assert.notEqual(a.type, b.type, 'dos llamadas dan types distintos');
});

test('randomMonster sin label usa string vacío', () => {
  assert.equal(randomMonster().label, '');
});
```

Nota: el import de `./state.js` ya existe en la línea 6 del archivo; agregá `randomMonster` a esa lista en vez de duplicar el import.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run (desde `habitat/`): `node --test server/state.test.js`
Expected: FAIL — `randomMonster is not a function` y `m.source` es `undefined`.

- [ ] **Step 3: Implementar los cambios mínimos**

En `habitat/server/state.js`, en `monsterFromTodos` agregar `source: 'todo'` al objeto devuelto:

```js
export function monsterFromTodos(todos = []) {
  const idx = todos.findIndex((t) => t.status === 'in_progress');
  if (idx === -1) return null;
  const label = todos[idx].content || todos[idx].activeForm || '';
  return { type: hashType(label), isBoss: idx === todos.length - 1, label, source: 'todo' };
}
```

Y agregar la nueva función debajo de `monsterFromTodos`:

```js
// Monstruo "de turno": el que aparece cuando la sesión no usa todos. Sprite aleatorio
// (el cliente mapea cualquier `type` a un sprite vía hash), nunca boss. Nace en
// UserPromptSubmit y muere en Stop.
export function randomMonster(label = '') {
  return { type: 't' + Math.random().toString(36).slice(2, 8), isBoss: false, label, source: 'turn' };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run (desde `habitat/`): `node --test server/state.test.js`
Expected: PASS (incluyendo los tests previos de `monsterFromTodos`, que siguen verdes).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/state.js habitat/server/state.test.js
git commit -m "feat(habitat): randomMonster y source en el modelo de monstruo"
```

---

### Task 2: Ciclo de vida del monstruo de turno (`hooks-logic.js`)

**Files:**
- Modify: `habitat/server/hooks-logic.js` (`ensureMonster` ~línea 29; `case 'UserPromptSubmit'` ~línea 144; `case 'Stop'` ~línea 166)
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: `randomMonster(label)` y `monsterFromTodos` de `state.js` (Task 1).
- Produces: comportamiento observable vía `applyEvent` —
  - `UserPromptSubmit` deja `session.monster` con `source: 'turn'` y `type` aleatorio, salvo que haya un monstruo de quest (`source: 'todo'`) activo.
  - `Stop` con monstruo de turno y combate real (`combat.tokens > 0 || combat.hits > 0`) retorna `{ fightResult: { id, result: { monster, hp, hits, loot } } }` y deja `monster = null`; sin combate real no emite `fightResult`.
  - `Stop` con monstruo de quest lo deja vivo (`monster` no se anula).

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/hooks-logic.test.js`, agregar al final:

```js
test('dos UserPromptSubmit seguidos dan monstruos de turno distintos', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const a = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.equal(a.session.monster.source, 'turn');
  const t1 = a.session.monster.type;
  const b = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.notEqual(b.session.monster.type, t1, 'cada turno trae un monstruo distinto');
});

test('Stop tras pelea real (monstruo de turno) emite loot y limpia el monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit', transcript_path: '/t',
    tool_input: { file_path: 'src/Auth.php' } }, deps({ contextTokens: 10, totalTokens: 3000 }));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.ok(r.fightResult, 'debe soltar loot');
  assert.equal(r.fightResult.result.hp, 3000);
  assert.equal(r.fightResult.result.hits, 1);
  assert.deepEqual(r.fightResult.result.loot, ['src/Auth.php']);
  assert.equal(r.session.monster, null, 'el monstruo de turno muere');
});

test('Stop sin pelea (turno trivial) no emite loot', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.fightResult, null, 'turno sin tool uses no suelta loot');
  assert.equal(r.session.monster, null);
});

test('el monstruo de quest sobrevive al Stop', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea larga', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.ok(r.session.monster, 'la quest sigue viva entre turnos');
  assert.equal(r.session.monster.label, 'tarea larga');
  assert.equal(r.session.monster.source, 'todo');
});

test('UserPromptSubmit no pisa un monstruo de quest activo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'arreglar auth', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.equal(r.session.monster.source, 'todo');
  assert.equal(r.session.monster.label, 'arreglar auth');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run (desde `habitat/`): `node --test server/hooks-logic.test.js`
Expected: FAIL — el `Stop` actual hace `s.monster = null` siempre y nunca emite `fightResult`; el `UserPromptSubmit` actual no setea `source` ni varía el `type`.

- [ ] **Step 3: Implementar los cambios**

**3a.** En `habitat/server/hooks-logic.js`, actualizar el import de `./state.js` (línea 2) para incluir `randomMonster`:

```js
import { newSession, questFromTodos, monsterFromTodos, hashType, randomMonster } from './state.js';
```

**3b.** Reemplazar `ensureMonster` (líneas 29-33) por una versión que genera un monstruo de turno aleatorio (red de seguridad para tool uses sin `UserPromptSubmit` previo):

```js
function ensureMonster(s) {
  if (!s.monster) s.monster = randomMonster(s.action || 'trabajando');
}
```

`hashType` deja de usarse acá; si ya no se usa en ningún otro lado del archivo, quitarlo del import. (Verificar con una búsqueda de `hashType` en `hooks-logic.js` antes de quitarlo.)

**3c.** Reemplazar el `case 'UserPromptSubmit'` (líneas 144-149) por:

```js
    case 'UserPromptSubmit': {
      s._resting = false;
      setStatus(s, 'working', 'procesando tu pedido', now);
      // Sin quest activa, cada prompt trae un monstruo de turno nuevo (aleatorio) y
      // arranca un combate limpio. Con quest activa la dejamos correr entre turnos.
      if (s.monster?.source !== 'todo') {
        s.monster = randomMonster(payload.prompt ? String(payload.prompt).slice(0, 80) : 'enemigo');
        s.combat = { hits: 0, tokens: 0 };
        s._touched = new Set();
      }
      break;
    }
```

**3d.** Reemplazar el `case 'Stop'` (líneas 166-171) por:

```js
    case 'Stop': {
      const done = s.quest && s.quest.total > 0 && s.quest.done >= s.quest.total;
      setStatus(s, done ? 'done' : 'idle', done ? 'dungeon cleared' : 'a la espera', now);
      // El monstruo de turno muere al cerrar el turno; si peleó (hubo daño o golpes)
      // suelta loot. El de quest sobrevive entre turnos hasta completarse el todo.
      if (s.monster && s.monster.source === 'turn') {
        if (s.combat.tokens > 0 || s.combat.hits > 0) {
          const loot = s._touched && s._touched.size ? [...s._touched] : [s.monster.label];
          fightResult = { id: s.id, result: {
            monster: s.monster.label, hp: s.combat.tokens, hits: s.combat.hits, loot,
          } };
        }
        s.monster = null;
        s.combat = { hits: 0, tokens: 0 };
        s._touched = new Set();
      }
      break;
    }
```

- [ ] **Step 4: Correr toda la suite y verificar que pasa**

Run (desde `habitat/`): `node --test`
Expected: PASS. En particular los tests previos siguen verdes:
- `working sin todos asigna monstruo genérico estable` — el monstruo creado por `ensureMonster` es estable entre golpes del mismo turno (idempotente).
- `Stop a idle y SessionEnd limpian el monstruo` — el monstruo de turno se anula en `Stop` (ahora además puede emitir loot, pero el test solo verifica `monster === null`).
- `los todos tienen prioridad sobre el monstruo genérico` y `UserPromptSubmit ya muestra monstruo` — siguen válidos.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): monstruo de turno aleatorio que nace en prompt y muere en Stop"
```

---

## Notas de cobertura

- Spec → "siempre el mismo monstruo": resuelto en Task 2/3b (ensureMonster aleatorio) y 3c (turno aleatorio por prompt).
- Spec → "nunca muere": resuelto en Task 2/3d (Stop mata el monstruo de turno).
- Spec → "sprite aleatorio por turno": Task 1 (`randomMonster`) + Task 2/3c.
- Spec → "nunca boss sin todos": `randomMonster` fija `isBoss: false`.
- Spec → "loot solo si hubo pelea real": Task 2/3d (guard `combat.tokens > 0 || combat.hits > 0`).
- Spec → "monstruo de quest sobrevive al Stop": Task 2/3d (rama `source === 'turn'` excluye los de quest) + test dedicado.
- Spec → "prioridad de todos": Task 2/3c (guard `s.monster?.source !== 'todo'`) + test dedicado.
