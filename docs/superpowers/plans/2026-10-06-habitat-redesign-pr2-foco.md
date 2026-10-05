# Rediseño de Habitat — PR 2: modo foco — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el `DetailPanel` por el modo foco nuevo: `FocusView` con `SessionHeader`, una `TerminalPane` siempre montada, `ToolTabs` (Terminal · Git · Archivos · Infra · Quest) que reemplazan el área, la opción de fijar una herramienta al costado de la terminal (`PinnedPanel`, solo en landscape) y los atajos `[` `]` y `Esc`. Las herramientas dejan de ser overlays y quedan migradas a tokens.

**Architecture:** El estado del foco (pestaña activa y panel fijado por sesión, ancho del panel fijado, carpeta actual compartida entre Archivos y Git) vive en un composable de módulo, `useFocusTools`, sin persistir salvo el ancho. `FocusView` compone header, pestañas y área; la terminal se monta una sola vez y se oculta con `v-show` para no cortar el WebSocket al cambiar de pestaña. Cada herramienta es un componente en `components/tools/` que recibe `sessionId` (y `path` donde aplica) y se re-monta con `:key` por sesión. La lógica de datos sigue en los composables existentes (`useGit`, `useProjectTree`, `useFiles`, `useQuestBook`, `useProjects`, `useTerminal`).

**Tech Stack:** Vue 3.5, Pinia, vue-router 4, shadcn-vue 2.4.0 (Reka UI: Tabs, Resizable/Splitter, Dialog), Tailwind v4 con tokens semánticos, lucide-vue-next, vitest + happy-dom + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-10-05-habitat-redesign-design.md` (§2 Modo foco, §3 Componentes, §5, §6 fila PR 2, §7).

## Global Constraints

- Los componentes nuevos usan **solo tokens semánticos** (`bg-surface`, `bg-surface-raised`, `text-text`, `text-muted`, `border-border`, `bg-accent`, `text-accent-foreground`, `bg-terminal-bg`, `text-terminal-fg`, `{bg,text}-state-*`, `bg-stamina-ok`, `bg-stamina-low`, `text-danger`, `bg-danger`, `font-ui`, `font-mono`, `font-display`, `rounded-[var(--radius)]`), nunca colores literales. CSS scoped solo para lo que Tailwind no cubre (`image-rendering: pixelated`). Un color que viene de datos (el color del proyecto) puede ir por `:style`.
- **Preflight de Tailwind sigue desactivado** (se activa en el PR 4). Todo `<button>`, `<a>`, `<input>`, `<select>` y `<textarea>` nuevo lleva estilos explícitos: `border-0` (o un borde con token), `bg-transparent` (o un fondo con token), `text-inherit`/color con token, `font-[inherit]`, `cursor-pointer`; los links, `no-underline`. Se verifica en tests con asserts de clases, como en el PR 1.
- Textos de UI y comentarios en español rioplatense, con la densidad de comentarios del código existente.
- Todo acceso a `localStorage` va en try/catch.
- No cambia el contrato HTTP/WS ni el server.
- Cada herramienta distinta de Terminal tiene botón "Fijar al costado"; el botón **solo aparece en landscape**; si el modo deja de ser landscape con un panel fijado, se desfija y su herramienta pasa a la pestaña activa (spec §2).
- La pestaña Infra solo existe si `session.infra?.dir` (y el server permite spawnear, ver Rulings).
- La pestaña activa se recuerda **por sesión mientras dure la página** (no se persiste). El ancho del panel fijado se persiste en `localStorage` (`habitat.focus.pinnedSize`).
- Atajos: `[` y `]` cambian a la sesión anterior/siguiente; `Esc` cierra el editor y diálogos y desfija el panel. Se desactivan cuando el foco está en la terminal (xterm) o en un input/textarea/select/contenteditable.

## Rulings sobre el spec

- **Panel fijado y pestañas.** Mientras hay una herramienta fijada, la izquierda es siempre la terminal y las pestañas de herramientas eligen qué herramienta ocupa el panel fijado (la pestaña Terminal queda marcada). "Desfijar" vuelve al modo de pestañas que reemplazan el área, con esa herramienta activa. Así la terminal nunca se oculta mientras hay algo fijado, que es lo que pide el spec.
- **Pestaña activa y panel fijado son por sesión**; el ancho del panel fijado es global.
- **Archivos** unifica `FileBrowser` (subir e insertar la ruta en la terminal) y `ProjectExplorer`/`ProjectFiles` (árbol, vista previa, editar en nvim). Los dos listaban el mismo root (`session.cwd`); se usa `/tree` (`useProjectTree`) para listar y `useFiles().upload` para subir.
- **Git y Archivos comparten la carpeta actual** (por sesión), como hoy el `ProjectExplorer` le pasaba `path` al `GitPanel`: navegar en Archivos re-scopea Git a esa carpeta (repos anidados).
- **Editor (nvim):** "Abrir en editor" del header llama `POST /editor/open` con `path: '.'` y muestra el `EditorPane` (la terminal `role=edit`) sobre el área de foco; "Editar en nvim" de Archivos hace lo mismo con el archivo. `Esc` (fuera de la terminal) o su botón lo cierran; nvim sigue vivo.
- **Infra** se muestra si `canSpawn && session.infra?.dir`, igual que hoy (las acciones de infra requieren que el server permita spawnear).
- **Bajar docker** (stacks sin infra configurada) sigue disponible como acción del header, igual que hoy.
- **Confirmaciones:** cerrar sesión y bajar docker/infra usan un `ConfirmDialog` (shadcn Dialog) en vez de `window.confirm`. Las confirmaciones internas de Git (`run(..., confirmMsg)`) quedan con `confirm()` hasta el PR 4: es lógica migrada, no rediseñada.
- **Celular:** el foco a pantalla completa con barra inferior es del PR 3. En este PR, phone usa el mismo `FocusView` (pestañas con scroll horizontal, sin fijar).
- **Git**: la familia `GitPanel` se **mueve** a `components/tools/git/` y se re-estiliza con tokens, sin cambiar su lógica. El diff (`GitDiff`) se muestra dentro del área de la herramienta (overlay absoluto sobre `GitTool`), no sobre toda la app.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/components/ui/{tabs,resizable,dialog}/**` (nuevos, shadcn) | primitivas |
| `src/composables/useFocusTools.ts` (+test) | pestaña activa, panel fijado, ancho, carpeta actual por sesión; desfijar al salir de landscape |
| `src/composables/useFocusShortcuts.ts` (+test) | `[` `]` `Esc` con guardas de foco |
| `src/components/focus/ConfirmDialog.vue` (+test) | confirmación reutilizable |
| `src/components/focus/TerminalPane.vue` (+test) | xterm de la sesión, barra, menú copiar/pegar, modo selección, copiar visible, `fit()` con ResizeObserver |
| `src/components/TermKeys.vue` (mod) | re-estilo con tokens |
| `src/components/focus/SessionHeader.vue` (+test) | avatar, nombre, proyecto · rama, badge, stamina, acciones |
| `src/components/focus/EditorPane.vue` | terminal `role=edit` (nvim) sobre el foco |
| `src/components/focus/ToolTabs.vue` (+test) | barra de pestañas + botón fijar |
| `src/components/focus/PinnedPanel.vue` | Resizable terminal \| herramienta |
| `src/components/focus/FocusView.vue` (+test) | composición |
| `src/components/tools/QuestTool.vue`, `InfraTool.vue`, `FilesTool.vue` (+tests) | herramientas |
| `src/components/tools/git/*` (movidos desde `components/Git*.vue`) + `GitTool.vue` | herramienta Git |
| `src/views/FocusRoute.vue` (mod) | monta `FocusView` |
| Se eliminan | `DetailPanel.vue` (+test), `QuestBook.vue`, `InfraBlock.vue` (+test, migrado), `FileBrowser.vue`, `ProjectExplorer.vue`, `ProjectFiles.vue`, `EditorTerminal.vue`, `components/Git*.vue` (movidos), `styles/git.css` |

Comandos: cliente `cd habitat/client && npx vitest run <ruta>`; suite `npx vitest run`; typecheck + build `npm run build`. Server (no cambia, pero se corre al cerrar): `cd habitat && npm test`.

Branch: `feat/habitat-redesign-foco`, creada desde `main` actualizado (incluye el PR 1).

---

### Task 1: Primitivas shadcn y `useFocusTools`

**Files:**
- Create: `src/components/ui/tabs/**`, `src/components/ui/resizable/**`, `src/components/ui/dialog/**` (generados)
- Create: `src/composables/useFocusTools.ts`, `src/composables/useFocusTools.test.ts`

**Interfaces:**
- Consumes: `useLayoutMode()` → `{ mode: Ref<'landscape'|'portrait'|'phone'> }` (`src/composables/useLayoutMode.ts`).
- Produces:
  - `type ToolId = 'terminal' | 'git' | 'files' | 'infra' | 'quest'`
  - `useFocusTools(sessionId: Ref<string | null>)` → `{ active: ComputedRef<ToolId>, pinned: ComputedRef<Exclude<ToolId,'terminal'> | null>, pinnedSize: Ref<number>, path: ComputedRef<string>, canPin: ComputedRef<boolean>, select(tool: ToolId): void, pin(tool: Exclude<ToolId,'terminal'>): void, unpin(): void, setPath(rel: string): void, setPinnedSize(n: number): void }`
  - `resetFocusTools(): void` (solo para tests: limpia el estado de módulo)
  - Componentes `@/components/ui/tabs` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`), `@/components/ui/resizable` (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`), `@/components/ui/dialog` (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`).

- [ ] **Step 1: Generar las primitivas**

```bash
cd habitat/client
npx shadcn-vue@2.4.0 add tabs resizable dialog --yes
```
(`@latest` requiere Node ≥ 22; en el PR 1 se usó 2.4.0.) Si algún archivo generado importa `@lucide/vue`, cambiarlo a `lucide-vue-next`. Después, en `src/components/ui/{tabs,resizable,dialog}/**`:
- mapear colores de shadcn a nuestros tokens con la misma tabla del PR 1: `bg-primary`/`text-primary-foreground` → `bg-accent`/`text-accent-foreground`; `bg-secondary`, `bg-muted`, `bg-accent` (hover) → `bg-surface-raised`; `text-muted-foreground` → `text-muted`; `bg-popover`, `bg-card` → `bg-surface`; `bg-background` queda; `text-popover-foreground`, `text-card-foreground`, `text-foreground` → `text-text`; `border-input`, `border` sin color → `border-border`; `bg-destructive`/`text-destructive` → `bg-danger`/`text-danger`; `ring-ring` → `ring-accent`; el overlay del Dialog (`bg-black/50` o similar) → `bg-background/80`;
- quitar todas las variantes `dark:`;
- todo `<button>`/trigger generado (TabsTrigger, DialogClose, el botón X del DialogContent) lleva `border-0` y `bg-transparent` (o su token de fondo), `font-[inherit]` y `cursor-pointer`.

Verificar:
```bash
grep -rnE "primary|secondary|muted-foreground|popover|destructive|ring-ring|card-foreground|dark:|white|black|@lucide/vue" src/components/ui/tabs src/components/ui/resizable src/components/ui/dialog
```
Esperado: sin resultados (salvo nombres de variante como `variant: "destructive"` si existieran).

- [ ] **Step 2: Test que falla de `useFocusTools`**

`src/composables/useFocusTools.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('./useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))

import { useFocusTools, resetFocusTools } from './useFocusTools'

beforeEach(() => { localStorage.clear(); mode.value = 'landscape'; resetFocusTools() })

describe('useFocusTools', () => {
  it('arranca en terminal, sin panel fijado ni carpeta', () => {
    const t = useFocusTools(ref('a'))
    expect(t.active.value).toBe('terminal')
    expect(t.pinned.value).toBeNull()
    expect(t.path.value).toBe('')
  })
  it('la pestaña activa es por sesión', () => {
    const id = ref<string | null>('a')
    const t = useFocusTools(id)
    t.select('git')
    id.value = 'b'
    expect(t.active.value).toBe('terminal')
    id.value = 'a'
    expect(t.active.value).toBe('git')
  })
  it('fijar deja la terminal activa y la herramienta al costado', () => {
    const t = useFocusTools(ref('a'))
    t.select('quest')
    t.pin('quest')
    expect(t.pinned.value).toBe('quest')
    expect(t.active.value).toBe('terminal')
  })
  it('con un panel fijado, elegir otra herramienta cambia el panel fijado y la terminal sigue a la izquierda', () => {
    const t = useFocusTools(ref('a'))
    t.pin('quest')
    t.select('git')
    expect(t.pinned.value).toBe('git')
    expect(t.active.value).toBe('terminal')
  })
  it('desfijar vuelve a pestañas con esa herramienta activa', () => {
    const t = useFocusTools(ref('a'))
    t.pin('files')
    t.unpin()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('files')
  })
  it('sólo se puede fijar en landscape', () => {
    const t = useFocusTools(ref('a'))
    mode.value = 'portrait'
    expect(t.canPin.value).toBe(false)
    t.pin('git')
    expect(t.pinned.value).toBeNull()
  })
  it('al salir de landscape se desfija y la herramienta pasa a la pestaña activa', async () => {
    const t = useFocusTools(ref('a'))
    t.pin('git')
    mode.value = 'portrait'
    await nextTick()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('git')
  })
  it('el ancho del panel fijado se persiste y tolera un localStorage que lanza', () => {
    const t = useFocusTools(ref('a'))
    expect(t.pinnedSize.value).toBe(40)
    t.setPinnedSize(55)
    expect(localStorage.getItem('habitat.focus.pinnedSize')).toBe('55')
    resetFocusTools()
    expect(useFocusTools(ref('a')).pinnedSize.value).toBe(55)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => t.setPinnedSize(30)).not.toThrow()
    spy.mockRestore()
  })
  it('la carpeta actual es por sesión', () => {
    const id = ref<string | null>('a')
    const t = useFocusTools(id)
    t.setPath('pkg/api')
    id.value = 'b'
    expect(t.path.value).toBe('')
    id.value = 'a'
    expect(t.path.value).toBe('pkg/api')
  })
  it('sin sesión no rompe', () => {
    const t = useFocusTools(ref(null))
    t.select('git'); t.pin('git'); t.setPath('x')
    expect(t.active.value).toBe('terminal')
    expect(t.pinned.value).toBeNull()
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useFocusTools.test.ts`
Expected: FAIL (no existe el módulo).

- [ ] **Step 4: Implementar**

`src/composables/useFocusTools.ts`:
```ts
import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useLayoutMode } from './useLayoutMode'

// Estado del modo foco. Pestaña activa, panel fijado y carpeta actual son por sesión
// y viven mientras dure la página (no se persisten). El ancho del panel fijado es
// global y se guarda por dispositivo.
export type ToolId = 'terminal' | 'git' | 'files' | 'infra' | 'quest'
export type SideTool = Exclude<ToolId, 'terminal'>

interface SessionTools { active: ToolId; pinned: SideTool | null; path: string }

const SIZE_KEY = 'habitat.focus.pinnedSize'
const DEFAULT_SIZE = 40

function readSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return n >= 15 && n <= 85 ? n : DEFAULT_SIZE
  } catch {
    return DEFAULT_SIZE
  }
}

let bySession = reactive<Record<string, SessionTools>>({})
const pinnedSize = ref(readSize())
let watching = false

export function resetFocusTools() {
  bySession = reactive({})
  pinnedSize.value = readSize()
  watching = false
}

export function useFocusTools(sessionId: Ref<string | null>) {
  const { mode } = useLayoutMode()
  const entry = (): SessionTools | null => {
    const id = sessionId.value
    if (!id) return null
    return (bySession[id] ??= { active: 'terminal', pinned: null, path: '' })
  }
  const peek = (): SessionTools | null => (sessionId.value ? bySession[sessionId.value] ?? null : null)

  // Fijar al costado sólo tiene sentido con ancho de sobra (landscape).
  const canPin = computed(() => mode.value === 'landscape')

  // Al salir de landscape con paneles fijados, cada uno se desfija y su herramienta
  // pasa a ser la pestaña activa de su sesión.
  if (!watching) {
    watching = true
    watch(mode, (m) => {
      if (m === 'landscape') return
      for (const s of Object.values(bySession)) {
        if (s.pinned) { s.active = s.pinned; s.pinned = null }
      }
    })
  }

  function select(tool: ToolId) {
    const s = entry()
    if (!s) return
    // Con un panel fijado la terminal queda a la izquierda: elegir otra herramienta
    // cambia lo que muestra el panel fijado.
    if (s.pinned && tool !== 'terminal') { s.pinned = tool; return }
    s.active = tool
  }
  function pin(tool: SideTool) {
    const s = entry()
    if (!s || !canPin.value) return
    s.pinned = tool
    s.active = 'terminal'
  }
  function unpin() {
    const s = entry()
    if (!s || !s.pinned) return
    s.active = s.pinned
    s.pinned = null
  }
  function setPath(rel: string) {
    const s = entry()
    if (s) s.path = rel
  }
  function setPinnedSize(n: number) {
    pinnedSize.value = n
    try { localStorage.setItem(SIZE_KEY, String(Math.round(n))) } catch { /* sin storage: queda en memoria */ }
  }

  return {
    active: computed<ToolId>(() => peek()?.active ?? 'terminal'),
    pinned: computed<SideTool | null>(() => peek()?.pinned ?? null),
    path: computed(() => peek()?.path ?? ''),
    pinnedSize,
    canPin,
    select, pin, unpin, setPath, setPinnedSize,
  }
}
```

- [ ] **Step 5: Correr**

Run: `cd habitat/client && npx vitest run src/composables/useFocusTools.test.ts && npm run build 2>&1 | tail -1`
Expected: PASS y build OK.

- [ ] **Step 6: Commit**

```bash
git add habitat/client
git commit -m "feat(habitat): primitivas tabs/resizable/dialog y estado del modo foco"
```

---

### Task 2: `TerminalPane` y `TermKeys` con tokens

**Files:**
- Create: `src/components/focus/TerminalPane.vue`, `src/components/focus/TerminalPane.test.ts`
- Modify: `src/components/TermKeys.vue` (re-estilo), `src/components/TermKeys.test.ts` (si asserta clases viejas)

**Interfaces:**
- Consumes: `useTerminal(el, idRef, { onCopied })` → `{ fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode, sendKey }` y `canReadClipboard()` de `src/composables/useTerminal.ts`; `useTermKeys()` → `{ enabled }`; `createLongPress(cb)` → `{ start, move, cancel }` de `src/composables/longPress.ts`; `useZoom()` → `{ zoom }`.
- Produces: `<TerminalPane :session="Session" />` con `defineExpose({ fit, insert })`. Hace `fit()` con un `ResizeObserver` sobre su raíz y cuando cambia el zoom.

Lógica a trasladar **tal cual** desde `src/components/DetailPanel.vue` (líneas 18–37 y 77–106 del archivo actual): `useTerminal`, `canPaste`, el toast "copiado", `onCopyVisible`, el menú contextual (`menu`, `openMenu`, `menuCopy`, `menuPaste`), el long-press táctil (`lp`, `onTouchStart`, `onTouchMove`) y cerrar el menú con `Esc`. El refit con `ResizeObserver` + `watch(zoom)` sale de `src/views/FocusRoute.vue`.

- [ ] **Step 1: Test que falla**

`src/components/focus/TerminalPane.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const selectMode = ref(false)
const term = {
  fit: vi.fn(), insert: vi.fn(), getSelection: vi.fn(() => 'sel'), copySelection: vi.fn(), pasteClipboard: vi.fn(),
  copyVisible: vi.fn(() => true), selectMode, sendKey: vi.fn(),
}
vi.mock('../../composables/useTerminal', () => ({ canReadClipboard: () => true, useTerminal: () => term }))
import TerminalPane from './TerminalPane.vue'

const session = { id: 's1', name: 'ezio', project: 'back', branch: 'feat/x', status: 'working', action: '', since: 0, stamina: 90 } as any

beforeEach(() => { vi.clearAllMocks(); selectMode.value = false })

describe('TerminalPane', () => {
  it('barra con proyecto · rama, seleccionar y copiar visible', async () => {
    const w = mount(TerminalPane, { props: { session } })
    expect(w.get('[data-test="term-title"]').text()).toContain('back')
    expect(w.get('[data-test="term-title"]').text()).toContain('feat/x')
    await w.get('[data-test="term-select"]').trigger('click')
    expect(selectMode.value).toBe(true)
    await w.get('[data-test="term-copy-visible"]').trigger('click')
    expect(term.copyVisible).toHaveBeenCalled()
    expect(w.get('[data-test="term-copied"]').classes()).toContain('opacity-100')
  })
  it('click derecho abre el menú copiar/pegar', async () => {
    const w = mount(TerminalPane, { props: { session }, attachTo: document.body })
    await w.get('[data-test="term-body"]').trigger('contextmenu', { clientX: 10, clientY: 20 })
    await w.get('[data-test="ctx-copy"]').trigger('click')
    expect(term.copySelection).toHaveBeenCalled()
    expect(w.find('[data-test="ctx-copy"]').exists()).toBe(false)
    w.unmount()
  })
  it('expone fit e insert', () => {
    const w = mount(TerminalPane, { props: { session } })
    ;(w.vm as any).insert('hola ')
    expect(term.insert).toHaveBeenCalledWith('hola ')
    ;(w.vm as any).fit()
    expect(term.fit).toHaveBeenCalled()
  })
  it('botones sin estilo nativo (preflight apagado)', () => {
    const w = mount(TerminalPane, { props: { session } })
    for (const sel of ['[data-test="term-select"]', '[data-test="term-copy-visible"]']) {
      expect(w.get(sel).classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer']))
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/focus/TerminalPane.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/focus/TerminalPane.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTerminal, canReadClipboard } from '../../composables/useTerminal'
import { useTermKeys } from '../../composables/useTermKeys'
import { useZoom } from '../../composables/useZoom'
import { createLongPress } from '../../composables/longPress'
import TermKeys from '../TermKeys.vue'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()

const root = ref<HTMLElement | null>(null)
const termEl = ref<HTMLElement | null>(null)
const sessionId = computed(() => props.session.id)
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode, sendKey } =
  useTerminal(termEl, sessionId, { onCopied: flashCopied })
const { enabled: termKeysEnabled } = useTermKeys()
// En contexto inseguro (HTTP/LAN) no se puede leer el portapapeles desde un click:
// "Pegar" se deshabilita y el usuario pega con Ctrl+V (evento nativo).
const canPaste = canReadClipboard()

// Toast efímero "copiado".
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
function flashCopied() {
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
function onCopyVisible() { if (copyVisible()) flashCopied() }

// Menú contextual (copiar / pegar). El navegador reserva Ctrl+Shift+C para DevTools,
// así que el click derecho es la vía explícita de copiar/pegar.
const menu = ref<{ x: number; y: number; hasSel: boolean } | null>(null)
function openMenu(p: { clientX: number; clientY: number }) {
  menu.value = { x: p.clientX, y: p.clientY, hasSel: !!getSelection() }
}
function menuCopy() { copySelection(); menu.value = null }
function menuPaste() { pasteClipboard(); menu.value = null }

// En touch no hay click derecho: un long-press sobre la terminal abre el mismo menú.
const lp = createLongPress((x, y) => openMenu({ clientX: x, clientY: y }))
function onTouchStart(e: TouchEvent) {
  if (selectMode.value) return // en modo selección el gesto es para seleccionar
  const t = e.touches[0]
  if (t) lp.start(t.clientX, t.clientY)
}
function onTouchMove(e: TouchEvent) {
  if (selectMode.value) return
  const t = e.touches[0]
  if (t) lp.move(t.clientX, t.clientY)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') menu.value = null }

// fit() en cada cambio de tamaño: splitter, pestaña, rotación, colapso de la barra.
// Cambiar el zoom del root no dispara resize: re-fitear a mano.
const refit = () => nextTick(() => requestAnimationFrame(() => fit()))
const { zoom } = useZoom()
watch(zoom, refit)
let ro: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('keydown', onKey)
  if (typeof ResizeObserver !== 'undefined' && root.value) { ro = new ResizeObserver(refit); ro.observe(root.value) }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  ro?.disconnect()
  if (copiedTimer) clearTimeout(copiedTimer)
})

const barBtn = 'shrink-0 cursor-pointer whitespace-nowrap rounded-[var(--radius)] border-0 bg-surface-raised px-2 py-1 font-mono text-[11px] text-text hover:text-accent'
defineExpose({ fit, insert })
</script>

<template>
  <div ref="root" class="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-terminal-bg">
    <div class="flex shrink-0 flex-nowrap items-center gap-2.5 border-b border-border bg-surface px-3 py-1.5">
      <span data-test="term-title" class="min-w-0 flex-[0_1_auto] truncate font-mono text-xs text-muted">
        <b class="text-text">{{ session.project }}</b><template v-if="session.branch"> · {{ session.branch }}</template> · tmux
      </span>
      <TermKeys v-if="termKeysEnabled" dense @press="sendKey" />
      <button data-test="term-select" type="button" :class="cn(barBtn, 'ml-auto', selectMode && 'text-accent ring-1 ring-accent')"
        title="Arrastrá con el dedo para seleccionar y copiar" @click="selectMode = !selectMode">
        {{ selectMode ? '✓ seleccionar' : 'seleccionar' }}
      </button>
      <button data-test="term-copy-visible" type="button" :class="barBtn" title="Copiar todo lo visible" @click="onCopyVisible">copiar visible</button>
      <span class="hidden shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wider text-state-working sm:inline-flex">
        <i class="size-1.5 rounded-full bg-state-working motion-safe:animate-pulse" /> en vivo
      </span>
    </div>
    <div
      ref="termEl"
      data-test="term-body"
      :class="cn('min-h-0 flex-1 touch-none overflow-hidden bg-terminal-bg', selectMode && 'cursor-crosshair')"
      aria-label="terminal de la sesión"
      @contextmenu.prevent="openMenu"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="lp.cancel()"
      @touchcancel="lp.cancel()"
    />
    <div data-test="term-copied"
      :class="cn('pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-[var(--radius)] border border-accent bg-surface-raised px-3 py-1.5 font-mono text-xs text-accent transition-opacity', copied ? 'opacity-100' : 'opacity-0')">
      copiado ✓
    </div>
    <template v-if="menu">
      <div class="fixed inset-0 z-40" @click="menu = null" @contextmenu.prevent="menu = null" />
      <div class="fixed z-41 flex min-w-36 flex-col rounded-[var(--radius)] border border-border bg-surface-raised p-1 shadow-lg" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <button data-test="ctx-copy" type="button" :disabled="!menu.hasSel" @click="menuCopy"
          class="flex cursor-pointer items-center justify-between gap-4 rounded border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-xs text-text hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-40">
          Copiar <span class="text-[11px] opacity-50">⌃C</span>
        </button>
        <button data-test="ctx-paste" type="button" :disabled="!canPaste" :title="canPaste ? '' : 'Pegá con Ctrl+V'" @click="menuPaste"
          class="flex cursor-pointer items-center justify-between gap-4 rounded border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-xs text-text hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-40">
          Pegar <span class="text-[11px] opacity-50">⌃V</span>
        </button>
      </div>
    </template>
  </div>
</template>
```

`src/components/TermKeys.vue`: reemplazar su `<style scoped>` por utilidades con tokens. Cada botón: `cursor-pointer rounded-[var(--radius)] border border-border bg-surface-raised px-2 py-1 font-mono text-xs text-text hover:text-accent` (variante `dense`: `px-1.5 py-0.5 text-[11px]`); el contenedor `flex items-center gap-1`. Conservar el `@pointerdown.prevent` (o el handler que use hoy para no robar el foco a xterm) y la emisión `press`. Ajustar `TermKeys.test.ts` sólo si asserta clases viejas.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/focus/TerminalPane.test.ts src/components/TermKeys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): TerminalPane con fit por ResizeObserver y TermKeys con tokens"
```

---

### Task 3: `ConfirmDialog` y `SessionHeader`

**Files:**
- Create: `src/components/focus/ConfirmDialog.vue`, `ConfirmDialog.test.ts`, `src/components/focus/SessionHeader.vue`, `SessionHeader.test.ts`

**Interfaces:**
- Consumes: `@/components/ui/dialog` (Task 1); `SessionAvatar` (`src/components/sessions/SessionAvatar.vue`, props `session`, `size?: 'sm'|'md'`); `STATUS_LABEL`, `STATE_TOKEN` de `src/types.ts`; `useProjects()` → `{ canSpawn, kill(id), colorForProject(name), dockerStatus(id): Promise<string[]>, dockerDown(id) }`; `useProjectTree().openInNvim(id, path)`.
- Produces:
  - `<ConfirmDialog v-model:open="boolean" :title :description :confirm-label :danger? @confirm />`
  - `<SessionHeader :session @open-editor />`. Emite `open-editor` después de un `POST /editor/open` exitoso con `path: '.'`.

- [ ] **Step 1: Tests que fallan**

`src/components/focus/ConfirmDialog.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('confirmar emite confirm y cierra', async () => {
    const w = mount(ConfirmDialog, {
      props: { open: true, title: '¿Cerrar?', description: 'Se pierde', confirmLabel: 'Cerrar', danger: true },
      attachTo: document.body,
    })
    await flushPromises()
    const btn = document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Cerrar')
    expect(btn.className).toContain('bg-danger')
    btn.click()
    await flushPromises()
    expect(w.emitted('confirm')).toHaveLength(1)
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
    w.unmount()
  })
})
```

`src/components/focus/SessionHeader.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const canSpawn = ref(true)
const kill = vi.fn(async () => true)
const dockerStatus = vi.fn(async () => [] as string[])
const dockerDown = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ canSpawn, kill, dockerStatus, dockerDown, colorForProject: () => '#888888' }),
}))
const openInNvim = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjectTree', () => ({ useProjectTree: () => ({ openInNvim }) }))
vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import SessionHeader from './SessionHeader.vue'

const base = { id: 's1', name: 'ezio', project: 'back', branch: 'feat/x', status: 'waiting', action: 'Edit', since: 0, stamina: 80 } as any

beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); canSpawn.value = true })

describe('SessionHeader', () => {
  it('nombre en font-display, proyecto · rama y badge de estado', () => {
    const w = mount(SessionHeader, { props: { session: base } })
    expect(w.get('[data-test="session-name"]').classes()).toContain('font-display')
    expect(w.text()).toContain('back')
    expect(w.text()).toContain('feat/x')
    const badge = w.get('[data-test="state-badge"]')
    expect(badge.text()).toBe('te necesita')
    expect(badge.classes()).toContain('text-state-waiting')
  })
  it('stamina: ancho y color bajo 25%', async () => {
    const w = mount(SessionHeader, { props: { session: base } })
    expect(w.get('[data-test="stamina-fill"]').attributes('style')).toContain('width: 80%')
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-ok')
    await w.setProps({ session: { ...base, stamina: 10 } })
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-low')
  })
  it('abrir en editor llama al server con "." y emite open-editor', async () => {
    const w = mount(SessionHeader, { props: { session: base } })
    await w.get('[data-test="open-editor"]').trigger('click')
    await flushPromises()
    expect(openInNvim).toHaveBeenCalledWith('s1', '.')
    expect(w.emitted('open-editor')).toHaveLength(1)
  })
  it('cerrar pide confirmación antes de matar la sesión', async () => {
    const w = mount(SessionHeader, { props: { session: base }, attachTo: document.body })
    await w.get('[data-test="close-session"]').trigger('click')
    await flushPromises()
    expect(kill).not.toHaveBeenCalled()
    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(kill).toHaveBeenCalledWith('s1')
    w.unmount()
  })
  it('sin spawn no hay cerrar ni bajar docker', async () => {
    canSpawn.value = false
    const w = mount(SessionHeader, { props: { session: base } })
    await flushPromises()
    expect(w.find('[data-test="close-session"]').exists()).toBe(false)
    expect(w.find('[data-test="docker-down"]').exists()).toBe(false)
  })
  it('bajar docker aparece con stacks y sin infra configurada', async () => {
    dockerStatus.mockResolvedValueOnce(['back-ezio'])
    const w = mount(SessionHeader, { props: { session: base } })
    await flushPromises()
    expect(w.get('[data-test="docker-down"]').text()).toContain('1')
  })
  it('acciones sin estilo nativo (preflight apagado)', () => {
    const w = mount(SessionHeader, { props: { session: base } })
    for (const sel of ['[data-test="open-editor"]', '[data-test="close-session"]']) {
      expect(w.get(sel).classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer']))
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/focus/ConfirmDialog.test.ts src/components/focus/SessionHeader.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/focus/ConfirmDialog.vue`:
```vue
<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Confirmación de acciones que pierden trabajo o bajan servicios.
defineProps<{ open: boolean; title: string; description?: string; confirmLabel: string; danger?: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'confirm'): void }>()
function ok() { emit('confirm'); emit('update:open', false) }
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="whitespace-pre-line">{{ description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <button type="button" data-test="confirm-cancel" @click="emit('update:open', false)"
          class="cursor-pointer rounded-[var(--radius)] border border-border bg-transparent px-3 py-1.5 font-[inherit] text-sm text-text hover:bg-surface-raised">
          Cancelar
        </button>
        <button type="button" data-test="confirm-ok" @click="ok"
          :class="cn('cursor-pointer rounded-[var(--radius)] border-0 px-3 py-1.5 font-[inherit] text-sm font-semibold',
            danger ? 'bg-danger text-background' : 'bg-accent text-accent-foreground')">
          {{ confirmLabel }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

`src/components/focus/SessionHeader.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SquarePen, X, Container } from 'lucide-vue-next'
import SessionAvatar from '../sessions/SessionAvatar.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useProjects } from '../../composables/useProjects'
import { useProjectTree } from '../../composables/useProjectTree'
import { STATUS_LABEL, STATE_TOKEN, type Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ (e: 'open-editor'): void }>()
const { canSpawn, kill, colorForProject, dockerStatus, dockerDown } = useProjects()
const { openInNvim } = useProjectTree()

// Clases literales para que Tailwind las detecte.
const BADGE: Record<string, string> = {
  working: 'text-state-working border-state-working', waiting: 'text-state-waiting border-state-waiting',
  done: 'text-state-done border-state-done', idle: 'text-muted border-border', error: 'text-state-error border-state-error',
}
const badge = computed(() => BADGE[STATE_TOKEN[props.session.status]])
const projectColor = computed(() => colorForProject(props.session.project))

const editorErr = ref('')
async function openEditor() {
  editorErr.value = ''
  const r = await openInNvim(props.session.id, '.')
  if (r.ok) emit('open-editor')
  else editorErr.value = r.message || 'no se pudo abrir nvim'
}

// Docker sin infra configurada: stacks levantados dentro del worktree. Al cerrar la
// sesión se bajan solos; el botón es para liberar puertos/RAM sin cerrarla.
const dockerStacks = ref<string[]>([])
const dockerBusy = ref(false)
async function refreshDocker() {
  const id = props.session.id
  dockerStacks.value = []
  if (!canSpawn.value || props.session.infra?.dir) return
  const stacks = await dockerStatus(id)
  if (props.session.id === id) dockerStacks.value = stacks // la sesión pudo cambiar mientras tanto
}
watch(() => [props.session.id, canSpawn.value] as const, refreshDocker, { immediate: true })
async function doDockerDown() {
  dockerBusy.value = true
  try { await dockerDown(props.session.id) } finally { dockerBusy.value = false }
  refreshDocker()
}

const confirmClose = ref(false)
const confirmDocker = ref(false)
const action = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1.5 font-[inherit] text-xs font-semibold text-text hover:text-accent disabled:cursor-default disabled:opacity-50'
</script>

<template>
  <header class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[calc(var(--radius)+4px)] border border-border bg-surface px-3 py-2">
    <SessionAvatar :session="session" />
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <h1 data-test="session-name" class="m-0 truncate font-display text-lg font-semibold text-text">{{ session.name }}</h1>
      <span data-test="state-badge" :class="cn('rounded-[var(--radius-pill)] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', badge)">
        {{ STATUS_LABEL[session.status] }}
      </span>
      <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-raised" :title="`Stamina ${session.stamina}%`" :aria-label="`Stamina ${session.stamina}%`">
        <i data-test="stamina-fill" class="block h-full" :class="session.stamina < 25 ? 'bg-stamina-low' : 'bg-stamina-ok'" :style="{ width: session.stamina + '%' }" />
      </span>
      <span class="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-muted">
        <i class="size-2 shrink-0 rounded-sm" :style="{ background: projectColor }" />
        {{ session.project }}<template v-if="session.branch"> · <span class="text-accent">{{ session.branch }}</span></template>
      </span>
      <span v-if="editorErr" class="text-xs text-danger">{{ editorErr }}</span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button data-test="open-editor" type="button" :class="action" title="Abrir nvim en la carpeta de la sesión" @click="openEditor">
        <SquarePen class="size-3.5" /><span class="hidden sm:inline">Editor</span>
      </button>
      <button v-if="canSpawn && dockerStacks.length" data-test="docker-down" type="button" :class="action" :disabled="dockerBusy"
        :title="`Bajar containers: ${dockerStacks.join(', ')}`" @click="confirmDocker = true">
        <Container class="size-3.5" />{{ dockerBusy ? 'Bajando…' : `Bajar docker (${dockerStacks.length})` }}
      </button>
      <button v-if="canSpawn" data-test="close-session" type="button" :class="cn(action, 'hover:text-danger')" @click="confirmClose = true">
        <X class="size-3.5" /><span class="hidden sm:inline">Cerrar</span>
      </button>
    </div>
    <ConfirmDialog v-model:open="confirmClose" :title="`¿Cerrar la sesión &quot;${session.name}&quot;?`"
      description="Se pierde el trabajo en curso." confirm-label="Cerrar sesión" danger @confirm="kill(session.id)" />
    <ConfirmDialog v-model:open="confirmDocker" title="¿Bajar los containers de esta sesión?"
      :description="`${dockerStacks.join(', ')}\n\nSe eliminan containers y red; los volúmenes con datos quedan.`"
      confirm-label="Bajar" danger @confirm="doDockerDown" />
  </header>
</template>
```
Nota: `:title` con comillas: si el entrecomillado HTML queda raro, usar comillas tipográficas `“…”` en el texto (`` `¿Cerrar la sesión “${session.name}”?` ``).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/focus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): SessionHeader con stamina, editor y cierre confirmado"
```

---

### Task 4: `QuestTool` e `InfraTool`

**Files:**
- Create: `src/components/tools/QuestTool.vue`, `QuestTool.test.ts`, `src/components/tools/InfraTool.vue`, `InfraTool.test.ts`
- Delete: `src/components/QuestBook.vue`, `src/components/InfraBlock.vue`, `src/components/InfraBlock.test.ts` (migrado a `InfraTool.test.ts`, sin perder casos)

**Interfaces:**
- Consumes: `useQuestBook()` → `{ book, loading, error, load(id) }`; `questIcon(status)` de `src/composables/questIcons`; `ago` de `src/sprites`; `useProjects()` → `{ infraUp(id): Promise<{ok, message}>, dockerDown(id): Promise<{ok, message}> }`; `ConfirmDialog` (Task 3).
- Produces: `<QuestTool :session-id="string" />`, `<InfraTool :session="Session" />`. Ninguno es overlay: ocupan el contenedor que les toque (pestaña o panel fijado), con scroll propio (`h-full overflow-y-auto`).

- [ ] **Step 1: Tests que fallan**

`src/components/tools/QuestTool.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const book = ref<any>(null)
const load = vi.fn(async () => {
  book.value = {
    synopsis: 'Migrar el login',
    quests: [
      { id: 'a', title: 'Armar el form', status: 'completed', loose: false, dialogue: [], originPrompt: 'hacé el login' },
      { id: 'b', title: 'Validar', status: 'in_progress', loose: false, dialogue: [{ claude: 'Listo el form', you: 'dale', ts: 0 }] },
    ],
  }
})
vi.mock('../../composables/useQuestBook', () => ({ useQuestBook: () => ({ book, loading: ref(false), error: ref(''), load }) }))
import QuestTool from './QuestTool.vue'

describe('QuestTool', () => {
  it('carga el libro de la sesión y muestra sinopsis y progreso', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(load).toHaveBeenCalledWith('s1')
    expect(w.text()).toContain('Migrar el login')
    expect(w.get('[data-test="quest-progress"]').text()).toContain('1/2')
  })
  it('expandir una quest muestra el diálogo', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    await w.findAll('[data-test="quest-row"]')[1].trigger('click')
    expect(w.text()).toContain('Listo el form')
    expect(w.text()).toContain('dale')
  })
  it('no es un overlay', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})
```

`src/components/tools/InfraTool.test.ts`: migrar **todos** los casos de `src/components/InfraBlock.test.ts` cambiando `InfraBlock` por `InfraTool` (mismos `data-test`: `infra-state`, `infra-up`, `infra-down`). Donde el test viejo dependía de `window.confirm` para bajar, ahora el flujo es: click en `infra-down` → aparece el `ConfirmDialog` → click en `[data-test="confirm-ok"]` (buscar en `document.body`, montando con `attachTo: document.body`) → se llama `dockerDown`. Sumar un caso: los puertos se muestran como links con `no-underline`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/tools`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`QuestTool.vue`: misma lógica que `src/components/QuestBook.vue` (script completo: `useQuestBook`, `expanded`, `openText`, `planQuests`, `total`, `done`, `pct`, `toggle`, `exKey`, `toggleText`), con prop `sessionId` en lugar de `id`, sin `emit('close')` ni overlay. Template:
- raíz `div.h-full.overflow-y-auto.p-4` (sin `role="dialog"`);
- estados: `Abriendo el libro…`, `No se pudo abrir el libro ({{ error }})`, `Sin quests registradas todavía.`;
- cabecera: kicker `Quest Book` (`text-xs uppercase tracking-wider text-muted`), sinopsis (`font-display text-lg text-text`), barra de progreso (`h-1.5 rounded-full bg-surface-raised` con relleno `bg-accent` y `:style="{ width: pct + '%' }"`) y `<span data-test="quest-progress">{{ done }}/{{ total }}</span>`;
- cada quest: `<button data-test="quest-row" type="button" class="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] text-text hover:bg-surface-raised" :aria-expanded>` con el ícono (`<img class="pixel size-4">`, conservar `image-rendering: pixelated` en un `<style scoped>` mínimo), el título y un `ChevronDown` de lucide que rota cuando está abierta; color del título por estado: `completed` → `text-muted line-through`, `in_progress` → `text-state-working`, resto `text-text`;
- detalle: "Pedido" (`originPrompt`, si no es `loose`), diálogo (bloques "Claude" con `ago(ex.ts)` y texto clampado/expandible con `toggleText`, y "Vos" con `ex.you || '…esperando tu respuesta'`), y la línea de historial vieja `v-if="q.monster"` (quests persistidas con combate) con `text-xs text-muted`.

`InfraTool.vue`: misma lógica que `src/components/InfraBlock.vue` (estado, `LABEL`, `ports`, `busy`, `error`, `up()`, `down()`), con dos cambios: `down()` ya no usa `window.confirm` sino que abre `ConfirmDialog` (`title="¿Bajar la infra de esta sesión?"`, `description="Los volúmenes con datos quedan."`, `confirm-label="Bajar"`, `danger`) y el `@confirm` ejecuta la baja. Template con tokens:
- cabecera: punto de estado (`size-2.5 rounded-full`, clase literal `bg-state-done` up, `bg-state-working` partial, `bg-state-idle` off), "Infra", `<span data-test="infra-state">{{ LABEL[state] }}</span>`, y el nombre del stack en `font-mono text-xs text-muted`;
- puertos: `<a>` por puerto con `class="rounded-[var(--radius)] bg-surface-raised px-2 py-1 font-mono text-xs text-accent no-underline hover:underline"`;
- acciones: botones `data-test="infra-up"` y `data-test="infra-down"` con `cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 py-1.5 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50`;
- error en `text-sm text-danger`.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/tools`
Expected: PASS. (`DetailPanel.vue` todavía importa `QuestBook`/`InfraBlock`: en este paso, dejar el borrado de esos dos archivos para la Task 7, que elimina `DetailPanel`. Borrar sólo `InfraBlock.test.ts`, ya migrado.)

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): QuestTool e InfraTool en línea, con tokens"
```

---

### Task 5: `FilesTool`

**Files:**
- Create: `src/components/tools/FilesTool.vue`, `FilesTool.test.ts`

**Interfaces:**
- Consumes: `useProjectTree()` → `{ listing, loading, error, loadTree(id, path), loadFile(id, path): Promise<FileContent>, openInNvim(id, path) }` (`TreeEntry { name, rel, isDir, size, isRepo }`, `FileContent` = `{text,size} | {binary,size} | {tooLarge,size}`); `useFiles()` → `{ upload(id, file, password?) }`, `limitMB(bytes)`, `quotePath(p)`, `type TooLarge` de `src/composables/useFiles`; `fmt` de `src/sprites`.
- Produces: `<FilesTool :session-id :path @navigate="(rel) => …" @insert="(text) => …" @opened />`.
  - `path`: carpeta actual (la maneja `useFocusTools`, compartida con Git); `navigate` pide cambiarla.
  - `insert`: texto a escribir en la terminal (ruta citada con espacio final), para "Insertar en la terminal" y después de subir un archivo.
  - `opened`: nvim abrió el archivo; el padre muestra el `EditorPane`.

Lógica a trasladar: la navegación, vista previa y "editar en nvim" de `src/components/ProjectFiles.vue`; la subida con reintento por contraseña (`doUpload`, `onFile`, `triggerUpload`) de `src/components/FileBrowser.vue`, donde `afterUpload(rel)` ahora emite `insert(quotePath(rel) + ' ')`. Las migas de pan salen del `ProjectExplorer.vue`.

- [ ] **Step 1: Test que falla**

`src/components/tools/FilesTool.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const listing = ref<any>({
  root: 'proj', rel: '', breadcrumbs: [],
  entries: [
    { name: 'src', rel: 'src', isDir: true, size: 0, isRepo: false },
    { name: 'mi archivo.md', rel: 'mi archivo.md', isDir: false, size: 1200, isRepo: false },
  ],
})
const loadTree = vi.fn(async () => {})
const loadFile = vi.fn(async () => ({ text: '# hola', size: 6 }))
const openInNvim = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjectTree', () => ({
  useProjectTree: () => ({ listing, loading: ref(false), error: ref(''), loadTree, loadFile, openInNvim }),
}))
const upload = vi.fn(async () => ({ rel: '.habitat-uploads/foto.png' }))
vi.mock('../../composables/useFiles', async (orig) => ({ ...(await orig<any>()), useFiles: () => ({ upload }) }))
import FilesTool from './FilesTool.vue'

beforeEach(() => vi.clearAllMocks())

describe('FilesTool', () => {
  it('lista la carpeta actual de la sesión', async () => {
    mount(FilesTool, { props: { sessionId: 's1', path: 'pkg' } })
    await flushPromises()
    expect(loadTree).toHaveBeenCalledWith('s1', 'pkg')
  })
  it('click en carpeta pide navegar', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[0].trigger('click')
    expect(w.emitted('navigate')?.[0]).toEqual(['src'])
  })
  it('click en archivo muestra la vista previa; insertar escribe la ruta citada', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[1].trigger('click')
    await flushPromises()
    expect(w.get('[data-test="file-preview"]').text()).toContain('# hola')
    await w.get('[data-test="file-insert"]').trigger('click')
    expect(w.emitted('insert')?.[0]).toEqual(['"mi archivo.md" '])
  })
  it('editar en nvim emite opened', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[1].trigger('click')
    await flushPromises()
    await w.get('[data-test="file-edit"]').trigger('click')
    await flushPromises()
    expect(openInNvim).toHaveBeenCalledWith('s1', 'mi archivo.md')
    expect(w.emitted('opened')).toHaveLength(1)
  })
  it('subir un archivo inserta su ruta', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    const input = w.get('[data-test="file-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'foto.png')] })
    await input.trigger('change')
    await flushPromises()
    expect(upload).toHaveBeenCalled()
    expect(w.emitted('insert')?.[0]).toEqual(['.habitat-uploads/foto.png '])
  })
  it('entradas y acciones sin estilo nativo (preflight apagado)', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    expect(w.findAll('[data-test="file-entry"]')[0].classes()).toEqual(expect.arrayContaining(['border-0', 'bg-transparent']))
    expect(w.get('[data-test="file-upload"]').classes()).toContain('border-0')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/tools/FilesTool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/tools/FilesTool.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Folder, FileText, Upload, SquarePen, TerminalSquare } from 'lucide-vue-next'
import { useProjectTree, type TreeEntry, type FileContent } from '../../composables/useProjectTree'
import { useFiles, limitMB, quotePath, type TooLarge } from '../../composables/useFiles'
import { fmt } from '../../sprites'

// Explorador del working dir de la sesión: navegar, previsualizar, insertar la ruta
// en la terminal, editar en nvim y subir archivos. La carpeta actual la maneja el
// padre (compartida con Git).
const props = defineProps<{ sessionId: string; path: string }>()
const emit = defineEmits<{ (e: 'navigate', rel: string): void; (e: 'insert', text: string): void; (e: 'opened'): void }>()

const { listing, loading, error, loadTree, loadFile, openInNvim } = useProjectTree()
const { upload } = useFiles()
const preview = ref<{ path: string; content: FileContent } | null>(null)
const busy = ref('')
const actionErr = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

watch(() => [props.sessionId, props.path] as const, ([id, path]) => {
  if (id) { preview.value = null; loadTree(id, path) }
}, { immediate: true })

function openEntry(e: TreeEntry) {
  if (e.isDir) emit('navigate', e.rel)
  else showPreview(e.rel)
}
async function showPreview(rel: string) {
  actionErr.value = ''
  try { preview.value = { path: rel, content: await loadFile(props.sessionId, rel) } }
  catch { actionErr.value = 'no se pudo leer el archivo' }
}
async function editInNvim(rel: string) {
  busy.value = rel; actionErr.value = ''
  const r = await openInNvim(props.sessionId, rel)
  busy.value = ''
  if (r.ok) emit('opened')
  else actionErr.value = r.message || 'no se pudo abrir nvim'
}
function insertPath(rel: string) { emit('insert', quotePath(rel) + ' ') }

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // permitir re-subir el mismo archivo
  if (!file) return
  actionErr.value = ''
  uploading.value = true
  try { await doUpload(file) }
  catch (err) { actionErr.value = err instanceof Error ? err.message : 'falló la subida' }
  finally { uploading.value = false }
}
// Ante 413 pide la contraseña y reintenta una vez, sólo si el server tiene una
// configurada: si no, pedirla mandaría a un reintento que falla igual.
async function doUpload(file: File) {
  try {
    insertPath((await upload(props.sessionId, file)).rel)
  } catch (err) {
    const tl = err as TooLarge | undefined
    if (!tl?.tooLarge) throw err
    if (!tl.needsPassword) { actionErr.value = `"${file.name}" supera el límite de ${limitMB(tl.max)}`; return }
    const pw = window.prompt(`"${file.name}" supera los ${limitMB(tl.max)}. Contraseña para subirlo igual:`)
    if (!pw) { actionErr.value = 'subida cancelada'; return }
    insertPath((await upload(props.sessionId, file, pw)).rel)
  }
}

const crumb = 'cursor-pointer rounded border-0 bg-transparent px-1 font-mono text-xs text-muted hover:text-accent'
const act = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:opacity-50'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3">
    <div class="flex items-center gap-2">
      <nav class="flex min-w-0 flex-1 flex-wrap items-center">
        <button type="button" :class="crumb" @click="emit('navigate', '')">{{ listing?.root || '~' }}</button>
        <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
          <span class="text-xs text-muted">/</span>
          <button type="button" :class="crumb" @click="emit('navigate', c.rel)">{{ c.name }}</button>
        </template>
      </nav>
      <button data-test="file-upload" type="button" :class="act" :disabled="uploading" @click="fileInput?.click()">
        <Upload class="size-3.5" />{{ uploading ? 'Subiendo…' : 'Subir' }}
      </button>
      <input ref="fileInput" data-test="file-upload-input" type="file" hidden @change="onFile" />
    </div>
    <p v-if="actionErr" class="m-0 text-sm text-danger">{{ actionErr }}</p>
    <div class="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(12rem,1fr)_2fr]">
      <ul class="m-0 min-h-0 list-none overflow-y-auto p-0">
        <li v-if="loading" class="px-2 py-1 text-sm text-muted">cargando…</li>
        <li v-else-if="error === 'sin-dir'" class="px-2 py-1 text-sm text-muted">sesión sin working dir</li>
        <li v-else-if="error" class="px-2 py-1 text-sm text-muted">no se pudo listar ({{ error }})</li>
        <li v-for="e in listing?.entries || []" :key="e.rel">
          <button data-test="file-entry" type="button" @click="openEntry(e)" @dblclick="!e.isDir && editInNvim(e.rel)"
            class="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-sm text-text hover:bg-surface-raised">
            <Folder v-if="e.isDir" class="size-4 shrink-0 text-accent" /><FileText v-else class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
            <span v-if="e.isRepo" class="rounded bg-surface-raised px-1.5 text-[10px] uppercase text-muted">git</span>
            <span v-else-if="!e.isDir" class="text-xs tabular-nums text-muted">{{ fmt(e.size) }}</span>
          </button>
        </li>
        <li v-if="!loading && !error && !(listing?.entries || []).length" class="px-2 py-1 text-sm text-muted">Carpeta vacía</li>
      </ul>
      <section v-if="preview" data-test="file-preview" class="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border border-border">
        <header class="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1.5">
          <b class="min-w-0 flex-1 truncate font-mono text-xs text-text">{{ preview.path }}</b>
          <button data-test="file-insert" type="button" :class="act" @click="insertPath(preview.path)"><TerminalSquare class="size-3.5" />Insertar en la terminal</button>
          <button data-test="file-edit" type="button" :class="act" :disabled="busy === preview.path" @click="editInNvim(preview.path)"><SquarePen class="size-3.5" />Editar en nvim</button>
        </header>
        <pre v-if="'text' in preview.content" class="m-0 min-h-0 flex-1 overflow-auto bg-terminal-bg p-3 font-mono text-xs text-terminal-fg">{{ preview.content.text }}</pre>
        <p v-else-if="'binary' in preview.content" class="m-0 p-3 text-sm text-muted">archivo binario ({{ preview.content.size }} bytes)</p>
        <p v-else class="m-0 p-3 text-sm text-muted">archivo muy grande ({{ preview.content.size }} bytes): abrilo en nvim.</p>
      </section>
      <p v-else class="m-0 hidden p-3 text-sm text-muted md:block">Elegí un archivo para previsualizarlo. Doble click o "Editar en nvim" para editarlo.</p>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/tools/FilesTool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): FilesTool unifica explorador, vista previa, nvim y subidas"
```

---

### Task 6: `GitTool` (mover y re-estilar la familia Git)

**Files:**
- Move (con `git mv`): `src/components/{GitPanel,GitWork,GitBranches,GitCommits,GitDiff,GitBranchDiff,GitIcon}.vue` y sus tests `{GitPanel,GitWork,GitBranches,GitCommits}.test.ts` → `src/components/tools/git/`. `GitPanel.vue` pasa a llamarse `GitTool.vue` (y su test `GitTool.test.ts`).
- Delete: `src/styles/git.css`
- Modify: los archivos movidos (imports relativos `../composables/...` → `../../../composables/...`, `../stores/...` → `../../../stores/...`, `../types` → `../../../types`).

**Interfaces:**
- Consumes: `useGit`, `canCreatePr`, `parseDiff`, `useSessions` (sin cambios).
- Produces: `<GitTool :session-id="string" :path="string" />` (antes `GitPanel` con props `id` y `path`). Sigue exponiendo `defineExpose({ repoLabel, refresh })`. Muestra la etiqueta del repo (`repoLabel`: nombre, rama, ↑ahead ↓behind) en su propia cabecera, porque ya no existe el `ProjectExplorer` que la mostraba.

Reglas de la migración (sin cambiar la lógica de `<script>`, salvo el renombre de `id` → `sessionId` y los imports):
1. **Estilos:** borrar `import '../styles/git.css'` y los `<style scoped>`; pasar todo a utilidades con tokens. Equivalencias de las clases compartidas de `git.css`:
   - `g-btn` → `inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:cursor-default disabled:opacity-50`; con `primary` → `bg-accent text-accent-foreground hover:text-accent-foreground`; con `danger` → `hover:text-danger`; `g-flat` → `bg-transparent`.
   - `g-count` → `rounded-full bg-surface px-1.5 text-[10px] tabular-nums text-muted` (dentro de un botón primario: `bg-accent-foreground/20 text-accent-foreground`).
   - `g-group` → `flex flex-col gap-1.5`; su `h4` → `m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted`.
   - `g-muted` / `g-empty` → `text-sm text-muted`; `g-err` → `m-0 text-sm text-danger`.
   - `g-st` (letra de estado M/A/D/?) → `w-4 text-center font-mono text-xs` + color literal por estado: modificado `text-state-working`, agregado `text-state-done`, borrado `text-danger`, sin trackear `text-muted`, conflicto `text-state-error`.
   - `g-input` / `g-select` → `rounded-[var(--radius)] border border-border bg-background px-2 py-1 font-[inherit] text-sm text-text`.
   - Pestañas internas (`gp-tabs`): `role="tablist"` se conserva; cada botón `cursor-pointer border-0 border-b-2 bg-transparent px-3 py-1.5 font-[inherit] text-sm` con `border-accent text-text` activo y `border-transparent text-muted` inactivo.
   - Diff (`GitDiff`): líneas agregadas `bg-state-done/15 text-terminal-fg`, borradas `bg-danger/15 text-terminal-fg`, contexto `text-muted`, cuerpo `bg-terminal-bg font-mono text-xs`; el número de línea `text-muted/70`.
   - Clases específicas de cada componente (`gw-*`, `gc-*`, `gb-*`): traducir su CSS actual a utilidades equivalentes con tokens (layout igual, colores por token).
2. **Selectores de test:** los tests movidos usan clases (`.gp-tabs button`, `.g-btn`, `.gc-row`, `.gc-toggle`, `.gw-commit .g-btn`). Agregar `data-test` equivalentes en el template (`git-tab`, `git-btn`, `git-commit-row`, `git-commit-toggle`, `git-commit-actions`) y actualizar los tests para usarlos, sin perder ningún caso.
3. **Diff dentro de la herramienta:** la raíz de `GitTool` es `relative flex h-full min-h-0 flex-col`; `GitDiff` deja de ser `position: fixed` a pantalla completa y pasa a `absolute inset-0 z-10 flex flex-col bg-surface` dentro de `GitTool`, con su botón cerrar (`border-0 bg-transparent cursor-pointer`).
4. **Cabecera del repo:** arriba de las pestañas internas, si `repoLabel`: `<p data-test="git-repo" class="m-0 font-mono text-xs text-muted">repo: <b class="text-text">{{ repoLabel.name }}</b> · ⌥ <b class="text-text">{{ repoLabel.branch }}</b> · ↑{{ repoLabel.ahead }} ↓{{ repoLabel.behind }}</p>`.
5. **Barra de acciones** (`gp-actions`): `flex flex-wrap gap-2 border-t border-border bg-surface p-2`, fija abajo (la raíz es columna y el cuerpo `min-h-0 flex-1 overflow-y-auto`).
6. **Link del PR** (`prUrl`): `text-accent no-underline hover:underline`.

- [ ] **Step 1: Mover y verificar que los tests movidos fallan**

```bash
cd habitat/client
mkdir -p src/components/tools/git
for f in GitPanel GitWork GitBranches GitCommits GitDiff GitBranchDiff GitIcon; do git mv src/components/$f.vue src/components/tools/git/$f.vue; done
for f in GitPanel GitWork GitBranches GitCommits; do git mv src/components/$f.test.ts src/components/tools/git/$f.test.ts; done
git mv src/components/tools/git/GitPanel.vue src/components/tools/git/GitTool.vue
git mv src/components/tools/git/GitPanel.test.ts src/components/tools/git/GitTool.test.ts
npx vitest run src/components/tools/git
```
Expected: FAIL (imports rotos). Esto confirma que los tests cubren los archivos movidos.

- [ ] **Step 2: Ajustar imports, renombrar la prop y actualizar los tests**

En `GitTool.vue`: `defineProps<{ sessionId: string; path: string }>()` y reemplazar los usos de `props.id` por `props.sessionId` (en `GitBranches`/`GitCommits` se les sigue pasando `:id="props.sessionId"`, sus props internas no cambian). En los tests, montar `GitTool` con `{ sessionId, path }`. Cambiar los selectores por `data-test` según la regla 2.

Run: `npx vitest run src/components/tools/git`
Expected: PASS (todavía con el CSS viejo: `git.css` sigue importado; sólo cambian rutas y selectores).

- [ ] **Step 3: Re-estilar con tokens y borrar `git.css`**

Aplicar las reglas 1 y 3–6 en los siete componentes. Borrar `src/styles/git.css` (`git rm`). Verificar:
```bash
grep -rn "git.css\|<style" src/components/tools/git
grep -rnoE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/components/tools/git
```
Expected: el primero sólo puede mostrar `<style scoped>` con `image-rendering` si hiciera falta (no debería); el segundo, sin resultados.

Agregar a `GitTool.test.ts` un caso: los botones de la barra de acciones tienen `border-0` y `cursor-pointer`; y otro: el diff se abre dentro de la herramienta (el contenedor del diff tiene la clase `absolute`).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/tools/git && npm run build 2>&1 | tail -1`
Expected: PASS y build OK. (`ProjectExplorer.vue` todavía importa `./GitPanel.vue`: actualizarlo a `./tools/git/GitTool.vue` con `:session-id` para que el build pase; se borra en la Task 7.)

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "refactor(habitat): GitTool — familia git movida a tools/git y estilada con tokens"
```

---

### Task 7: `ToolTabs`, `PinnedPanel`, `EditorPane`, `FocusView` y fuera el `DetailPanel`

**Files:**
- Create: `src/components/focus/ToolTabs.vue`, `ToolTabs.test.ts`, `src/components/focus/PinnedPanel.vue`, `src/components/focus/EditorPane.vue`, `src/components/focus/FocusView.vue`, `FocusView.test.ts`
- Modify: `src/views/FocusRoute.vue`, `src/views/FocusRoute.test.ts`
- Delete: `src/components/DetailPanel.vue`, `DetailPanel.test.ts`, `QuestBook.vue`, `InfraBlock.vue`, `FileBrowser.vue`, `ProjectExplorer.vue`, `ProjectFiles.vue`, `EditorTerminal.vue`

**Interfaces:**
- Consumes: `useFocusTools` (Task 1), `TerminalPane` (Task 2, expone `fit`, `insert`), `SessionHeader` (Task 3, emite `open-editor`), `QuestTool`/`InfraTool` (Task 4), `FilesTool` (Task 5, emite `navigate`, `insert`, `opened`), `GitTool` (Task 6), `@/components/ui/resizable`, `useProjects().canSpawn`, `useTerminal(el, idRef, { role: 'edit' })`, `useTermKeys`, `TermKeys`.
- Produces:
  - `<ToolTabs :session />`: pestañas Terminal · Git · Archivos · Infra (si `canSpawn && session.infra?.dir`) · Quest, y el botón "Fijar al costado" para la herramienta activa (no Terminal), visible sólo si `canPin`.
  - `<PinnedPanel :tool :session :size @resize @unpin>`: slot `left` (la terminal) + la herramienta fijada en un `ResizablePanelGroup` horizontal.
  - `<EditorPane :session-id @close />`.
  - `<FocusView />`: foco de `store.selected`, con `defineExpose({ fit })`.
  - `FocusRoute` monta `FocusView` (el estado vacío no cambia).

- [ ] **Step 1: Tests que fallan**

`src/components/focus/ToolTabs.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
const canSpawn = ref(true)
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn }) }))
import ToolTabs from './ToolTabs.vue'
import { useFocusTools, resetFocusTools } from '../../composables/useFocusTools'

const sess = (infra?: object) => ({ id: 's1', name: 'ezio', project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100, infra }) as any

beforeEach(() => { resetFocusTools(); mode.value = 'landscape'; canSpawn.value = true })

describe('ToolTabs', () => {
  it('Infra sólo con infra configurada', () => {
    const labels = (s: any) => mount(ToolTabs, { props: { session: s } }).findAll('[data-test="tool-tab"]').map((b) => b.text())
    expect(labels(sess())).toEqual(['Terminal', 'Git', 'Archivos', 'Quest'])
    expect(labels(sess({ dir: '/wt/infra', stack: 'x', ports: {}, branch: 'b' }))).toEqual(['Terminal', 'Git', 'Archivos', 'Infra', 'Quest'])
  })
  it('elegir una pestaña la activa para esa sesión', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    expect(useFocusTools(ref('s1')).active.value).toBe('git')
    expect(w.findAll('[data-test="tool-tab"]')[1].attributes('aria-selected')).toBe('true')
  })
  it('fijar al costado sólo en landscape y no para Terminal', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(false) // Terminal activa
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(true)
    mode.value = 'portrait'
    await w.vm.$nextTick()
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(false)
  })
  it('fijar deja la herramienta en el panel y desfija al cambiar de modo', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    await w.get('[data-test="pin-tool"]').trigger('click')
    const t = useFocusTools(ref('s1'))
    expect(t.pinned.value).toBe('git')
    mode.value = 'portrait'
    await w.vm.$nextTick()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('git')
  })
  it('pestañas sin estilo nativo (preflight apagado)', () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    expect(w.findAll('[data-test="tool-tab"]')[0].classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer']))
  })
})
```

`src/components/focus/FocusView.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn: ref(true) }) }))
const insert = vi.fn()
vi.mock('./TerminalPane.vue', () => ({ default: defineComponent({ props: ['session'], setup(_, { expose }) { expose({ fit: () => {}, insert }); return () => h('div', { 'data-test': 'terminal-pane' }) } }) }))
vi.mock('./SessionHeader.vue', () => ({ default: defineComponent({ props: ['session'], emits: ['open-editor'], setup: (_, { emit }) => () => h('button', { 'data-test': 'header-editor', onClick: () => emit('open-editor') }) }) }))
vi.mock('./EditorPane.vue', () => ({ default: defineComponent({ props: ['sessionId'], emits: ['close'], setup: () => () => h('div', { 'data-test': 'editor-pane' }) }) }))
const stub = (t: string, emits: string[] = []) => ({ default: defineComponent({ props: ['sessionId', 'session', 'path'], emits, setup: (_, { emit }) => () => h('div', { 'data-test': t, onClick: () => emit(emits[0] as any, '"a b.md" ') }) }) })
vi.mock('../tools/git/GitTool.vue', () => stub('git-tool'))
vi.mock('../tools/FilesTool.vue', () => stub('files-tool', ['insert', 'navigate', 'opened']))
vi.mock('../tools/QuestTool.vue', () => stub('quest-tool'))
vi.mock('../tools/InfraTool.vue', () => stub('infra-tool'))
import FocusView from './FocusView.vue'
import { useSessions } from '../../stores/sessions'
import { useFocusTools, resetFocusTools } from '../../composables/useFocusTools'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

beforeEach(() => { setActivePinia(createPinia()); resetFocusTools(); mode.value = 'landscape'; vi.clearAllMocks() })

describe('FocusView', () => {
  it('la terminal queda montada al cambiar de pestaña', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    useFocusTools(ref('a')).select('git'); await flushPromises()
    expect(w.find('[data-test="git-tool"]').exists()).toBe(true)
    const pane = w.get('[data-test="terminal-pane"]')
    expect(pane.isVisible()).toBe(false)
    useFocusTools(ref('a')).select('terminal'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
  })
  it('insertar desde Archivos escribe en la terminal', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    useFocusTools(ref('a')).select('files'); await flushPromises()
    await w.get('[data-test="files-tool"]').trigger('click')
    expect(insert).toHaveBeenCalledWith('"a b.md" ')
  })
  it('con un panel fijado se ven terminal y herramienta a la vez', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    useFocusTools(ref('a')).pin('quest'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
    expect(w.find('[data-test="quest-tool"]').exists()).toBe(true)
    expect(w.find('[data-test="pinned-panel"]').exists()).toBe(true)
  })
  it('abrir en editor muestra el EditorPane', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    await w.get('[data-test="header-editor"]').trigger('click')
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
  })
  it('sin selección no renderiza nada', () => {
    useSessions().setAll([])
    const w = mount(FocusView)
    expect(w.find('[data-test="terminal-pane"]').exists()).toBe(false)
  })
})
```

`src/views/FocusRoute.test.ts`: cambiar el mock de `../components/DetailPanel.vue` por `../components/focus/FocusView.vue` (`data-test="focus-view"`) y el último caso ("con sesiones muestra el panel de detalle") por "con sesiones muestra el foco", asertando `[data-test="focus-view"]`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/focus src/views`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/focus/ToolTabs.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { TerminalSquare, GitBranch, FolderOpen, Server, ScrollText, PanelRightOpen } from 'lucide-vue-next'
import { useFocusTools, type ToolId, type SideTool } from '../../composables/useFocusTools'
import { useProjects } from '../../composables/useProjects'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const { canSpawn } = useProjects()
const tools = useFocusTools(computed(() => props.session.id))

const TABS = computed(() => [
  { id: 'terminal' as ToolId, label: 'Terminal', icon: TerminalSquare },
  { id: 'git' as ToolId, label: 'Git', icon: GitBranch },
  { id: 'files' as ToolId, label: 'Archivos', icon: FolderOpen },
  // Las acciones de infra requieren que el server permita spawnear (como el bloque viejo).
  ...(canSpawn.value && props.session.infra?.dir ? [{ id: 'infra' as ToolId, label: 'Infra', icon: Server }] : []),
  { id: 'quest' as ToolId, label: 'Quest', icon: ScrollText },
])
// Con un panel fijado, la pestaña marcada es la del panel (la terminal está a la izquierda).
const current = computed<ToolId>(() => tools.pinned.value ?? tools.active.value)
const pinnable = computed(() => tools.canPin.value && !tools.pinned.value && tools.active.value !== 'terminal')
</script>

<template>
  <nav role="tablist" aria-label="Herramientas" class="flex items-center gap-1 overflow-x-auto border-b border-border">
    <button v-for="t in TABS" :key="t.id" data-test="tool-tab" type="button" role="tab"
      :aria-selected="current === t.id ? 'true' : 'false'"
      :class="cn('inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-3 font-[inherit] text-sm',
        current === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')"
      @click="tools.select(t.id)">
      <component :is="t.icon" class="size-4" />{{ t.label }}
    </button>
    <span class="flex-1" />
    <button v-if="pinnable" data-test="pin-tool" type="button" title="Fijar al costado de la terminal"
      class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 font-[inherit] text-xs text-muted hover:bg-surface-raised hover:text-text"
      @click="tools.pin(tools.active.value as SideTool)">
      <PanelRightOpen class="size-4" />Fijar al costado
    </button>
  </nav>
</template>
```

`src/components/focus/PinnedPanel.vue`:
```vue
<script setup lang="ts">
import { PanelRightClose } from 'lucide-vue-next'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'

// Terminal a la izquierda (slot) y la herramienta fijada a la derecha. El ancho
// (en %) lo persiste useFocusTools.
defineProps<{ size: number; label: string }>()
const emit = defineEmits<{ (e: 'resize', size: number): void; (e: 'unpin'): void }>()
function onLayout(sizes: number[]) { if (sizes[1] != null) emit('resize', sizes[1]) }
</script>

<template>
  <ResizablePanelGroup data-test="pinned-panel" direction="horizontal" class="h-full min-h-0" @layout="onLayout">
    <ResizablePanel :default-size="100 - size" :min-size="25" class="min-w-0"><slot name="left" /></ResizablePanel>
    <ResizableHandle with-handle class="mx-1 bg-border" />
    <ResizablePanel :default-size="size" :min-size="15" class="min-w-0">
      <section class="flex h-full min-h-0 flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-surface">
        <header class="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <b class="flex-1 text-sm text-text">{{ label }}</b>
          <button data-test="unpin-tool" type="button" title="Desfijar (Esc)" @click="emit('unpin')"
            class="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 font-[inherit] text-xs text-muted hover:bg-surface-raised hover:text-text">
            <PanelRightClose class="size-4" />Desfijar
          </button>
        </header>
        <div class="min-h-0 flex-1"><slot /></div>
      </section>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
```

`src/components/focus/EditorPane.vue` (desde `EditorTerminal.vue`, lógica igual):
```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useTerminal } from '../../composables/useTerminal'
import { useTermKeys } from '../../composables/useTermKeys'
import TermKeys from '../TermKeys.vue'

// Terminal del editor (tmux <sesión>-edit con nvim). Cerrar no mata nvim.
const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const termEl = ref<HTMLElement | null>(null)
const { sendKey } = useTerminal(termEl, computed(() => props.sessionId), { role: 'edit' })
const { enabled: termKeysEnabled } = useTermKeys()
</script>

<template>
  <div class="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-terminal-bg">
    <header class="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      <span class="font-mono text-xs text-muted">✎ Editor · nvim</span>
      <TermKeys v-if="termKeysEnabled" dense @press="sendKey" />
      <span class="flex-1" />
      <button data-test="editor-close" type="button" title="Cerrar (nvim sigue vivo)" @click="emit('close')"
        class="inline-flex cursor-pointer items-center rounded-[var(--radius)] border-0 bg-transparent p-1 text-muted hover:bg-surface-raised hover:text-text">
        <X class="size-4" />
      </button>
    </header>
    <div ref="termEl" class="min-h-0 flex-1" />
  </div>
</template>
```

`src/components/focus/FocusView.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../../stores/sessions'
import { useFocusTools, type SideTool } from '../../composables/useFocusTools'
import SessionHeader from './SessionHeader.vue'
import ToolTabs from './ToolTabs.vue'
import TerminalPane from './TerminalPane.vue'
import PinnedPanel from './PinnedPanel.vue'
import EditorPane from './EditorPane.vue'
import GitTool from '../tools/git/GitTool.vue'
import FilesTool from '../tools/FilesTool.vue'
import QuestTool from '../tools/QuestTool.vue'
import InfraTool from '../tools/InfraTool.vue'

const store = useSessions()
const session = computed(() => store.selected)
const tools = useFocusTools(computed(() => session.value?.id ?? null))
const term = ref<InstanceType<typeof TerminalPane> | null>(null)
const editorOpen = ref(false)
watch(() => session.value?.id, () => { editorOpen.value = false })

const LABEL: Record<SideTool, string> = { git: 'Git', files: 'Archivos', infra: 'Infra', quest: 'Quest' }
// La herramienta que ocupa el área (sin panel fijado) o el panel fijado.
const shownTool = computed<SideTool | null>(() => tools.pinned.value ?? (tools.active.value === 'terminal' ? null : tools.active.value))

function onInsert(text: string) {
  term.value?.insert(text)
  if (!tools.pinned.value) tools.select('terminal') // volver a la terminal para seguir escribiendo
}

defineExpose({ fit: () => term.value?.fit(), closeEditor: () => { editorOpen.value = false } })
</script>

<template>
  <div v-if="session" class="flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4">
    <SessionHeader :session="session" @open-editor="editorOpen = true" />
    <ToolTabs :session="session" />
    <div class="relative min-h-0 flex-1">
      <PinnedPanel v-if="tools.pinned.value" :size="tools.pinnedSize.value" :label="LABEL[tools.pinned.value]"
        @resize="tools.setPinnedSize" @unpin="tools.unpin()">
        <template #left><TerminalPane ref="term" :session="session" /></template>
        <component :is="{ git: GitTool, files: FilesTool, quest: QuestTool, infra: InfraTool }[tools.pinned.value]"
          :key="`${session.id}:${tools.pinned.value}`" :session-id="session.id" :session="session" :path="tools.path.value"
          @navigate="tools.setPath" @insert="onInsert" @opened="editorOpen = true" />
      </PinnedPanel>
      <template v-else>
        <!-- La terminal no se desmonta al cambiar de pestaña: v-show, para no cortar el WebSocket. -->
        <div v-show="!shownTool" class="h-full"><TerminalPane ref="term" :session="session" /></div>
        <div v-if="shownTool" class="h-full overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-surface">
          <component :is="{ git: GitTool, files: FilesTool, quest: QuestTool, infra: InfraTool }[shownTool]"
            :key="`${session.id}:${shownTool}`" :session-id="session.id" :session="session" :path="tools.path.value"
            @navigate="tools.setPath" @insert="onInsert" @opened="editorOpen = true" />
        </div>
      </template>
      <EditorPane v-if="editorOpen" :key="session.id" :session-id="session.id" @close="editorOpen = false" />
    </div>
  </div>
</template>
```
Notas para el implementador:
- Al pasar de "sin fijar" a "fijado" la `TerminalPane` se re-monta (cambia de padre). Es aceptable: `useTerminal` reconecta a la misma sesión tmux y no se pierde estado del lado del server. Si molesta en el uso (parpadeo), dejarlo anotado en el reporte; no intentar teleports en este PR.
- Cada herramienta recibe props que puede no declarar (`session`, `path`, `sessionId`): Vue las deja como atributos en la raíz; para no ensuciar el DOM, declarar `inheritAttrs: false` no hace falta, pero `InfraTool` necesita `session` y el resto `sessionId` (+`path` en Git/Archivos). Verificar que no haya warnings de "Extraneous non-emits event listeners" en los tests; si los hay, declarar los emits que falten en cada herramienta (`defineEmits` vacío no; mejor pasar listeners sólo a FilesTool con `v-on="shownTool === 'files' ? filesListeners : {}"`).

`src/views/FocusRoute.vue`: reemplazar el import de `DetailPanel` por `FocusView` (`../components/focus/FocusView.vue`), el `ref` `panel` por `view`, y quitar el `ResizeObserver` y el `watch(zoom)` (ahora los hace `TerminalPane`). El estado vacío queda igual. Resultado:
```vue
<script setup lang="ts">
import FocusView from '../components/focus/FocusView.vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'

const store = useSessions()
// Sólo si el server permite spawnear tiene sentido apuntar al botón "+ Nueva sesión".
const { canSpawn } = useProjects()
</script>

<template>
  <div class="h-full min-h-0 min-w-0">
    <!-- Estado vacío para todos los modos (landscape/portrait/phone). -->
    <div v-if="!store.list.length" data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
      <p class="max-w-sm text-center text-sm text-muted">
        No hay sesiones abiertas.<br />
        <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> (Nueva sesión) de la barra de arriba.</template>
        <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
      </p>
    </div>
    <FocusView v-else />
  </div>
</template>
```

Borrar los archivos listados en **Delete** y verificar:
```bash
grep -rn "DetailPanel\|QuestBook.vue\|InfraBlock\|FileBrowser\|ProjectExplorer\|ProjectFiles\|EditorTerminal\|GitPanel\|git.css" src
```
Expected: sin resultados (salvo `QuestBook` como **tipo** en `types.ts`/`useQuestBook.ts`, que se conserva).

`style.css`: quitar reglas que sólo usaban los componentes borrados (grep antes de cada una).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): FocusView con pestañas de herramientas y panel fijado; fuera el DetailPanel"
```

---

### Task 8: Atajos de teclado

**Files:**
- Create: `src/composables/useFocusShortcuts.ts`, `useFocusShortcuts.test.ts`
- Modify: `src/components/focus/FocusView.vue` (instalar los atajos)

**Interfaces:**
- Consumes: `useSessions()` (`list`, `selectedId`), `useGoToSession()` (`src/composables/useGoToSession.ts`, requiere router), `useFocusTools` (`pinned`, `unpin`), y el `closeEditor` de `FocusView`.
- Produces:
  - `shortcutFor(e: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'>, target: EventTarget | null): 'prev' | 'next' | 'escape' | null` (pura).
  - `useFocusShortcuts(opts: { onEscape: () => boolean }): void` — instala el listener en `document` (keydown) y lo quita al desmontar. `onEscape` devuelve `true` si consumió el Esc.

- [ ] **Step 1: Test que falla**

`src/composables/useFocusShortcuts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { shortcutFor } from './useFocusShortcuts'

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })
const el = (tag: string, cls = '') => { const e = document.createElement(tag); if (cls) e.className = cls; return e }

describe('shortcutFor', () => {
  it('[ y ] cambian de sesión; Esc', () => {
    expect(shortcutFor(ev('['), document.body)).toBe('prev')
    expect(shortcutFor(ev(']'), document.body)).toBe('next')
    expect(shortcutFor(ev('Escape'), document.body)).toBe('escape')
    expect(shortcutFor(ev('a'), document.body)).toBeNull()
  })
  it('con modificadores no es atajo', () => {
    expect(shortcutFor(ev('[', { ctrlKey: true }), document.body)).toBeNull()
    expect(shortcutFor(ev(']', { metaKey: true }), document.body)).toBeNull()
  })
  it('desactivados en la terminal y en inputs', () => {
    expect(shortcutFor(ev('['), el('textarea', 'xterm-helper-textarea'))).toBeNull()
    expect(shortcutFor(ev('Escape'), el('textarea', 'xterm-helper-textarea'))).toBeNull()
    expect(shortcutFor(ev('['), el('input'))).toBeNull()
    expect(shortcutFor(ev(']'), el('select'))).toBeNull()
    const ce = el('div'); ce.setAttribute('contenteditable', 'true')
    expect(shortcutFor(ev('['), ce)).toBeNull()
  })
  it('dentro de un contenedor xterm tampoco', () => {
    const wrap = el('div', 'xterm'); const inner = el('div'); wrap.appendChild(inner)
    expect(shortcutFor(ev(']'), inner)).toBeNull()
  })
})
```

Sumar a `src/components/focus/FocusView.test.ts` (montando con un router de memoria: `createHabitatRouter(createMemoryHistory())` + `syncSelectionWithRoute(router, useSessions())` como en `SessionNav.test.ts`):
- `]` con foco en `document.body` navega a la sesión siguiente (`/s/b`) y `[` a la anterior, de forma circular;
- `Esc` con un panel fijado lo desfija; con el editor abierto lo cierra (primero el editor).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useFocusShortcuts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/composables/useFocusShortcuts.ts`:
```ts
import { onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { useGoToSession } from './useGoToSession'

export type Shortcut = 'prev' | 'next' | 'escape'

// Los atajos no compiten con lo que el usuario escribe: se apagan en la terminal
// (xterm captura el teclado en su textarea) y en cualquier campo editable.
function typingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.closest('.xterm')) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable || t.getAttribute('contenteditable') === 'true'
}

export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, target: EventTarget | null): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (typingTarget(target)) return null
  if (e.key === '[') return 'prev'
  if (e.key === ']') return 'next'
  if (e.key === 'Escape') return 'escape'
  return null
}

// [ y ] recorren las sesiones en el orden de la nav (circular). Esc delega en el foco
// (cerrar editor, desfijar panel).
export function useFocusShortcuts(opts: { onEscape: () => boolean }) {
  const store = useSessions()
  const goTo = useGoToSession()
  function onKey(e: KeyboardEvent) {
    const s = shortcutFor(e, e.target)
    if (!s) return
    if (s === 'escape') { if (opts.onEscape()) e.preventDefault(); return }
    const ids = store.list.map((x) => x.id)
    if (!ids.length) return
    const i = Math.max(0, ids.indexOf(store.selectedId ?? ''))
    const next = s === 'next' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length
    e.preventDefault()
    goTo(ids[next])
  }
  onMounted(() => document.addEventListener('keydown', onKey))
  onUnmounted(() => document.removeEventListener('keydown', onKey))
}
```
Nota: `xterm-helper-textarea` está dentro del contenedor `.xterm`, así que `closest('.xterm')` lo cubre (el test lo verifica igual con la clase directa: agregar también `t.classList.contains('xterm-helper-textarea')` si `closest` no matchea un textarea suelto en happy-dom).

En `FocusView.vue`, instalar:
```ts
import { useFocusShortcuts } from '../../composables/useFocusShortcuts'
// Esc: primero cierra el editor, después desfija el panel. Los diálogos (Reka) manejan su propio Esc.
useFocusShortcuts({
  onEscape: () => {
    if (editorOpen.value) { editorOpen.value = false; return true }
    if (tools.pinned.value) { tools.unpin(); return true }
    return false
  },
})
```
`FocusView` usa `useGoToSession` (vía el composable), que requiere router: los tests de `FocusView` montan con `global: { plugins: [router] }` (actualizar los casos de la Task 7).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/composables/useFocusShortcuts.test.ts src/components/focus && npm run build 2>&1 | tail -1`
Expected: PASS y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): atajos [ ] para cambiar de sesión y Esc para cerrar editor/desfijar"
```

---

### Task 9: Capturas, verificación visual y cierre

**Files:**
- Modify: `habitat/scripts/screenshots.mjs` (vistas por herramienta), `habitat/README.md` (atajos)

**Interfaces:**
- Produces: `screenshots.mjs` acepta vistas `focus-git`, `focus-files`, `focus-quest` y `focus-pinned` además de `focus` y `settings`.

- [ ] **Step 1: Vistas de herramientas en el script**

La pestaña activa no está en la URL. Para capturarla, el script, después de cargar `#/s/<id>` de la primera sesión, hace click por CDP (`Runtime.evaluate`) en el botón `[data-test="tool-tab"]` cuyo texto es `Git` / `Archivos` / `Quest`; para `focus-pinned` (sólo en el tamaño 1440×900) hace click en `Git` y después en `[data-test="pin-tool"]`. Agregar esas vistas al objeto `VIEWS` con una función `prepare` opcional por vista (la navegación base es `#/`, y la primera sesión queda seleccionada sola). Mantener los filtros `--themes/--sizes/--views/--zoom` existentes.

- [ ] **Step 2: Instancia de dev y capturas**

Igual que en el PR 1 (ver la sección "Temas y capturas" del README): build del cliente, instancia en el puerto **8399** con estado en el scratchpad (`HABITAT_STATE`, `HABITAT_SESSIONS`, `HABITAT_PROJECTS_STATE`, `HABITAT_SETTINGS`), `HABITAT_ALLOW_SPAWN=1`, `HABITAT_PROJECTS=<worktree>` y `HABITAT_DOCKER_CLEANUP=0`; 4 sesiones por `POST /hooks` (una con `Notification` para "te necesita") y uso sembrado por `/status`. Capturar: 3 temas × 3 tamaños en `focus` y `settings`; forja en `focus-git`, `focus-files`, `focus-quest` (3 tamaños) y `focus-pinned` (1440×900); forja 1440×900 y 820×1180 a zoom 1.25. Matar la instancia por PID; `LD_LIBRARY_PATH` sólo en el entorno de chrome; nunca tocar producción (puerto 8377, `~/HabitatProdu`).

Revisar **cada** captura con la herramienta Read. Criterios:
- header del foco en una sola fila en landscape; en portrait/phone puede envolver sin superponerse;
- pestañas legibles, la activa marcada; "Fijar al costado" sólo en 1440×900;
- herramientas sin restos de estilo nativo (botones con cara blanca, bordes por defecto, links subrayados, fuentes serif por defecto);
- Git/Archivos/Quest ocupan el área con scroll propio; con panel fijado se ven terminal y herramienta;
- a zoom 1.25 no se recorta nada.

Corregir lo que falle (commits `fix(habitat): …` separados).

- [ ] **Step 3: README**

En `habitat/README.md`, sección de uso, agregar:
```markdown
### Atajos

En el foco: `[` y `]` pasan a la sesión anterior/siguiente; `Esc` cierra el editor y
desfija el panel. No actúan mientras escribís en la terminal o en un campo.
```

- [ ] **Step 4: Verificación final y commit**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
cd ../.. && git add habitat/scripts habitat/README.md && git commit -m "chore(habitat): capturas por herramienta y atajos en el README"
```
El push y el PR los hace el controlador después de la revisión final de toda la branch.
