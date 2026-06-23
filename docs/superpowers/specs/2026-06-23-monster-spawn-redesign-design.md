# Rediseño del spawn de monstruos

**Fecha:** 2026-06-23
**Estado:** aprobado

## Problema

La mecánica de monstruos está acoplada al uso de `TodoWrite`. Cuando una sesión
no usa todos (lo común en charlas o tareas cortas), pasa esto:

- **Siempre el mismo monstruo.** El fallback de `ensureMonster` (`hooks-logic.js`)
  crea el monstruo con `type: hashType(s.name || s.id)`, que es constante para
  toda la sesión → el sprite nunca cambia.
- **Nunca muere.** La lógica de muerte vive solo en `handleTodoWrite` (cuando
  sube `quest.done`). Sin todos, ese evento no se dispara nunca, así que el
  monstruo es inmortal; solo se esfuma en `Stop`/`SessionEnd`.

## Modelo: dos fuentes de monstruo, con prioridad a los todos

|                  | **Monstruo de quest (con todos)**            | **Monstruo de turno (sin todos)**        |
| ---------------- | -------------------------------------------- | ---------------------------------------- |
| Nace             | al pasar un todo a `in_progress`             | al mandar un prompt (`UserPromptSubmit`) |
| Identidad/sprite | `hash(label del todo)` (estable)             | **aleatoria** por turno (`Math.random`)  |
| Boss             | sí, si es el último todo                      | nunca                                    |
| Muere            | al completarse el todo                         | al terminar el turno (`Stop`)            |
| Loot             | al completar el todo (ya funciona)            | en `Stop`, **solo si hubo pelea real**   |

**Regla de prioridad:** si hay un monstruo de quest activo, manda él. El monstruo
de turno solo aplica cuando no hay un monstruo de quest en curso.

## Cambios

### 1. Marcar el origen del monstruo — `state.js`

- `monsterFromTodos` agrega `source: 'todo'` al monstruo que crea.
- Nueva función `randomMonster(label)`:

  ```js
  export function randomMonster(label = '') {
    return { type: 't' + Math.random().toString(36).slice(2, 8), isBoss: false, label, source: 'turn' };
  }
  ```

  El `type` aleatorio mapea a un sprite en el cliente igual que cualquier otro
  (`MONSTERS[hash('mon' + type) % len]`), sin cambios en el front.

### 2. Reemplazar el fallback constante — `hooks-logic.js`

`ensureMonster` deja de usar `hashType(s.name)` y pasa a generar un monstruo de
turno aleatorio (vía `randomMonster`). Sigue siendo idempotente: solo crea si no
hay monstruo.

### 3. `UserPromptSubmit`

- Si NO hay monstruo de quest activo (`s.monster?.source !== 'todo'`):
  - spawnear un monstruo de turno aleatorio,
  - resetear el combate del turno: `combat = { hits: 0, tokens: 0 }`, `_touched`
    vacío. **`_lastTotal` se mantiene** (es el acumulado de tokens del transcript
    que se usa para el diff de daño).
- Si hay monstruo de quest activo, dejarlo intacto.

### 4. `Stop` (hoy hace `s.monster = null` siempre)

- Si el monstruo es **de turno** (`source === 'turn'`):
  - si hubo daño real (`combat.tokens > 0 || combat.hits > 0`), emitir
    `fightResult` con el overlay de loot (monstruo, HP = tokens, golpes, archivos
    tocados como loot; si `_touched` está vacío, loot = `[label]`);
  - luego `s.monster = null` y resetear combate.
- Si el monstruo es **de quest** (`source === 'todo'`): **dejarlo vivo**. Persiste
  entre turnos hasta que se complete el todo.
  - Cambio menor al caso con-todos: hoy el monstruo de quest se esfuma en cada
    `Stop` y se recrea, lo que produce un parpadeo. Dejarlo vivo lo arregla.
- El cálculo de `done`/"dungeon cleared" del estado se mantiene igual.

### 5. Sin cambios

- `handleTodoWrite`: la muerte por todo completado ya funciona.
- Cliente: el `type` aleatorio mapea a sprite igual que cualquier otro.

## Tests (`hooks-logic.test.js`)

- Turno sin todos → nace monstruo con `source: 'turn'`.
- Dos `UserPromptSubmit` seguidos → tipos de monstruo distintos.
- `Stop` tras tool uses con daño → emite `fightResult` y deja `monster = null`.
- `Stop` sin tool uses (turno trivial) → no emite `fightResult`.
- Turno con `TodoWrite` → monstruo `source: 'todo'` y **sobrevive** al `Stop`.
- `UserPromptSubmit` con monstruo de quest activo → no lo pisa con uno de turno.

## Edge cases

- `PostToolUse` sin `UserPromptSubmit` previo (sesión reanudada): `ensureMonster`
  actúa de red de seguridad y spawnea un monstruo de turno aleatorio.
- Mezcla turno→quest: arranca turno (monstruo de turno), llega `TodoWrite` y lo
  reemplaza por uno de quest (`source: 'todo'`), que ya sobrevive a los `Stop`
  siguientes hasta completarse.
- Al completarse el último todo, `handleTodoWrite` emite loot y deja
  `monster = null`; el `Stop` posterior no tiene nada que matar.
