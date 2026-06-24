# Quest Book por sesión

## Problema

Hoy no hay forma de saber, de un vistazo, de qué se trató una sesión: qué tasks
se hicieron, cuáles quedaron pendientes, qué pasó de importante. Los datos
existen (los `TodoWrite` traen la lista completa de tasks con `content`/`status`,
y hay eventos ricos de combate/errores/clear), pero `questFromTodos` los reduce a
`{ total, done }` y descarta el detalle.

## Objetivo

Un **Quest Book** por sesión: un libro/diario RPG, abrible desde el panel de
detalle, que registra de forma acumulativa las quests (tasks) hechas y
pendientes, deja leer el contexto de cada quest, y muestra una línea de tiempo de
los eventos importantes. Es "un elemento RPG más", con estética pergamino/ninja.

## Decisiones de diseño (acordadas en brainstorming)

- **Quest = task individual**, y el libro es un **log acumulativo**: si una task
  se completó y luego Claude reescribió el plan sin ella, igual queda registrada.
- **Contexto por quest:** prompt de origen + resumen de Claude (texto del
  asistente desde el transcript) + monstruo vencido + daño/golpes. (Los archivos
  tocados quedan **fuera de alcance** — serán el futuro *inventario*.)
- **Eventos importantes:** quest completada, boss vencido/loot, errores y "te
  necesita", `/clear` (memoria despejada) y dungeon cleared.
- **Encabezado del libro:** primer prompt de la sesión (sinopsis) + progreso
  acumulativo `X/Y quests`.
- **UI:** libro **overlay** (Layout B) — botón `📖` en el header del panel abre un
  libro pergamino flotante sobre la terminal; cierra con `✕` y `Esc`. La terminal
  sigue viva atrás.
- **Assets ninja:** se copian a `habitat/client/public/assets/ui/` (nuestra
  carpeta) y se usan desde ahí.

## Arquitectura

### Almacenamiento: campo interno + endpoint on-demand

El libro puede ser pesado (texto del asistente, eventos). Para no inflar el
broadcast WS:

- Se guarda como **campo interno `_questbook`** en el objeto sesión.
  - Por el prefijo `_`, `stripInternal` (state.js) lo **excluye** del snapshot y
    del broadcast WS → la terminal y las cards no lo cargan.
  - `serializeSession` (state.js) lo **persiste** a disco igual que `_touched`
    (sobrevive reinicio del server). Es un objeto plano: el round-trip JSON de
    `reviveSession` lo conserva sin tratamiento especial.
- Se sirve **a pedido** por `GET /questbook?id=<session>` (con `authorize()`),
  que el cliente llama **solo al abrir el 📖**.

Lo "liviano" no cambia: `quest: { total, done }` sigue en la sesión (alimenta
orbe/card y la lógica "dungeon cleared" del handler `Stop`). El libro muestra su
propio progreso **acumulativo** desde `_questbook.quests`. Es decir: la card
refleja el plan actual; el libro, la historia completa.

### Forma de `_questbook`

```js
{
  synopsis: string,            // primer prompt de la sesión (truncado ~200)
  quests: [{
    id: string,                // identidad = content del todo
    title: string,             // content del todo
    status: 'pending' | 'in_progress' | 'completed',
    originPrompt: string,      // prompt activo cuando apareció la quest
    claudeSummary: string,     // fragmento del texto del asistente (transcript), '' si no hay
    monster: string | null,    // label del monstruo vencido (al completarse)
    damage: number,            // hp = tokens acumulados (al completarse)
    hits: number,              // golpes (al completarse)
    since: number              // timestamp de aparición
  }],
  events: [{
    type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared',
    label: string,             // texto corto para mostrar
    detail: string,            // detalle opcional ('' si no aplica)
    ts: number
  }]                           // cap: los 50 más recientes
}
```

### Módulo nuevo `habitat/server/questbook.js` (funciones puras)

Concentra la lógica de acumulación/derivación para no inflar `hooks-logic.js` y
poder testear aislado. Funciones (firmas exactas):

- `emptyBook(): QuestBook` — `{ synopsis: '', quests: [], events: [] }`.
- `setSynopsis(book, prompt): void` — fija `synopsis` solo si está vacío
  (truncado a 200), no lo pisa.
- `upsertQuests(book, todos, ctx): void` — `ctx = { originPrompt, now }`. Por cada
  todo (`{ content, status }`): si no existe una quest con `id === content`, la
  agrega (`status`, `originPrompt`, `since: now`, `claudeSummary: ''`,
  `monster: null`, `damage: 0`, `hits: 0`); si existe, actualiza `status`. Nunca
  borra quests.
- `setClaudeSummary(book, questId, text): void` — setea `claudeSummary` (truncado
  a 400) en la quest `questId` si está vacío.
- `completeQuest(book, questId, { monster, damage, hits }): void` — estampa
  `monster`/`damage`/`hits` y `status: 'completed'` en esa quest (si existe).
- `pushEvent(book, event): void` — agrega a `events` y recorta a los últimos 50.

`questbook.js` no importa nada del server (pura, sin I/O).

### Captura (en `hooks-logic.js`, delegando a `questbook.js`)

`ensure()` inicializa `s._questbook = emptyBook()` y `s._currentPrompt = ''` si no
existen (junto a `s._touched`).

- **`UserPromptSubmit`**: `s._currentPrompt = payload.prompt` (truncado a 200) y
  `setSynopsis(s._questbook, payload.prompt)`.
- **`TodoWrite`** (en `handleTodoWrite`): `upsertQuests(s._questbook, todos,
  { originPrompt: s._currentPrompt, now: now() })`. Cuando una quest pasa a
  `in_progress` (la que detecta `monsterFromTodos`), si su `claudeSummary` está
  vacío: `setClaudeSummary(..., readLastAssistantText(payload.transcript_path))`.
  Cuando `handleTodoWrite` arma el `fightResult` por una quest completada: la
  quest completada se identifica por `prevLabel` (el label del monstruo previo =
  el `content` del todo que estaba `in_progress` = su `id` en el libro). Entonces
  `completeQuest(book, prevLabel, { monster: prevLabel, damage: hp, hits })` y
  `pushEvent({ type: 'quest_completed', ... })`.
- **`Stop`**: si el `fightResult` de turno tiene loot → `pushEvent({ type:
  'boss_defeated' | 'quest_completed' con loot })`. Si "dungeon cleared" →
  `pushEvent({ type: 'dungeon_cleared' })`.
- **`StopFailure`**: `pushEvent({ type: 'error', label: payload.message })`.
- **`Notification`**: `pushEvent({ type: 'waiting', label: payload.message })`.
- **`/clear`** (rama `SessionStart` source `clear`): el `_questbook` se
  **preserva** (no se resetea junto a combat/touched) y se agrega `pushEvent({
  type: 'cleared' })`. Es la bitácora continua de la sesión.

### Resumen de Claude desde el transcript

Helper nuevo `readLastAssistantText(path): string` en
`habitat/server/transcript.js` (el módulo que ya parsea el transcript con
`readUsage`), **inyectado por `deps`** en `hooks-logic.js` igual que `readUsage`
(index.js lo agrega al objeto `deps`; `hooks-logic.js` lo toma de
`deps.readLastAssistantText`):
- Lee `transcript_path` (JSONL, una entrada por línea) de forma acotada.
- Encuentra la **última** entrada de rol `assistant` con contenido de texto y
  devuelve ese texto (truncado a 400 chars).
- Si el archivo no existe, está vacío, o no hay texto de asistente → devuelve
  `''` (degradación silenciosa; nunca tira).

## UI (cliente)

### Endpoint y datos

- `GET /questbook?id=<session>` → `200` con el `_questbook` de la sesión, o `{}`
  (libro vacío) si la sesión no tiene libro; `404` si no existe la sesión;
  `401/403` por `authorize()`.
- **`useQuestBook(id)`** (composable nuevo): hace el GET con token (como los demás
  fetch del cliente) **al abrir** el libro; expone `loading`, `error`, `book`.

### Componentes

- **`QuestBook.vue`** (nuevo): overlay del libro (Layout B), fondo
  `assets/ui/scroll-bg.png`. Tres zonas:
  1. **Tapa**: `synopsis` + progreso acumulativo `X/Y` (Y = `quests.length`,
     X = completadas).
  2. **Quests**: lista; cada item con icono por estado
     (`completed`→`assets/ui/quest-done.png`, `pending`→`assets/ui/quest-pending.png`,
     `in_progress`→icono pendiente con glow/pulso CSS). Cada quest **se expande**
     y muestra `originPrompt`, `claudeSummary`, y `monster` + `damage`/`hits`
     cuando existen.
  3. **Eventos**: línea de tiempo al pie (label + detail + hora relativa).
  - Estados vacíos: si no hay quests, mensaje "sin quests registradas"; idem
    eventos.
- **`DetailPanel.vue`**: botón `📖` (`assets/ui/book.png`) en el header que abre/
  cierra el overlay (estado local `bookOpen`). Cierra con `✕` y con `Esc`. Solo
  visible cuando hay sesión seleccionada.

### Tipos (`types.ts`)

```ts
export interface Quest {
  id: string; title: string;
  status: 'pending' | 'in_progress' | 'completed';
  originPrompt: string; claudeSummary: string;
  monster: string | null; damage: number; hits: number; since: number;
}
export interface QuestEvent {
  type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared';
  label: string; detail: string; ts: number;
}
export interface QuestBook { synopsis: string; quests: Quest[]; events: QuestEvent[]; }
```

## Assets

Los 4 PNG se **copian a `habitat/client/public/assets/ui/`** (commiteados) y se
**registran en `habitat/scripts/import-assets.sh`** (para que sobrevivan a un
`rm -rf`/regen). La UI los referencia desde `assets/ui/…`, nunca del pack externo.

| destino (`public/assets/ui/`) | fuente (pack "Ninja Adventure - Asset Pack") |
|---|---|
| `scroll-bg.png`     | `Ui/Receptacle/Receptacle Rectangle/BackgroundScroll.png` |
| `book.png`          | `Items/Object/Book.png` |
| `quest-done.png`    | `Ui/Skill Icon/Items & Weapon/Scroll.png` |
| `quest-pending.png` | `Ui/Skill Icon/Items & Weapon/ScrollDisabled.png` |

## Testing

- **Server (funciones puras, `questbook.test.js`):** `emptyBook`; `setSynopsis`
  fija una sola vez; `upsertQuests` agrega nuevas, actualiza estado, no borra al
  desaparecer del plan; `setClaudeSummary` trunca y no pisa; `completeQuest`
  estampa monster/damage/hits + status; `pushEvent` agrega y respeta el cap de 50.
- **Server (`readLastAssistantText`):** con un transcript fixture devuelve el
  último texto de asistente truncado; archivo inexistente/vacío → `''`.
- **Server (endpoint):** `GET /questbook` con auth, `404` si no existe, payload
  correcto para una sesión con libro.
- **Server (integración hooks):** una secuencia
  UserPromptSubmit→TodoWrite(pending→in_progress→completed) deja el libro con la
  quest acumulada, su `originPrompt`, y un evento `quest_completed`.
- **Cliente:** `useQuestBook` (loading/empty/error y URL con token) y el mapeo
  estado→icono. El render de `QuestBook.vue` se valida con typecheck/build +
  smoke manual (como la terminal).

## Fuera de alcance

- Archivos tocados por quest (futuro *inventario*).
- Cambiar el `quest: { total, done }` existente o la lógica de combate/orbe.
- Mostrar el libro en el rail/cards (solo en el panel de detalle).
