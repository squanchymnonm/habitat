# Quest Book: diálogo pregunta↔respuesta por quest

## Problema

El Quest Book actual (ver `2026-06-24-quest-book-design.md`) no le sirve al
usuario por dos razones concretas:

1. **Los eventos no dicen nada.** La línea de tiempo del pie loguea solo eventos
   de "sabor RPG/combate" (`quest_completed` con "X dmg · Y golpes",
   `boss_defeated` "vencido: …", `waiting` "te necesita", `error`, `cleared`,
   `dungeon_cleared`). Ninguno guarda el **contenido real** de la sesión.
2. **No hay nada en las quests.** Las quests nacen **solo** de `TodoWrite`. En
   sesiones conversacionales (donde Claude no escribe un plan de todos) no se
   crea ninguna quest → lista vacía.

Lo que el usuario quiere ver: **cada vez que Claude le hizo una pregunta, qué le
preguntó y qué respondió** — el ida y vuelta de la conversación.

## Objetivo

Que el Quest Book registre el **diálogo turno a turno** (lo que dijo Claude al
cerrar cada turno + la respuesta del usuario en el siguiente prompt), agrupado
**dentro de cada quest**, y que **siempre haya al menos una quest** donde ese
diálogo viva, haya o no un plan `TodoWrite`.

## Decisiones de diseño (acordadas en brainstorming)

- **Qué se captura:** el diálogo completo turno a turno (no se intenta "detectar
  preguntas"). Cada intercambio = `{ claude, you, ts }`: el último mensaje de
  texto del asistente al cerrar el turno (`Stop`) + el siguiente prompt del
  usuario (`UserPromptSubmit`).
- **Dónde vive:** el diálogo se agrupa **dentro de cada quest**.
- **Qué es una quest (modelo híbrido):** se mantienen las quests-de-plan
  (`TodoWrite`) como hoy, y se agrega una **quest suelta** por sesión (sentinela)
  que recoge el diálogo cuando **no hay** una quest de plan `in_progress`. Así
  siempre hay una quest con contenido.
- **Fidelidad:** resumen corto + expandible. Se guarda hasta ~600 chars por lado;
  la UI muestra un fragmento y expande al click.
- **Captura:** incremental en los hooks (Approach A), no reparseo del transcript
  al abrir. Se conoce la quest activa **en el momento** del cierre de turno.
- **Eventos de combate:** se **elimina** la sección "Eventos" del pie del libro
  (incluidos errores y "te necesita"). El diálogo dentro de cada quest la
  reemplaza por completo.

## Approach descartado

**Reparsear el transcript al abrir el libro** (`GET /questbook` parsea el JSONL y
extrae los pares user↔assistant). Máxima fidelidad y sin estado de emparejado,
pero el transcript **no conoce las quests**: mapear cada intercambio a su quest
exige correlacionar timestamps (frágil) y depende de que el transcript exista. La
captura incremental conoce la quest activa en el momento del cierre de turno.

## Arquitectura

Se construye sobre la arquitectura existente del Quest Book (campo interno
`_questbook` por sesión, excluido del broadcast WS por el prefijo `_`, persistido
por `serializeSession`, servido on-demand por `GET /questbook`). Nada de eso
cambia.

### Forma de `_questbook` (cambios)

Cada quest gana `dialogue`; los campos de combate por quest se conservan (no se
tocan). La quest suelta es una quest más, con un id sentinela.

```js
{
  synopsis: string,
  quests: [{
    id: string,                // content del todo, o '__session__' (quest suelta)
    title: string,             // content del todo, o la sinopsis (quest suelta)
    status: 'pending' | 'in_progress' | 'completed',
    loose: boolean,            // true solo para la quest suelta de la sesión
    originPrompt: string,
    claudeSummary: string,     // se mantiene (no se rompe), pero el diálogo lo supera
    monster: string | null,
    damage: number,
    hits: number,
    since: number,
    dialogue: [{               // NUEVO
      claude: string,          // texto del asistente al cerrar el turno (~600)
      you: string,             // prompt del usuario en respuesta (~600), '' si pendiente
      ts: number
    }]
  }],
  events: []                   // deja de poblarse; el campo queda por compat de payload
}
```

Notas:
- La quest suelta usa `id: '__session__'` (no colisiona con ningún `content` de
  todo) y `loose: true`. Su `status` arranca `in_progress` y no se "completa".
- `events` deja de poblarse. Se mantiene el campo en el payload (array vacío) para
  no romper consumidores; los tipos del cliente lo marcan opcional/deprecado.

### Módulo `questbook.js` (funciones puras, nuevas/cambiadas)

- `ensureLooseQuest(book, ctx): Quest` — devuelve la quest suelta; la crea si no
  existe (`id: '__session__'`, `title: book.synopsis || 'Sesión'`,
  `status: 'in_progress'`, `loose: true`, `dialogue: []`, demás campos como
  `upsertQuests`). `ctx = { now }`.
- `activeQuestId(book): string | null` — devuelve el `id` de la primera quest de
  plan con `status === 'in_progress'` (la que recibe el diálogo); `null` si no
  hay → el llamador cae en la quest suelta.
- `openExchange(book, questId, claudeText, ctx): { questId, index } | null` —
  agrega `{ claude: trunc(claudeText, 600), you: '', ts: now }` a
  `quest.dialogue` y devuelve un puntero `{ questId, index }`; respeta el cap
  (ver abajo). `null` si no hay texto o no existe la quest.
- `closeExchange(book, ptr, youText): void` — setea `you` (truncado a 600) en el
  intercambio apuntado por `ptr`, si sigue existiendo y está vacío.
- Cap: el total de intercambios por sesión se limita a los **últimos 100**
  (sumando todas las quests). Implementación simple: al `openExchange`, si la
  suma supera 100, se descarta el intercambio más viejo (de la quest más vieja
  con diálogo). `pushEvent`/`completeQuest`/`setClaudeSummary`/`upsertQuests`/
  `setSynopsis`/`emptyBook` se mantienen (combate y plan siguen funcionando).

`questbook.js` sigue sin importar nada del server (pura, sin I/O).

### Captura (`hooks-logic.js`)

`ensure()` no cambia (ya inicializa `_questbook` y `_currentPrompt`). Se agrega un
puntero efímero `s._openExchange` (no se persiste como dato de dominio; vive en la
sesión como `_touched`).

- **`Stop`**: además de la lógica actual de estado/combate, capturar el cierre de
  turno:
  ```
  const questId = activeQuestId(s._questbook)
                  ?? ensureLooseQuest(s._questbook, { now: now() }).id
  const claudeText = deps.readLastAssistantText(payload.transcript_path, 600)
  s._openExchange = openExchange(s._questbook, questId, claudeText, { now: now() })
  ```
  Si `claudeText` es vacío, `openExchange` devuelve `null` y no se abre nada.
- **`UserPromptSubmit`**: además de fijar `_currentPrompt`/sinopsis, cerrar el
  intercambio pendiente:
  ```
  if (s._openExchange) {
    closeExchange(s._questbook, s._openExchange, s._currentPrompt)
    s._openExchange = null
  }
  ```
  El **primer** prompt de la sesión no tiene intercambio abierto: solo fija
  sinopsis/origen (y, vía `ensureLooseQuest` en el primer `Stop`, la quest suelta
  toma esa sinopsis como título).
- **`TodoWrite`** (`handleTodoWrite`): sin cambios respecto del diseño actual
  (sigue haciendo `upsertQuests`, `completeQuest`, etc.). El diálogo de los turnos
  mientras una quest está `in_progress` cae en esa quest vía `activeQuestId`.
- **Se quitan los `pushEvent(...)`** de combate/estado (`quest_completed`,
  `boss_defeated`, `dungeon_cleared`, `waiting`, `error`, `cleared`). La lógica de
  combate/`fightResult`/estado **no cambia**; solo se deja de loguear al libro.

### `readLastAssistantText` (`transcript.js`)

Se le agrega un parámetro de corte opcional: `readLastAssistantText(path, max =
400)`; se llama con `600` desde el `Stop`. El comportamiento de degradación
(archivo inexistente/vacío → `''`) no cambia.

## UI (cliente)

### `QuestBook.vue`

- **Tapa**: igual (sinopsis + progreso `X/Y`). `X/Y` cuenta **solo quests de
  plan** (`!q.loose`): completadas / total de quests de plan. La quest suelta no
  entra al contador.
- **Lista de quests**: incluye la quest suelta (mostrada como una quest más; su
  ícono puede ser el de `in_progress`). Al expandir una quest, su detalle muestra
  el **diálogo**:
  - Por cada intercambio (en orden cronológico):
    - `🗨️ Claude:` + texto, truncado visualmente a ~2 líneas con "ver más" que
      expande/colapsa ese intercambio (estado local por intercambio).
    - `✍️ Vos:` + tu respuesta debajo (si `you` está vacío → "esperando tu
      respuesta…").
  - Se conservan, debajo del diálogo, los campos existentes que tengan valor
    (`originPrompt`, `monster`/`damage`/`hits`). `claudeSummary` se puede ocultar
    si hay diálogo (lo supera), pero no se elimina del modelo.
  - Estado vacío por quest: si `dialogue` está vacío → "sin diálogo todavía".
- **Se elimina la sección "Eventos"** del pie (template + estilos asociados).

### Tipos (`types.ts`)

```ts
export interface QuestExchange { claude: string; you: string; ts: number }
export interface Quest {
  id: string; title: string;
  status: 'pending' | 'in_progress' | 'completed';
  loose?: boolean;
  originPrompt: string; claudeSummary: string;
  monster: string | null; damage: number; hits: number; since: number;
  dialogue: QuestExchange[];
}
// QuestEvent queda como tipo deprecado; QuestBook.events es opcional.
export interface QuestBook { synopsis: string; quests: Quest[]; events?: QuestEvent[]; }
```

`useQuestBook` no cambia.

## Testing

- **`questbook.js` (puras):** `ensureLooseQuest` crea una vez y reusa;
  `activeQuestId` devuelve la quest de plan `in_progress` o `null`;
  `openExchange` agrega con `you` vacío y respeta el cap de 100 (descarta el más
  viejo); `closeExchange` rellena `you` truncado y no pisa uno ya cerrado.
- **`readLastAssistantText`:** el parámetro `max` corta a la longitud pedida;
  default sigue en 400; archivo inexistente → `''`.
- **Integración (`hooks-logic`):**
  - `UserPromptSubmit → Stop → UserPromptSubmit` (sin TodoWrite) deja un
    intercambio en la quest suelta (`__session__`) con `claude` y `you` llenos, y
    el título de la quest suelta = sinopsis.
  - Con un `TodoWrite` que pone una quest `in_progress`, el intercambio del turno
    siguiente cae en esa quest, no en la suelta.
  - Ya **no** se generan eventos de combate en `_questbook.events`.
- **Cliente:** typecheck/build + smoke manual del render (como el resto). Ajustar
  `useQuestBook.test` / cualquier test que asuma la sección de eventos.

## Fuera de alcance

- Reparsear el transcript completo (Approach B descartado).
- Cambiar la lógica de combate, orbe, `quest: { total, done }` o `fightResult`.
- Detección semántica de "esto fue una pregunta" (se guarda todo el diálogo).
- Mostrar el diálogo en el rail/cards (solo en el panel de detalle).
