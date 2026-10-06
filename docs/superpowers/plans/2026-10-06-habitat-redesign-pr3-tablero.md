# Rediseño de Habitat — PR 3: tablero, celular y nueva sesión — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar el modo tablero (`#/board`, columnas por estado), el modo celular (lista de sesiones como pantalla principal y foco a pantalla completa con barra inferior de herramientas y botón volver) y el `NewSessionDialog` (Dialog, Sheet inferior en celular) que reemplaza a `SpawnMenu`, más el atajo `g b` / `g f`.

**Architecture:** El reparto de sesiones en columnas es una función pura (`boardColumns`) con su test; `BoardView` la consume y `BoardCard` navega a `#/s/:id`. En celular se agrega la ruta `#/sessions` (la lista); `FocusRoute` redirige ahí cuando está en `#/` en modo phone, y el foco (`#/s/:id`) se muestra a pantalla completa sin `SessionNav`, con la barra de herramientas abajo. `NewSessionDialog` reusa `useProjects` (`projects`, `spawn`, `error`) y se abre desde el botón de la `TopBar`. Los atajos globales viven en `useGlobalShortcuts`, montado en `AppShell`, y reusan las guardas de foco de `useFocusShortcuts`.

**Tech Stack:** Vue 3.5, Pinia, vue-router 4, shadcn-vue 2.4.0 (Reka UI: Dialog, Sheet, Input), Tailwind v4 con tokens semánticos, lucide-vue-next, vitest + happy-dom + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-10-05-habitat-redesign-design.md` (§2 Barra superior, SessionNav phone, Modo foco/Celular, Tablero, Nueva sesión; §5; §6 fila PR 3; §7).

## Global Constraints

- Los componentes nuevos usan **solo tokens semánticos** (`bg-background`, `bg-surface`, `bg-surface-raised`, `text-text`, `text-muted`, `border-border`, `bg-accent`, `text-accent-foreground`, `{bg,text,border}-state-*`, `text-danger`, `bg-danger`, `font-ui`, `font-mono`, `font-display`, `rounded-[var(--radius)]`), nunca colores literales. Un color que viene de datos (color del proyecto) puede ir por `:style`.
- **Preflight de Tailwind sigue desactivado** (se activa en el PR 4). Todo `<button>`, `<a>`, `<input>` nuevo lleva estilos explícitos: `border-0` (o `border border-<token>`: un color de borde sin la utilidad de ancho no dibuja nada), `bg-transparent` o fondo con token, color con token, `font-[inherit]`, `cursor-pointer`; links `no-underline`; `<p>`, `<h*>`, `<ul>` con `m-0` (o margen explícito) y `<ul>` con `list-none p-0`.
- **Tamaño táctil:** áreas de al menos 40×40 px (`min-h-10`, y `min-w-10` en botones de sólo ícono) en portrait y phone (spec §5). Los controles nuevos de este PR las tienen siempre.
- Textos de UI y comentarios en español rioplatense.
- Todo acceso a `localStorage` va en try/catch.
- No cambia el contrato HTTP/WS ni el server.
- `tsconfig` usa `lib: ES2020`: nada de `Array.prototype.at()`.
- Columnas del tablero, en este orden: **Te necesita** (`waiting`, `error`), **Trabajando** (`working`), **Lista** (`done`), **Quietas** (`idle`, `offline`; las `offline` atenuadas con badge "caída"). Columnas vacías colapsadas a su encabezado con el contador. En portrait y phone las columnas se apilan en vertical.
- Atajos: `g` `b` va al tablero y `g` `f` al foco; se desactivan en la terminal, en inputs y dentro de diálogos (mismas guardas que `[` `]`).

## Rulings sobre el spec

- **Lista de celular en su propia ruta (`#/sessions`).** La sincronización ruta↔selección del PR 1 reemplaza `#/` por `#/s/<seleccionada>` en cuanto hay selección, así que la lista no puede vivir en `#/`. En phone, `FocusRoute` en `#/` redirige a `#/sessions`; fuera de phone, `#/sessions` redirige a `#/`. El botón volver del foco en celular va a `#/sessions`.
- **Botón tablero/foco:** un solo botón en la `TopBar` que alterna (`#/board` ↔ última sesión en foco, o `#/`). En phone también existe (el tablero en celular apila columnas).
- **Proyecto en `NewSessionDialog`:** lista de botones (como el paso 1 del `SpawnMenu`), no un Select: con pocos proyectos es un toque menos y es táctil. Personaje: grilla de avatares respetando `project.chars` (si está vacío, todos los `CHARACTERS`), más "Auto".
- **Descartar "te necesita" desde la tarjeta:** la tarjeta incluye el `SessionAvatar`, cuya luz ya descarta (PR 1); no se agrega otro botón.
- **Pendientes de PRs anteriores que entran acá** (se tocan los mismos componentes): estado en texto en la barra lateral expandida (spec §SessionNav), ocultar la navegación de sesiones cuando no hay sesiones, y la rama del header cortada sin "…" en celular.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/components/board/boardColumns.ts` (+test) | reparto puro de sesiones en columnas |
| `src/components/board/BoardView.vue`, `BoardColumn.vue`, `BoardCard.vue` (+test) | tablero |
| `src/views/BoardRoute.vue` | ruta `#/board` |
| `src/router.ts` (mod) | rutas `/board`, `/sessions` |
| `src/components/shell/TopBar.vue` (mod) | botón tablero/foco y botón nueva sesión |
| `src/composables/useGlobalShortcuts.ts` (+test), `useFocusShortcuts.ts` (mod: exporta guardas) | `g b` / `g f` |
| `src/components/sessions/SessionList.vue` (+test), `src/views/SessionListRoute.vue` | lista de celular |
| `src/views/FocusRoute.vue`, `src/components/shell/AppShell.vue`, `src/components/sessions/SessionNav.vue`, `SessionSidebar.vue` (mod) | modo phone, nav oculta sin sesiones, estado en la barra |
| `src/components/focus/FocusView.vue`, `SessionHeader.vue`, `ToolTabs.vue`, `TerminalPane.vue` (mod) | foco de celular: volver, barra inferior, teclas táctiles |
| `src/components/ui/{sheet,input}/**` (nuevos, shadcn) | primitivas |
| `src/components/session/NewSessionDialog.vue` (+test) | nueva sesión |
| Se eliminan | `src/components/SpawnMenu.vue` y sus reglas en `style.css` |

Comandos: cliente `cd habitat/client && npx vitest run <ruta>`; suite `npx vitest run`; typecheck + build `npm run build`. Server (no cambia; se corre al cerrar): `cd habitat && npm test`.

Branch: `feat/habitat-redesign-tablero`, creada desde `main` actualizado (incluye PR 1 y PR 2).

---

### Task 1: Tablero

**Files:**
- Create: `src/components/board/boardColumns.ts`, `boardColumns.test.ts`, `BoardCard.vue`, `BoardColumn.vue`, `BoardView.vue`, `BoardView.test.ts`, `src/views/BoardRoute.vue`
- Modify: `src/router.ts` (ruta `/board`), `src/router.test.ts` (el caso "/board redirige a /" pasa a "/board muestra el tablero"), `src/components/shell/TopBar.vue` (botón tablero/foco), `src/components/shell/TopBar.test.ts`

**Interfaces:**
- Consumes: `useSessions()` (`list`, `selectedId`), `STATUS_LABEL`, `STATE_TOKEN`, `type Session`, `type Status` (`src/types.ts`), `SessionAvatar` (`src/components/sessions/SessionAvatar.vue`, props `session`, `size?`), `useGoToSession()` (`src/composables/useGoToSession.ts`), `useLayoutMode()` → `{ mode }`.
- Produces:
  - `type ColumnId = 'need' | 'working' | 'done' | 'quiet'`
  - `interface BoardColumnData { id: ColumnId; title: string; sessions: Session[] }`
  - `boardColumns(list: Session[]): BoardColumnData[]` (siempre 4 columnas, en orden; conserva el orden de `list` dentro de cada columna)
  - `<BoardView />`, ruta `/board` con `name: 'board'`.
  - En la `TopBar`, `<button data-test="board-toggle">`: en `#/board` dice "Foco" y va a `/s/<selectedId>` (o `/`); en otra ruta dice "Tablero" y va a `/board`.

- [ ] **Step 1: Tests que fallan**

`src/components/board/boardColumns.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { boardColumns } from './boardColumns'

const s = (id: string, status: string) => ({ id, name: id, project: 'p', branch: '', status, action: '', since: 0, stamina: 100 }) as any

describe('boardColumns', () => {
  it('cuatro columnas en orden, con el estado correcto en cada una', () => {
    const cols = boardColumns([s('a', 'idle'), s('b', 'waiting'), s('c', 'working'), s('d', 'error'), s('e', 'done'), s('f', 'offline')])
    expect(cols.map((c) => c.id)).toEqual(['need', 'working', 'done', 'quiet'])
    expect(cols.map((c) => c.title)).toEqual(['Te necesita', 'Trabajando', 'Lista', 'Quietas'])
    expect(cols[0].sessions.map((x) => x.id)).toEqual(['b', 'd'])
    expect(cols[1].sessions.map((x) => x.id)).toEqual(['c'])
    expect(cols[2].sessions.map((x) => x.id)).toEqual(['e'])
    expect(cols[3].sessions.map((x) => x.id)).toEqual(['a', 'f'])
  })
  it('sin sesiones devuelve las cuatro columnas vacías', () => {
    expect(boardColumns([]).every((c) => c.sessions.length === 0)).toBe(true)
  })
})
```

`src/components/board/BoardView.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {} }) }))
vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import BoardView from './BoardView.vue'
import { useSessions } from '../../stores/sessions'
import { createHabitatRouter, syncSelectionWithRoute } from '../../router'

const s = (id: string, status: string, action = '') => ({ id, name: id, project: 'proj', branch: 'main', status, action, since: 0, stamina: 100 }) as any

async function mountBoard() {
  const store = useSessions()
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push('/board'); await router.isReady()
  const w = mount(BoardView, { global: { plugins: [router] }, attachTo: document.body })
  return { w, router, store }
}

beforeEach(() => { setActivePinia(createPinia()); mode.value = 'landscape' })

describe('BoardView', () => {
  it('cada sesión cae en su columna y la tarjeta muestra nombre, proyecto y acción', async () => {
    useSessions().setAll([s('ezio', 'working', 'Edit'), s('yoshi', 'waiting')])
    const { w } = await mountBoard()
    const need = w.get('[data-test="board-column-need"]')
    expect(need.text()).toContain('yoshi')
    const working = w.get('[data-test="board-column-working"]')
    expect(working.text()).toContain('ezio')
    expect(working.text()).toContain('proj')
    expect(working.text()).toContain('Edit')
    w.unmount()
  })
  it('columnas vacías colapsadas a su encabezado con el contador', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    const done = w.get('[data-test="board-column-done"]')
    expect(done.attributes('data-empty')).toBe('true')
    expect(done.text()).toContain('0')
    expect(done.findAll('[data-test="board-card"]').length).toBe(0)
    w.unmount()
  })
  it('las offline se ven atenuadas con el badge "caída"', async () => {
    useSessions().setAll([s('zelda', 'offline')])
    const { w } = await mountBoard()
    const card = w.get('[data-test="board-column-quiet"] [data-test="board-card"]')
    expect(card.classes()).toContain('opacity-60')
    expect(card.text()).toContain('caída')
    w.unmount()
  })
  it('tocar una tarjeta va al foco de esa sesión', async () => {
    useSessions().setAll([s('ezio', 'working'), s('yoshi', 'waiting')])
    const { w, router, store } = await mountBoard()
    await w.get('[data-test="board-column-need"] [data-test="board-card"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/s/yoshi')
    expect(store.selectedId).toBe('yoshi')
    w.unmount()
  })
  it('en landscape las columnas van en fila; en portrait y phone se apilan', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    expect(w.get('[data-test="board"]').classes()).toContain('grid-cols-4')
    mode.value = 'portrait'; await flushPromises()
    expect(w.get('[data-test="board"]').classes()).not.toContain('grid-cols-4')
    w.unmount()
  })
  it('tarjetas sin estilo nativo (preflight apagado) y táctiles', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    expect(w.get('[data-test="board-card"]').classes()).toEqual(expect.arrayContaining(['border', 'border-border', 'cursor-pointer', 'min-h-10']))
    w.unmount()
  })
})
```

Sumar a `src/components/shell/TopBar.test.ts` (su router de memoria necesita las rutas `/board` y `/s/:id`; agregarlas):
```ts
it('el botón tablero/foco alterna entre /board y el foco', async () => {
  setActivePinia(createPinia())
  const r = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/s/:id', component: { template: '<div/>' } },
    { path: '/board', component: { template: '<div/>' } },
    { path: '/settings/:section?', component: { template: '<div/>' } },
  ] })
  useSessions().setAll([sess('a', 'idle')]); useSessions().select('a')
  await r.push('/s/a'); await r.isReady()
  const w = mount(TopBar, { global: { plugins: [r] } })
  const btn = w.get('[data-test="board-toggle"]')
  expect(btn.text()).toContain('Tablero')
  expect(btn.classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer', 'min-h-10']))
  await btn.trigger('click'); await flushPromises()
  expect(r.currentRoute.value.path).toBe('/board')
  expect(w.get('[data-test="board-toggle"]').text()).toContain('Foco')
  await w.get('[data-test="board-toggle"]').trigger('click'); await flushPromises()
  expect(r.currentRoute.value.path).toBe('/s/a')
})
```
(Importar `flushPromises` de `@vue/test-utils` si el archivo no lo hace.)

En `src/router.test.ts`, reemplazar el caso "/board redirige a /" por:
```ts
it('/board muestra el tablero', async () => {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push('/board'); await router.isReady()
  expect(router.currentRoute.value.name).toBe('board')
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/board src/components/shell/TopBar.test.ts src/router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/board/boardColumns.ts`:
```ts
import type { Session, Status } from '../../types'

// Tablero: columnas automáticas según el estado de cada sesión (spec §Tablero).
export type ColumnId = 'need' | 'working' | 'done' | 'quiet'
export interface BoardColumnData { id: ColumnId; title: string; sessions: Session[] }

const COLUMNS: { id: ColumnId; title: string; statuses: Status[] }[] = [
  { id: 'need', title: 'Te necesita', statuses: ['waiting', 'error'] },
  { id: 'working', title: 'Trabajando', statuses: ['working'] },
  { id: 'done', title: 'Lista', statuses: ['done'] },
  { id: 'quiet', title: 'Quietas', statuses: ['idle', 'offline'] },
]

export function boardColumns(list: Session[]): BoardColumnData[] {
  return COLUMNS.map(({ id, title, statuses }) => ({ id, title, sessions: list.filter((s) => statuses.includes(s.status)) }))
}
```

`src/components/board/BoardCard.vue`:
```vue
<script setup lang="ts">
import SessionAvatar from '../sessions/SessionAvatar.vue'
import { useGoToSession } from '../../composables/useGoToSession'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const goTo = useGoToSession()
</script>

<template>
  <button data-test="board-card" type="button" @click="goTo(props.session.id)"
    :class="cn('flex min-h-10 w-full cursor-pointer items-start gap-3 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-3 text-left font-[inherit] text-text hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent',
      session.status === 'offline' && 'opacity-60')">
    <SessionAvatar :session="session" />
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <b class="min-w-0 truncate text-sm font-semibold">{{ session.name }}</b>
        <span v-if="session.status === 'offline'" class="shrink-0 rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted">caída</span>
      </span>
      <span class="truncate text-xs text-muted">{{ session.project }}<template v-if="session.branch"> · {{ session.branch }}</template></span>
      <span v-if="session.action" class="truncate text-xs text-text">{{ session.action }}</span>
    </span>
  </button>
</template>
```

`src/components/board/BoardColumn.vue`:
```vue
<script setup lang="ts">
import BoardCard from './BoardCard.vue'
import type { BoardColumnData } from './boardColumns'
import { cn } from '@/lib/utils'

const props = defineProps<{ column: BoardColumnData }>()
// Clases literales para que Tailwind las detecte: color del contador por columna.
const DOT: Record<string, string> = { need: 'bg-state-waiting', working: 'bg-state-working', done: 'bg-state-done', quiet: 'bg-state-idle' }
</script>

<template>
  <section :data-test="`board-column-${column.id}`" :data-empty="column.sessions.length ? 'false' : 'true'"
    :class="cn('flex min-h-0 flex-col gap-2 rounded-[calc(var(--radius)+4px)] bg-background/40 p-2', !column.sessions.length && 'self-start')">
    <h2 class="m-0 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
      <i :class="cn('size-2 rounded-full', DOT[column.id])" />{{ column.title }}
      <span class="tabular-nums text-text">{{ props.column.sessions.length }}</span>
    </h2>
    <!-- Vacía: sólo el encabezado con el contador. -->
    <ul v-if="column.sessions.length" class="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto p-0">
      <li v-for="s in column.sessions" :key="s.id"><BoardCard :session="s" /></li>
    </ul>
  </section>
</template>
```

`src/components/board/BoardView.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../../stores/sessions'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { boardColumns } from './boardColumns'
import BoardColumn from './BoardColumn.vue'
import { cn } from '@/lib/utils'

const store = useSessions()
const { mode } = useLayoutMode()
const columns = computed(() => boardColumns(store.list))
</script>

<template>
  <!-- landscape: cuatro columnas en fila; portrait y phone: apiladas, scrolleando la página. -->
  <div data-test="board" :class="cn('grid h-full min-h-0 gap-3 p-3 sm:p-4', mode === 'landscape' ? 'grid-cols-4' : 'grid-cols-1 content-start overflow-y-auto')">
    <BoardColumn v-for="c in columns" :key="c.id" :column="c" />
  </div>
</template>
```

`src/views/BoardRoute.vue`:
```vue
<script setup lang="ts">
import BoardView from '../components/board/BoardView.vue'
</script>

<template>
  <div class="h-full min-h-0 min-w-0"><BoardView /></div>
</template>
```

`src/router.ts`: reemplazar `{ path: '/board', redirect: '/' }` por `{ path: '/board', name: 'board', component: () => import('./views/BoardRoute.vue') },` (y quitar el comentario "el tablero llega en el PR 3").

`src/components/shell/TopBar.vue`: agregar el botón entre el `ManaMeter` y el `SpawnMenu`:
```ts
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutGrid, Focus } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'

const route = useRoute()
const router = useRouter()
const store = useSessions()
const onBoard = computed(() => route.name === 'board' || route.path === '/board')
// Alterna tablero ↔ foco (la última sesión seleccionada, o el foco vacío).
function toggleBoard() {
  if (onBoard.value) router.push(store.selectedId ? `/s/${store.selectedId}` : '/')
  else router.push('/board')
}
```
```vue
<button data-test="board-toggle" type="button" @click="toggleBoard"
  :title="onBoard ? 'Ver la sesión en foco (g f)' : 'Ver el tablero (g b)'"
  class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 font-[inherit] text-sm text-muted hover:bg-surface-raised hover:text-text">
  <Focus v-if="onBoard" class="size-4" /><LayoutGrid v-else class="size-4" />
  <span class="hidden sm:inline">{{ onBoard ? 'Foco' : 'Tablero' }}</span>
</button>
```
(Con `aria-label` igual al texto visible, para cuando la etiqueta se oculta en celular.)

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/board src/components/shell src/router.test.ts && npm run build 2>&1 | tail -1`
Expected: PASS y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): tablero por estado en #/board y botón tablero/foco"
```

---

### Task 2: Atajos `g b` y `g f`

**Files:**
- Create: `src/composables/useGlobalShortcuts.ts`, `useGlobalShortcuts.test.ts`
- Modify: `src/composables/useFocusShortcuts.ts` (exportar `typingTarget` e `insideDialog`), `src/components/shell/AppShell.vue` (montar los atajos), `habitat/README.md` (sección "Atajos")

**Interfaces:**
- Consumes: `useSessions()` (`selectedId`), `useRouter()`; `typingTarget(t)`, `insideDialog(t)` exportadas desde `src/composables/useFocusShortcuts.ts`.
- Produces:
  - `createSequence(timeoutMs?: number): (key: string, now: number) => 'board' | 'focus' | null` — máquina pura: `g` arma la secuencia; `b`/`f` dentro de `timeoutMs` (1000 por defecto) devuelven la acción; cualquier otra tecla la desarma.
  - `useGlobalShortcuts(): void` — listener en `document` (keydown), quitado al desmontar.

- [ ] **Step 1: Test que falla**

`src/composables/useGlobalShortcuts.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createSequence, useGlobalShortcuts } from './useGlobalShortcuts'
import { useSessions } from '../stores/sessions'

describe('createSequence', () => {
  it('g b → board, g f → focus', () => {
    const seq = createSequence()
    expect(seq('g', 0)).toBeNull()
    expect(seq('b', 100)).toBe('board')
    expect(seq('g', 200)).toBeNull()
    expect(seq('f', 300)).toBe('focus')
  })
  it('la secuencia vence y otra tecla la desarma', () => {
    const seq = createSequence(1000)
    seq('g', 0)
    expect(seq('b', 1500)).toBeNull()
    seq('g', 2000)
    expect(seq('x', 2100)).toBeNull()
    expect(seq('b', 2200)).toBeNull()
  })
  it('b sola no hace nada', () => {
    expect(createSequence()('b', 0)).toBeNull()
  })
})

describe('useGlobalShortcuts', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const key = (k: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  async function setup() {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: { template: '<div/>' } }, { path: '/s/:id', component: { template: '<div/>' } }, { path: '/board', component: { template: '<div/>' } },
    ] })
    await router.push('/'); await router.isReady()
    const w = mount(defineComponent({ setup() { useGlobalShortcuts(); return () => h('div') } }), { global: { plugins: [router] }, attachTo: document.body })
    return { router, w }
  }
  it('g b va al tablero y g f vuelve al foco de la seleccionada', async () => {
    const store = useSessions(); store.setAll([{ id: 'a', name: 'a', project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 } as any]); store.select('a')
    const { router, w } = await setup()
    key('g'); key('b'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/board')
    key('g'); key('f'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/s/a')
    w.unmount()
  })
  it('no actúa escribiendo en un input ni en la terminal', async () => {
    const { router, w } = await setup()
    const input = document.createElement('input'); document.body.appendChild(input)
    key('g', input); key('b', input); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    const xt = document.createElement('div'); xt.className = 'xterm'; const ta = document.createElement('textarea'); xt.appendChild(ta); document.body.appendChild(xt)
    key('g', ta); key('b', ta); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    input.remove(); xt.remove(); w.unmount()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useGlobalShortcuts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `src/composables/useFocusShortcuts.ts`, agregar `export` a `function typingTarget` y a `function insideDialog` (sin cambiar su cuerpo).

`src/composables/useGlobalShortcuts.ts`:
```ts
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSessions } from '../stores/sessions'
import { typingTarget, insideDialog } from './useFocusShortcuts'

export type GlobalAction = 'board' | 'focus'

// Secuencia estilo "g b": la g arma, la segunda tecla dentro del plazo dispara.
export function createSequence(timeoutMs = 1000) {
  let armedAt: number | null = null
  return (key: string, now: number): GlobalAction | null => {
    if (armedAt !== null && now - armedAt <= timeoutMs) {
      armedAt = null
      if (key === 'b') return 'board'
      if (key === 'f') return 'focus'
      return null
    }
    armedAt = key === 'g' ? now : null
    return null
  }
}

// g b → tablero, g f → foco. Mismas guardas que [ ]: no actúan en la terminal,
// en campos editables ni dentro de un diálogo.
export function useGlobalShortcuts() {
  const router = useRouter()
  const store = useSessions()
  const seq = createSequence()
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (typingTarget(e.target) || insideDialog(e.target)) return
    const action = seq(e.key, Date.now())
    if (action === 'board') router.push('/board')
    else if (action === 'focus') router.push(store.selectedId ? `/s/${store.selectedId}` : '/')
  }
  onMounted(() => document.addEventListener('keydown', onKey))
  onUnmounted(() => document.removeEventListener('keydown', onKey))
}
```

`src/components/shell/AppShell.vue`: importar `useGlobalShortcuts` y llamarlo en el `<script setup>`. Si `AppShell.test.ts` monta sin router, agregarle un router de memoria (como `TopBar.test.ts`).

`habitat/README.md`, sección "Atajos": agregar la línea "`g` `b` abre el tablero y `g` `f` vuelve al foco."

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/composables src/components/shell && npm run build 2>&1 | tail -1`
Expected: PASS y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src habitat/README.md
git commit -m "feat(habitat): atajos g b (tablero) y g f (foco)"
```

---

### Task 3: Lista de sesiones del celular y navegación por modo

**Files:**
- Create: `src/components/sessions/SessionList.vue`, `SessionList.test.ts`, `src/views/SessionListRoute.vue`
- Modify: `src/router.ts` (ruta `/sessions`), `src/views/FocusRoute.vue` (+test: redirección en phone), `src/components/shell/AppShell.vue` (+test: sin nav en phone ni sin sesiones), `src/components/sessions/SessionNav.vue`, `src/components/sessions/SessionSidebar.vue` (estado en texto), `src/components/sessions/SessionNav.test.ts`

**Interfaces:**
- Consumes: `useSessions()` (`list`), `useLayoutMode()` (`mode`), `useGoToSession()`, `SessionAvatar`, `STATUS_LABEL`, `STATE_TOKEN`, `ago` (`src/sprites`).
- Produces:
  - Ruta `/sessions` (`name: 'list'`) → `SessionListRoute`: en phone muestra `<SessionList />`; fuera de phone hace `router.replace('/')`.
  - `FocusRoute` en phone y en la ruta `focus` (`#/`) hace `router.replace('/sessions')`.
  - `<SessionList />`: filas grandes (`min-h-14`), "te necesita" (`waiting`, `error`) primero, el resto en el orden de la nav; cada fila `data-test="session-row"` navega a `/s/:id`.
  - `AppShell` no renderiza `SessionNav` en phone ni cuando `store.list` está vacío.

- [ ] **Step 1: Tests que fallan**

`src/components/sessions/SessionList.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import SessionList from './SessionList.vue'
import { useSessions } from '../../stores/sessions'
import { createHabitatRouter, syncSelectionWithRoute } from '../../router'

const s = (id: string, status: string, action = '') => ({ id, name: id, project: 'proj', branch: 'main', status, action, since: 0, stamina: 100 }) as any

async function mountList() {
  const store = useSessions()
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push('/sessions'); await router.isReady()
  return { w: mount(SessionList, { global: { plugins: [router] } }), router, store }
}

beforeEach(() => setActivePinia(createPinia()))

describe('SessionList', () => {
  it('"te necesita" primero, el resto en el orden de la nav', async () => {
    useSessions().setAll([s('a', 'working'), s('b', 'idle'), s('c', 'waiting'), s('d', 'error')])
    const { w } = await mountList()
    expect(w.findAll('[data-test="session-row"]').map((r) => r.attributes('data-id'))).toEqual(['c', 'd', 'a', 'b'])
  })
  it('cada fila muestra nombre, proyecto, estado y acción', async () => {
    useSessions().setAll([s('ezio', 'working', 'Edit')])
    const { w } = await mountList()
    const row = w.get('[data-test="session-row"]')
    for (const t of ['ezio', 'proj', 'trabajando', 'Edit']) expect(row.text()).toContain(t)
  })
  it('tocar una fila abre el foco de esa sesión', async () => {
    useSessions().setAll([s('ezio', 'working'), s('yoshi', 'idle')])
    const { w, router, store } = await mountList()
    await w.findAll('[data-test="session-row"]')[1].trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/s/yoshi')
    expect(store.selectedId).toBe('yoshi')
  })
  it('filas grandes y sin estilo nativo', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountList()
    expect(w.get('[data-test="session-row"]').classes()).toEqual(expect.arrayContaining(['min-h-14', 'border-0', 'cursor-pointer']))
  })
})
```

Sumar a `src/views/FocusRoute.test.ts` (mockeando `useLayoutMode` con un `mode` ref y montando con un router de memoria `createHabitatRouter(createMemoryHistory())` en `/`): "en phone, `#/` redirige a `/sessions`" y "fuera de phone, `#/` no redirige".

Sumar a `src/components/shell/AppShell.test.ts` (mismo mock de `useLayoutMode`): "en phone no hay navegación de sesiones" (`[data-test="session-sidebar"]` y `[data-test="session-tabs"]` no existen) y "sin sesiones no hay navegación de sesiones" (en landscape con `store.setAll([])`).

Sumar a `src/components/sessions/SessionNav.test.ts`: "la barra lateral expandida muestra el estado en texto" (en landscape, la fila de `yoshi`, que está `waiting`, contiene "te necesita"; colapsada no lo muestra).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/sessions src/views src/components/shell`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/sessions/SessionList.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { useGoToSession } from '../../composables/useGoToSession'
import { STATUS_LABEL, STATE_TOKEN, type Session } from '../../types'
import { ago } from '../../sprites'
import SessionAvatar from './SessionAvatar.vue'
import { cn } from '@/lib/utils'

// Pantalla principal del celular: filas grandes, "te necesita" primero.
const store = useSessions()
const goTo = useGoToSession()
const needs = (s: Session) => s.status === 'waiting' || s.status === 'error'
const rows = computed(() => [...store.list.filter(needs), ...store.list.filter((s) => !needs(s))])
// Clases literales para que Tailwind las detecte.
const TXT: Record<string, string> = { working: 'text-state-working', waiting: 'text-state-waiting', done: 'text-state-done', idle: 'text-muted', error: 'text-state-error' }
</script>

<template>
  <ul data-test="session-list" class="m-0 flex list-none flex-col gap-2 overflow-y-auto p-3">
    <li v-for="s in rows" :key="s.id">
      <button data-test="session-row" :data-id="s.id" type="button" @click="goTo(s.id)"
        :class="cn('flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[calc(var(--radius)+4px)] border-0 bg-surface px-3 py-2 text-left font-[inherit] text-text hover:bg-surface-raised',
          needs(s) && 'ring-1 ring-state-waiting', s.status === 'offline' && 'opacity-60')">
        <SessionAvatar :session="s" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-2">
            <b class="min-w-0 truncate font-semibold">{{ s.name }}</b>
            <span :class="cn('shrink-0 text-xs font-semibold', TXT[STATE_TOKEN[s.status]])">{{ STATUS_LABEL[s.status] }}</span>
          </span>
          <span class="truncate text-xs text-muted">{{ s.project }}<template v-if="s.branch"> · {{ s.branch }}</template></span>
          <span v-if="s.action" class="truncate text-xs text-text">{{ s.action }} <span class="text-muted">· hace {{ ago(s.since) }}</span></span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted" />
      </button>
    </li>
  </ul>
</template>
```

`src/views/SessionListRoute.vue`:
```vue
<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import SessionList from '../components/sessions/SessionList.vue'
import { useLayoutMode } from '../composables/useLayoutMode'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'

// La lista es la pantalla principal sólo en celular; en tablet/escritorio la nav ya está a la vista.
const router = useRouter()
const { mode } = useLayoutMode()
const store = useSessions()
const { canSpawn } = useProjects()
watch(mode, (m) => { if (m !== 'phone') router.replace('/') }, { immediate: true })
</script>

<template>
  <div class="h-full min-h-0">
    <div v-if="!store.list.length" data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
      <p class="m-0 max-w-sm text-center text-sm text-muted">
        No hay sesiones abiertas.<br />
        <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> de la barra de arriba.</template>
        <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
      </p>
    </div>
    <SessionList v-else />
  </div>
</template>
```

`src/router.ts`: agregar `{ path: '/sessions', name: 'list', component: () => import('./views/SessionListRoute.vue') },` antes del catch-all. `syncSelectionWithRoute` no cambia: en `list` no toca la URL.

`src/views/FocusRoute.vue`: agregar
```ts
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLayoutMode } from '../composables/useLayoutMode'
const route = useRoute()
const router = useRouter()
const { mode } = useLayoutMode()
// En celular la pantalla principal es la lista; el foco sólo con una sesión explícita (#/s/:id).
watch([mode, () => route.name], ([m, name]) => { if (m === 'phone' && name === 'focus') router.replace('/sessions') }, { immediate: true })
```

`src/components/shell/AppShell.vue`: `const store = useSessions()` y `const showNav = computed(() => mode.value !== 'phone' && store.list.length > 0)`; `<SessionNav v-if="showNav" />`.

`src/components/sessions/SessionNav.vue`: actualizar el comentario (phone ya no usa pestañas: `AppShell` no monta la nav en phone). El template queda igual.

`src/components/sessions/SessionSidebar.vue`: en la fila expandida, debajo de proyecto · rama, una línea `<span data-test="session-status" class="block truncate text-xs" :class="...">{{ statusLabel(s) }}</span>` con el color por estado (mapa de clases literales como en `SessionList`). Sólo cuando no está colapsada.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): lista de sesiones como pantalla principal del celular"
```

---

### Task 4: Foco a pantalla completa en el celular

**Files:**
- Modify: `src/components/focus/FocusView.vue`, `src/components/focus/SessionHeader.vue`, `src/components/focus/ToolTabs.vue`, `src/components/focus/TerminalPane.vue`, y sus tests (`FocusView.test.ts`, `SessionHeader.test.ts`, `ToolTabs.test.ts`, `TerminalPane.test.ts`)

**Interfaces:**
- Consumes: `useLayoutMode()` (`mode`), `useRouter()`.
- Produces:
  - `SessionHeader` en phone muestra un botón `data-test="back-to-list"` (ícono `ArrowLeft`, `aria-label="Volver a la lista"`, `min-h-10 min-w-10`) que hace `router.push('/sessions')`; la línea proyecto · rama trunca con "…" (`truncate` en el contenedor y `min-w-0`).
  - `ToolTabs` en phone se dibuja como barra inferior: `data-test="tool-bar"`, `role="tablist"`, botones con ícono arriba y etiqueta chica abajo (`flex-col`, `min-h-14`, `flex-1`), borde superior; `FocusView` la ubica al final (debajo del área), con `pb-[env(safe-area-inset-bottom,0px)]`.
  - `TerminalPane` en phone muestra las teclas en pantalla en su propia fila, debajo de la barra, en la variante normal (40×40), no la `dense`.

- [ ] **Step 1: Tests que fallan**

En `ToolTabs.test.ts` (ya mockea `useLayoutMode` con `mode`):
```ts
it('en phone es una barra inferior con ícono y etiqueta, táctil', async () => {
  mode.value = 'phone'
  const w = mount(ToolTabs, { props: { session: sess() } })
  const bar = w.get('[data-test="tool-bar"]')
  expect(bar.attributes('role')).toBe('tablist')
  const first = w.findAll('[data-test="tool-tab"]')[0]
  expect(first.classes()).toEqual(expect.arrayContaining(['flex-col', 'min-h-14', 'flex-1', 'border-0', 'cursor-pointer']))
})
```

En `SessionHeader.test.ts` (mockear `useLayoutMode` con un `mode` ref y montar con un router de memoria que tenga `/sessions`):
```ts
it('en phone hay botón volver a la lista', async () => {
  mode.value = 'phone'
  const w = mount(SessionHeader, { props: { session: base }, global: { plugins: [router] } })
  const back = w.get('[data-test="back-to-list"]')
  expect(back.attributes('aria-label')).toBe('Volver a la lista')
  expect(back.classes()).toEqual(expect.arrayContaining(['min-h-10', 'min-w-10', 'border-0']))
  await back.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/sessions')
})
it('fuera de phone no hay botón volver', () => {
  mode.value = 'landscape'
  const w = mount(SessionHeader, { props: { session: base }, global: { plugins: [router] } })
  expect(w.find('[data-test="back-to-list"]').exists()).toBe(false)
})
it('proyecto · rama trunca con puntos suspensivos', () => {
  const w = mount(SessionHeader, { props: { session: base }, global: { plugins: [router] } })
  expect(w.get('[data-test="session-repo"]').classes()).toEqual(expect.arrayContaining(['truncate', 'min-w-0']))
})
```

En `TerminalPane.test.ts` (mockear `useLayoutMode` con `mode` y `useTermKeys` con `enabled: ref(true)`):
```ts
it('en phone las teclas en pantalla van en su fila, tamaño táctil (no dense)', () => {
  mode.value = 'phone'
  const w = mount(TerminalPane, { props: { session } })
  const row = w.get('[data-test="term-keys-row"]')
  expect(row.find('.termkeys').classes()).not.toContain('dense')
})
```

En `FocusView.test.ts`: "en phone la barra de herramientas va abajo del área" (el último hijo del contenedor raíz de `FocusView` contiene `[data-test="tool-bar"]`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/focus`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`ToolTabs.vue`: con `const { mode } = useLayoutMode()` y `const phone = computed(() => mode.value === 'phone')`. Si `phone`:
```vue
<nav data-test="tool-bar" role="tablist" aria-label="Herramientas" class="flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom,0px)]">
  <button v-for="t in TABS" :key="t.id" data-test="tool-tab" type="button" role="tab" :aria-selected="current === t.id ? 'true' : 'false'"
    :class="cn('flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent font-[inherit] text-[11px]',
      current === t.id ? 'text-accent' : 'text-muted')"
    @click="choose(t.id)">
    <component :is="t.icon" class="size-5" />{{ t.label }}
  </button>
</nav>
```
Si no, el template actual (pestañas arriba con "Fijar al costado").

`FocusView.vue`: en phone, renderizar `<ToolTabs>` **después** del área (`<div class="relative min-h-0 flex-1">…</div>`) y sin el `gap`/padding inferior que lo separe del borde de la pantalla (contenedor `flex h-full min-h-0 flex-col`, con `p-3 pb-0` en phone). En los demás modos, el orden actual (header, pestañas, área).

`SessionHeader.vue`:
- con `useLayoutMode()` y `useRouter()`, en phone un botón primero en el header:
```vue
<button v-if="mode === 'phone'" data-test="back-to-list" type="button" aria-label="Volver a la lista" title="Volver a la lista"
  class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-transparent text-muted hover:bg-surface-raised hover:text-text"
  @click="router.push('/sessions')">
  <ArrowLeft class="size-5" />
</button>
```
- la línea de proyecto · rama: `data-test="session-repo"` con `block min-w-0 truncate` (el `<span>` de color va aparte, `shrink-0`, fuera del texto truncado), para que la rama larga termine en "…".

`TerminalPane.vue`: con `useLayoutMode()`; en phone no se muestra `TermKeys dense` dentro de la barra, sino una fila propia debajo de la barra: `<div v-if="termKeysEnabled" data-test="term-keys-row" class="flex shrink-0 justify-center border-b border-border bg-surface px-2 py-1"><TermKeys @press="sendKey" /></div>`. Fuera de phone queda como está.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): foco a pantalla completa en el celular con barra inferior y volver"
```

---

### Task 5: `NewSessionDialog` y fuera el `SpawnMenu`

**Files:**
- Create: `src/components/ui/sheet/**`, `src/components/ui/input/**` (shadcn), `src/components/session/NewSessionDialog.vue`, `NewSessionDialog.test.ts`
- Modify: `src/components/shell/TopBar.vue` (+test: el botón abre el diálogo)
- Delete: `src/components/SpawnMenu.vue`; sus reglas en `src/style.css` (`.spawn*`, `.sbtn` si sólo las usa él, `.proj-dot`): grep antes de borrar cada una.

**Interfaces:**
- Consumes: `useProjects()` → `{ canSpawn, projects: Ref<Project[]>, error: Ref<string>, spawn(dir, name, char?): Promise<boolean> }` (`Project { dir, name, color, chars? }`); `CHARACTERS`, `faceFor(name, char)` (`src/sprites`); `useLayoutMode()`; `@/components/ui/dialog` y `@/components/ui/sheet`.
- Produces:
  - `<NewSessionDialog v-model:open="boolean" />`: en phone usa `Sheet` con `side="bottom"`; si no, `Dialog`. Pasos: proyecto (lista de botones `data-test="ns-project"`) → nombre (`data-test="ns-name"`, opcional) + personaje (`data-test="ns-char"`, respetando `project.chars`; `data-test="ns-char-auto"`) → "Crear" (`data-test="ns-create"`). Muestra `error` de `useProjects` (`data-test="ns-error"`). Al crear bien, se cierra y resetea.
  - En la `TopBar`: `<button data-test="new-session">` (sólo si `canSpawn`) con "+ Nueva sesión" (en celular, sólo "+", con `aria-label="Nueva sesión"`), que abre el diálogo.

- [ ] **Step 1: Generar las primitivas**

```bash
cd habitat/client
npx shadcn-vue@2.4.0 add sheet input --yes
```
Mismo tratamiento que en el PR 2: imports de `@lucide/vue` → `lucide-vue-next`; colores de shadcn → tokens (tabla del PR 1: `bg-background` queda, `bg-popover`/`bg-card` → `bg-surface`, `text-foreground` → `text-text`, `text-muted-foreground` → `text-muted`, `border-input`/`border` sin color → `border border-border`, `ring-ring` → `ring-accent`, overlay → `bg-background/80`); sin variantes `dark:`; botones (el cierre del Sheet) con `border-0 bg-transparent text-muted hover:text-text font-[inherit] cursor-pointer min-h-10 min-w-10`; el `Input` con `border border-border bg-background text-text font-[inherit] min-h-10`. Verificar con
```bash
grep -rnE "primary|secondary|muted-foreground|popover|destructive|ring-ring|card-foreground|dark:|white|black|@lucide/vue" src/components/ui/sheet src/components/ui/input
```
(sin resultados, salvo nombres de variante).

- [ ] **Step 2: Test que falla**

`src/components/session/NewSessionDialog.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
const projects = ref([
  { dir: '/p/back', name: 'back', color: '#888888', chars: ['Knight', 'Monk'] },
  { dir: '/p/front', name: 'front', color: '#888888' },
])
const error = ref('')
const spawn = vi.fn(async () => true)
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn: ref(true), projects, error, spawn }) }))
import NewSessionDialog from './NewSessionDialog.vue'
import { CHARACTERS } from '../../sprites'

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[]

beforeEach(() => { vi.clearAllMocks(); error.value = ''; mode.value = 'landscape'; spawn.mockResolvedValue(true) })

async function open() {
  const w = mount(NewSessionDialog, { props: { open: true }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('NewSessionDialog', () => {
  it('elegir proyecto muestra sólo los personajes permitidos', async () => {
    const w = await open()
    expect(qa('[data-test="ns-project"]').map((b) => b.textContent?.trim())).toEqual(['back', 'front'])
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    expect(qa('[data-test="ns-char"]').length).toBe(2)
    w.unmount()
  })
  it('sin allowlist se ofrecen todos los personajes', async () => {
    const w = await open()
    qa('[data-test="ns-project"]')[1].click(); await flushPromises()
    expect(qa('[data-test="ns-char"]').length).toBe(CHARACTERS.length)
    w.unmount()
  })
  it('crear llama a spawn con proyecto, nombre y personaje, y cierra', async () => {
    const w = await open()
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    const name = q('[data-test="ns-name"]') as HTMLInputElement
    name.value = 'ezio'; name.dispatchEvent(new Event('input')); await flushPromises()
    qa('[data-test="ns-char"]')[1].click(); await flushPromises()
    q('[data-test="ns-create"]').click(); await flushPromises()
    expect(spawn).toHaveBeenCalledWith('/p/back', 'ezio', 'Monk')
    const ev = w.emitted('update:open')
    expect(ev?.[ev.length - 1]).toEqual([false])
    w.unmount()
  })
  it('si falla muestra el error y no cierra', async () => {
    spawn.mockImplementationOnce(async () => { error.value = 'ya existe un personaje con ese nombre'; return false })
    const w = await open()
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    q('[data-test="ns-create"]').click(); await flushPromises()
    expect(q('[data-test="ns-error"]').textContent).toContain('ya existe')
    expect(w.emitted('update:open')).toBeUndefined()
    w.unmount()
  })
  it('en phone es un Sheet inferior', async () => {
    mode.value = 'phone'
    const w = await open()
    expect(q('[data-test="ns-sheet"]')).not.toBeNull()
    w.unmount()
  })
  it('botones táctiles y sin estilo nativo', async () => {
    const w = await open()
    const cls = qa('[data-test="ns-project"]')[0].className
    for (const c of ['min-h-10', 'border-0', 'cursor-pointer']) expect(cls).toContain(c)
    w.unmount()
  })
})
```

En `TopBar.test.ts`: cambiar el mock de `../SpawnMenu.vue` por uno de `../session/NewSessionDialog.vue` (`{ props: ['open'], template: '<div data-test="ns-stub" :data-open="String(open)" />' }`), mockear `useProjects` con `canSpawn: ref(true)`, y asertar que `[data-test="new-session"]` existe, tiene `min-h-10`, `border-0`, `cursor-pointer`, y que al hacer click el stub queda con `data-open="true"`. Reemplazar el `expect(w.find('[data-test="spawn"]')…)` del primer caso por `[data-test="new-session"]`.

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/session src/components/shell/TopBar.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

`src/components/session/NewSessionDialog.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useProjects } from '../../composables/useProjects'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { CHARACTERS, faceFor } from '../../sprites'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Nueva sesión: proyecto → nombre (opcional) y personaje → crear. En celular, Sheet inferior.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const { projects, error, spawn } = useProjects()
const { mode } = useLayoutMode()

const dir = ref('')
const name = ref('')
const char = ref<string | undefined>(undefined)
const busy = ref(false)
const project = computed(() => projects.value.find((p) => p.dir === dir.value) ?? null)
// La allowlist del proyecto manda; si está vacía, cualquier personaje.
const chars = computed(() => (project.value?.chars?.length ? project.value.chars : CHARACTERS))

function reset() { dir.value = ''; name.value = ''; char.value = undefined; error.value = '' }
watch(() => props.open, (v) => { if (v) reset() })
function close() { emit('update:open', false) }
async function create() {
  if (!dir.value || busy.value) return
  busy.value = true
  const ok = await spawn(dir.value, name.value.trim(), char.value)
  busy.value = false
  if (ok) { close(); reset() }
}

const opt = 'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-surface-raised px-3 text-left font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50'
</script>

<template>
  <component :is="mode === 'phone' ? Sheet : Dialog" :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <component :is="mode === 'phone' ? SheetContent : DialogContent" v-bind="mode === 'phone' ? { side: 'bottom', 'data-test': 'ns-sheet' } : {}"
      class="max-h-[85dvh] overflow-y-auto">
      <component :is="mode === 'phone' ? SheetHeader : DialogHeader">
        <component :is="mode === 'phone' ? SheetTitle : DialogTitle">Nueva sesión</component>
        <component :is="mode === 'phone' ? SheetDescription : DialogDescription">
          {{ project ? project.name : 'Elegí el proyecto' }}
        </component>
      </component>

      <ul v-if="!project" class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="p in projects" :key="p.dir">
          <button data-test="ns-project" type="button" :class="opt" :disabled="busy" @click="dir = p.dir">
            <i class="size-2.5 shrink-0 rounded-sm" :style="{ background: p.color }" />{{ p.name }}
          </button>
        </li>
      </ul>

      <div v-else class="flex flex-col gap-3">
        <button type="button" data-test="ns-back" :disabled="busy" @click="reset()"
          class="inline-flex min-h-10 w-fit cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 font-[inherit] text-sm text-muted hover:text-text">
          <ArrowLeft class="size-4" />Cambiar proyecto
        </button>
        <label class="flex flex-col gap-1 text-xs text-muted">
          Nombre (vacío = al azar)
          <Input v-model="name" data-test="ns-name" :disabled="busy" placeholder="ezio" @keyup.enter="create" />
        </label>
        <div class="flex flex-wrap gap-2">
          <button v-for="c in chars" :key="c" data-test="ns-char" type="button" :title="c" :disabled="busy"
            :class="cn('min-h-10 min-w-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised p-1', char === c && 'ring-2 ring-accent')"
            @click="char = char === c ? undefined : c">
            <img :src="faceFor('', c)" alt="" class="pixel size-8" />
          </button>
          <button data-test="ns-char-auto" type="button" :disabled="busy"
            :class="cn('min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text', !char && 'ring-2 ring-accent')"
            @click="char = undefined">Auto</button>
        </div>
        <button data-test="ns-create" type="button" :disabled="busy" @click="create"
          class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-accent px-4 font-[inherit] text-sm font-semibold text-accent-foreground disabled:opacity-50">
          {{ busy ? 'Creando…' : 'Crear' }}
        </button>
      </div>
      <p v-if="error" data-test="ns-error" class="m-0 rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger">
        <span aria-hidden="true">! </span>{{ error }}
      </p>
    </component>
  </component>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
```
Nota para el implementador: si el `<component :is>` anidado complica el tipado o el portal en happy-dom, partirlo en dos ramas explícitas (`v-if="mode === 'phone'"` con `Sheet…` y `v-else` con `Dialog…`) compartiendo el contenido en un subcomponente `NewSessionForm.vue` (props: nada; emite `done`). Mantener los `data-test`.

`src/components/shell/TopBar.vue`: quitar el import de `SpawnMenu` y en su lugar:
```ts
import { ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import { useProjects } from '../../composables/useProjects'
import NewSessionDialog from '../session/NewSessionDialog.vue'
const { canSpawn } = useProjects()
const newOpen = ref(false)
```
```vue
<button v-if="canSpawn" data-test="new-session" type="button" aria-label="Nueva sesión" @click="newOpen = true"
  class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border-0 bg-accent px-2.5 font-[inherit] text-sm font-semibold text-accent-foreground hover:opacity-90">
  <Plus class="size-4" /><span class="hidden sm:inline">Nueva sesión</span>
</button>
<NewSessionDialog v-model:open="newOpen" />
```

Borrar `src/components/SpawnMenu.vue` y sus reglas en `style.css` (grep de cada selector antes de borrarlo). Verificar: `grep -rn "SpawnMenu\|spawn-\|\.sbtn" src` sin resultados (salvo usos que sigan vivos en componentes legacy; si `.sbtn` la usa otro componente, se queda).

- [ ] **Step 5: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 6: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): NewSessionDialog (Sheet en celular) reemplaza al SpawnMenu"
```

---

### Task 6: Capturas, verificación visual y cierre

**Files:**
- Modify: `habitat/scripts/screenshots.mjs` (vistas nuevas)

**Interfaces:**
- Produces: vistas `board` (`#/board`), `phone-list` (`#/sessions`, sólo en tamaños phone), `phone-focus` (`#/s/<primera sesión>`, sólo phone; la primera sesión se toma de `GET /sessions` con el token o clickeando la primera `[data-test="session-row"]` en `#/sessions`), `new-session` (`#/` + click en `[data-test="new-session"]`, y en el diálogo click en el primer `[data-test="ns-project"]`). Las vistas sólo-phone se saltean con un log en los otros tamaños (como `focus-pinned`). Las `prepare` fallan ruidosamente si no encuentran el elemento (como hoy).

- [ ] **Step 1: Script**

Agregar las vistas a `ALL_VIEWS` con un flag `phoneOnly: true` donde corresponda y el skip equivalente a `landscapeOnly` (phone = `Math.min(w, h) < 600`). `node --check habitat/scripts/screenshots.mjs`.

- [ ] **Step 2: Instancia aislada y capturas**

Instancia de dev en el puerto **8399**, arrancada con `env -i` (pasando sólo `PATH`, `HOME` y las variables `HABITAT_*` necesarias) o desarmando explícitamente `HABITAT_WORKTREES_DIR`, `HABITAT_TMUX_SOCKET`, `HABITAT_USER` y `HABITAT_PASSWORD_HASH`; con `HABITAT_TMUX_SOCKET` apuntando a un socket propio inexistente (`habitat-shots-pr3`), estado en el scratchpad, `HABITAT_ALLOW_SPAWN=1`, `HABITAT_PROJECTS=<worktree>`, `HABITAT_DOCKER_CLEANUP=0`, `HABITAT_TOKEN=shots`. Verificar con `GET /sessions` que ninguna sesión sembrada tenga `tmux` distinto de `null`. Sembrar 5 sesiones por `POST /hooks` (una `working` con acción, una `waiting`, una `done`, una `idle`, una que quede `offline` si el server lo permite; si no, 4) y el uso por `/status`. **No** llamar al endpoint de spawn (la vista `new-session` sólo abre el diálogo). Matar la instancia **por PID** al terminar y confirmar que no queda nada escuchando en 8399. `LD_LIBRARY_PATH` sólo en el entorno de chrome. Nunca tocar producción (8377, `~/HabitatProdu`).

Capturar: 3 temas × 3 tamaños en `focus`, `board` y `settings`; forja en `phone-list`, `phone-focus` y `new-session` (400×860), y `new-session` en 1440×900. Revisar **cada** captura con Read. Criterios:
- tablero: columnas en orden, vacías colapsadas con contador, en fila en 1440×900 y apiladas en 820×1180/400×860;
- celular: la lista es la pantalla principal (sin pestañas arriba), "te necesita" primero; el foco a pantalla completa con volver y barra inferior;
- `NewSessionDialog`: Dialog centrado en escritorio, Sheet abajo en celular;
- botones sin estilo nativo, nada recortado, barra superior en una fila.

Corregir lo que falle (commits `fix(habitat): …` separados).

- [ ] **Step 3: Verificación final y commit**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
cd ../.. && git add habitat/scripts && git commit -m "chore(habitat): capturas del tablero, el celular y la nueva sesión"
```
El push y el PR los hace el controlador después de la revisión final de toda la branch.
