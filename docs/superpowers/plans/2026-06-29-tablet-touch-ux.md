# Arreglos de UX táctil en tablet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en una tablet táctil se puedan abrir links con tap, copiar texto, y que las pantallas verticales usen el layout desktop (rail + panel lado a lado).

**Architecture:** Cambios acotados en la GUI Vue + xterm. Se extraen helpers puros (detección de links, join de buffer, fila desde Y, long-press, breakpoint) que se testean con vitest; el pegamento con el DOM/xterm queda mínimo. No se toca el server ni la config de tmux.

**Tech Stack:** Vue 3 (`<script setup>`), xterm v6 (`@xterm/xterm`), TypeScript, vitest + happy-dom, @vue/test-utils.

## Global Constraints

- **Contexto inseguro (HTTP/LAN):** `navigator.clipboard` puede ser `undefined`. Toda copia DEBE pasar por `copyText()` (que cae a `execCommand('copy')`). Nunca depender de `navigator.clipboard.writeText/readText` para que algo funcione.
- **No tocar el server ni la config de tmux** (`mouse on` se queda como está).
- **No romper el comportamiento desktop existente:** copy-on-select, atajos de teclado (Ctrl/Cmd+C/V), menú de click derecho, y selección con Shift/Alt+arrastre siguen funcionando.
- Comentarios y copy de UI en español, igual que el código existente.
- Directorio de trabajo de todos los comandos: `habitat/client/`.

## Setup (prerrequisito, una sola vez)

Las dependencias no están instaladas. Antes de la Task 1:

```bash
cd habitat/client && npm install
```

Verificar que los tests corren:

```bash
npm test
```

Expected: la suite corre (algunos módulos del server pueden fallar por deps faltantes; los del client deben pasar). Si `npm test` acá solo corre el client, todo verde.

---

### Task 1: Links se abren con tap/click simple

**Files:**
- Modify: `habitat/client/src/composables/terminalLinks.ts:48-69` (`createLinkProvider`)
- Test: `habitat/client/src/composables/terminalLinks.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `createLinkProvider(term: Terminal, openLink: (url: string) => void): ILinkProvider` — el `activate` de cada link abre con `openLink(url)` sin exigir modificador.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `terminalLinks.test.ts` (después del `describe('findLinks', ...)`):

```ts
import { createLinkProvider } from './terminalLinks'
import type { Terminal, ILink } from '@xterm/xterm'

function termWith(line: string): Terminal {
  return {
    buffer: { active: { getLine: (_n: number) => ({ translateToString: (_t?: boolean) => line }) } },
  } as unknown as Terminal
}

function firstLink(line: string, openLink: (url: string) => void): ILink {
  const provider = createLinkProvider(termWith(line), openLink)
  let links: ILink[] | undefined
  provider.provideLinks(1, (l) => { links = l })
  if (!links || links.length === 0) throw new Error('sin links')
  return links[0]
}

describe('createLinkProvider.activate', () => {
  it('abre el link con click simple (sin Ctrl/Cmd)', () => {
    let opened = ''
    const link = firstLink('ver https://ejemplo.com', (u) => { opened = u })
    link.activate({ ctrlKey: false, metaKey: false } as MouseEvent, 'https://ejemplo.com')
    expect(opened).toBe('https://ejemplo.com')
  })

  it('sigue abriendo con Ctrl+click', () => {
    let opened = ''
    const link = firstLink('ver https://ejemplo.com', (u) => { opened = u })
    link.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'https://ejemplo.com')
    expect(opened).toBe('https://ejemplo.com')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- terminalLinks`
Expected: FAIL en "abre el link con click simple" (hoy `activate` exige `ctrlKey || metaKey`, así que `opened` queda vacío).

- [ ] **Step 3: Implementación mínima**

En `terminalLinks.ts`, reemplazar el `activate` (líneas ~62-64) y actualizar el comentario de la línea ~47:

```ts
// Provider de links para xterm v6: por cada línea pedida, mapea findLinks() a ILink[].
// La activación abre el link con un tap/click simple (sirve en touch y desktop).
export function createLinkProvider(term: Terminal, openLink: (url: string) => void): ILinkProvider {
```

```ts
        text: m.url,
        activate(_event: MouseEvent, url: string) {
          openLink(url)
        },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- terminalLinks`
Expected: PASS (todos, incluido `findLinks`).

- [ ] **Step 5: Commit**

```bash
git add src/composables/terminalLinks.ts src/composables/terminalLinks.test.ts
git commit -m "feat(habitat): abrir links de la terminal con tap/click simple"
```

---

### Task 2: Layout desktop en tablets (breakpoint teléfono vs tablet)

**Files:**
- Modify: `habitat/client/src/composables/useViewport.ts` (reescritura completa)
- Test: `habitat/client/src/composables/useViewport.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `isNarrowViewport(width: number, height: number, limit?: number): boolean` — `true` (modo overlay) si es teléfono: `width < limit || height < limit` (limit por defecto 600).
  - `useViewport(): { isNarrow: Ref<boolean> }` — sin parámetros; calcula desde `window.innerWidth/innerHeight` y se actualiza en `resize`.

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/composables/useViewport.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isNarrowViewport } from './useViewport'

describe('isNarrowViewport', () => {
  it('tablet portrait (810x1080) NO es narrow → layout desktop', () => {
    expect(isNarrowViewport(810, 1080)).toBe(false)
  })

  it('tablet landscape (1080x810) NO es narrow', () => {
    expect(isNarrowViewport(1080, 810)).toBe(false)
  })

  it('teléfono portrait (390x844) es narrow → overlay', () => {
    expect(isNarrowViewport(390, 844)).toBe(true)
  })

  it('teléfono landscape (844x390) es narrow (alto < 600)', () => {
    expect(isNarrowViewport(844, 390)).toBe(true)
  })

  it('límite: 600x600 NO es narrow; 599 de cualquier lado sí', () => {
    expect(isNarrowViewport(600, 600)).toBe(false)
    expect(isNarrowViewport(599, 600)).toBe(true)
    expect(isNarrowViewport(600, 599)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- useViewport`
Expected: FAIL con "isNarrowViewport is not a function" (todavía no existe).

- [ ] **Step 3: Implementación mínima**

Reescribir `habitat/client/src/composables/useViewport.ts` completo:

```ts
import { ref, onMounted, onUnmounted } from 'vue'

// Narrow (el detalle pasa a overlay y el rail muestra solo pods) cuando es un
// teléfono: ancho U alto menor a 600px. Las tablets —incluso en portrait— tienen
// ambas dimensiones >= 600 y usan el layout desktop (rail + panel lado a lado).
export function isNarrowViewport(width: number, height: number, limit = 600): boolean {
  return width < limit || height < limit
}

export function useViewport() {
  const isNarrow = ref(false)
  const update = () => { isNarrow.value = isNarrowViewport(window.innerWidth, window.innerHeight) }
  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })
  onUnmounted(() => window.removeEventListener('resize', update))
  return { isNarrow }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- useViewport`
Expected: PASS (5 tests).

- [ ] **Step 5: Verificar que `HabitatLayout.vue` sigue compilando**

`HabitatLayout.vue:10` ya llama `useViewport()` sin argumentos, así que no requiere cambios. Correr el typecheck/build del client:

Run: `npm run build`
Expected: build OK, sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useViewport.ts src/composables/useViewport.test.ts
git commit -m "feat(habitat): tablets (incl. portrait) usan layout desktop; solo teléfonos quedan en overlay"
```

---

### Task 3: Botón "copiar visible" + toast de confirmación

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (helper `joinBufferLines` + método `copyVisible`)
- Modify: `habitat/client/src/components/DetailPanel.vue` (botón en la barra + toast "copiado")
- Test: `habitat/client/src/composables/useTerminal.test.ts`

**Interfaces:**
- Consumes: `copyText(text: string): void` (ya existe en `useTerminal.ts`).
- Produces:
  - `joinBufferLines(lines: string[]): string` — une líneas con `\n`, recortando las líneas en blanco del final.
  - `useTerminal(...)` ahora también retorna `copyVisible(): boolean` — copia el viewport visible; `true` si había texto.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `useTerminal.test.ts` (importar `joinBufferLines` en el import existente de la línea 2):

```ts
// en el import de la línea 2, agregar joinBufferLines:
// import { copyPasteIntent, decideKeyAction, canReadClipboard, joinBufferLines } from './useTerminal'

describe('joinBufferLines', () => {
  it('une líneas con saltos', () => {
    expect(joinBufferLines(['a', 'b', 'c'])).toBe('a\nb\nc')
  })

  it('recorta líneas en blanco al final (relleno del viewport)', () => {
    expect(joinBufferLines(['hola', 'mundo', '', '   ', ''])).toBe('hola\nmundo')
  })

  it('conserva líneas en blanco internas', () => {
    expect(joinBufferLines(['a', '', 'b'])).toBe('a\n\nb')
  })

  it('todo en blanco devuelve cadena vacía', () => {
    expect(joinBufferLines(['', '  ', ''])).toBe('')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- useTerminal`
Expected: FAIL con "joinBufferLines is not a function".

- [ ] **Step 3: Implementación mínima del helper**

En `useTerminal.ts`, agregar (cerca de `copyText`, antes de `useTerminal`):

```ts
// Une las líneas de un volcado del buffer en texto, recortando las líneas en
// blanco del final (xterm rellena el viewport con líneas vacías).
export function joinBufferLines(lines: string[]): string {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  return lines.slice(0, end).join('\n')
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- useTerminal`
Expected: PASS.

- [ ] **Step 5: Agregar `copyVisible` a `useTerminal` (glue, sin test unitario)**

Dentro de `useTerminal`, después de `copySelection` (línea ~127), agregar:

```ts
  // Copia toda la salida visible del viewport (sin necesidad de seleccionar).
  // Útil en touch. Devuelve true si había texto. Usa copyText (anda en HTTP/LAN).
  function copyVisible(): boolean {
    if (!term) return false
    const buf = term.buffer.active
    const top = buf.viewportY
    const lines: string[] = []
    for (let i = 0; i < term.rows; i++) {
      const line = buf.getLine(top + i)
      lines.push(line ? line.translateToString(true) : '')
    }
    const text = joinBufferLines(lines)
    if (!text) return false
    copyText(text)
    term.focus()
    return true
  }
```

Y exponerla en el `return` (línea ~219):

```ts
  return { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible }
```

- [ ] **Step 6: Botón + toast en `DetailPanel.vue`**

En el `<script setup>`, actualizar el destructuring de `useTerminal` (línea 16) y agregar el estado del toast:

```ts
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible } = useTerminal(termEl, selectedId)

// Toast efímero "copiado" (para copiar-visible y, más adelante, modo selección).
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
function flashCopied() {
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
function onCopyVisible() { if (copyVisible()) flashCopied() }
```

En el template, dentro de `.term-bar` (después del `<span class="tt">…`, antes de `<span class="live">`), agregar el botón:

```html
          <button class="termbtn" @click="onCopyVisible" title="Copiar todo lo visible">copiar visible</button>
```

Y el toast, justo después del `<div ref="termEl" …></div>` (línea ~97), dentro de `.term`:

```html
        <div class="copied-toast" :class="{ show: copied }">copiado ✓</div>
```

En el `<style scoped>`, agregar (después del bloque `.term-bar .live`). **Importante:** el toast es `position:absolute`, así que el contenedor `.term` (regla existente, ~línea 303) necesita `position: relative;` para anclarlo — agregá esa línea a la regla `.term`.

```css
.termbtn {
  margin-left: auto;
  background: var(--color-surface-2);
  border: 1px solid var(--color-edge);
  color: var(--color-ink-2);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
}
.termbtn:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
/* La barra ya empuja .live a la derecha con margin-left:auto; al meter un botón
   con margin-left:auto, .live deja de necesitarlo. Quitar el margin de .live. */
.copied-toast {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  background: var(--color-surface-2);
  border: 1px solid rgba(224,169,75,.4);
  color: var(--color-brass);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
  z-index: 30;
}
.copied-toast.show { opacity: 1; }
```

Y editar el bloque existente `.term-bar .live` para quitarle `margin-left: auto;` (ahora el `.termbtn` ocupa ese rol; `.live` queda pegado a la derecha del botón). Si querés mantener `.live` al extremo derecho, dejá el `margin-left:auto` en `.live` y quitalo del `.termbtn` — elegí una sola fuente de empuje. **Decisión:** dejar `margin-left:auto` en `.termbtn` y quitarlo de `.live`.

- [ ] **Step 7: Verificar build y tests**

Run: `npm run build && npm test -- useTerminal`
Expected: build OK; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/composables/useTerminal.ts src/composables/useTerminal.test.ts src/components/DetailPanel.vue
git commit -m "feat(habitat): botón 'copiar visible' + toast de confirmación en la terminal"
```

---

### Task 4: Long-press abre el menú de contexto en touch

**Files:**
- Create: `habitat/client/src/composables/longPress.ts`
- Create: `habitat/client/src/composables/longPress.test.ts`
- Modify: `habitat/client/src/components/DetailPanel.vue` (cambiar firma de `openMenu` + cablear touch)

**Interfaces:**
- Consumes: nada.
- Produces: `createLongPress(fire: (x: number, y: number) => void, opts?: { ms?: number; moveTol?: number }): { start(x, y): void; move(x, y): void; cancel(): void }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/composables/longPress.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLongPress } from './longPress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createLongPress', () => {
  it('dispara con las coordenadas tras mantener apretado', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(10, 20)
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledWith(10, 20)
  })

  it('NO dispara si el dedo se mueve más que la tolerancia (es scroll)', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500, moveTol: 10 })
    lp.start(10, 20)
    lp.move(10, 40) // 20px > 10
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
  })

  it('dispara si el movimiento queda dentro de la tolerancia', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500, moveTol: 10 })
    lp.start(10, 20)
    lp.move(13, 22)
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('cancel() aborta el long-press', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(10, 20)
    lp.cancel()
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
  })

  it('no dispara antes de cumplir el tiempo', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(0, 0)
    vi.advanceTimersByTime(499)
    expect(fire).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- longPress`
Expected: FAIL con "Failed to resolve import './longPress'".

- [ ] **Step 3: Implementación mínima**

Crear `habitat/client/src/composables/longPress.ts`:

```ts
// Detector de long-press agnóstico del DOM: el componente le pasa coordenadas
// de touch y este decide cuándo "disparar" (mantener apretado sin desplazarse).
export interface LongPress {
  start(x: number, y: number): void
  move(x: number, y: number): void
  cancel(): void
}

export function createLongPress(
  fire: (x: number, y: number) => void,
  opts: { ms?: number; moveTol?: number } = {},
): LongPress {
  const ms = opts.ms ?? 500
  const moveTol = opts.moveTol ?? 10
  let timer: ReturnType<typeof setTimeout> | null = null
  let sx = 0
  let sy = 0

  function clear() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  return {
    start(x, y) {
      clear()
      sx = x
      sy = y
      timer = setTimeout(() => { timer = null; fire(x, y) }, ms)
    },
    move(x, y) {
      if (timer !== null && Math.hypot(x - sx, y - sy) > moveTol) clear()
    },
    cancel() { clear() },
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- longPress`
Expected: PASS (5 tests).

- [ ] **Step 5: Cablear el long-press en `DetailPanel.vue`**

Importar y cambiar la firma de `openMenu` para aceptar coordenadas estructurales (un `MouseEvent` real las cumple, así que el `@contextmenu` sigue andando):

En el `<script setup>`, agregar al import de composables:

```ts
import { createLongPress } from '../composables/longPress'
```

Cambiar `openMenu` (línea ~34) a una firma estructural:

```ts
function openMenu(p: { clientX: number; clientY: number }) {
  menu.value = { x: p.clientX, y: p.clientY, hasSel: !!getSelection() }
}
```

Agregar el long-press (después de `menuPaste`):

```ts
// En touch no hay click derecho: un long-press sobre la terminal abre el mismo menú.
const lp = createLongPress((x, y) => openMenu({ clientX: x, clientY: y }))
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  if (t) lp.start(t.clientX, t.clientY)
}
function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (t) lp.move(t.clientX, t.clientY)
}
```

En el template, agregar los handlers touch al `.term-body` (línea ~97):

```html
        <div
          ref="termEl"
          class="term-body"
          aria-label="terminal de la sesión"
          @contextmenu.prevent="openMenu"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="lp.cancel()"
          @touchcancel="lp.cancel()"
        ></div>
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build OK (sin errores de tipos en `openMenu`/handlers).

- [ ] **Step 7: Commit**

```bash
git add src/composables/longPress.ts src/composables/longPress.test.ts src/components/DetailPanel.vue
git commit -m "feat(habitat): long-press abre el menú de copiar/pegar en touch"
```

---

### Task 5: Modo selección (arrastre con el dedo selecciona y copia)

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (helper `rowFromY`, opción `onCopied`, handlers touch de selección, ref `selectMode`)
- Modify: `habitat/client/src/components/DetailPanel.vue` (toggle en la barra, guardar long-press cuando el modo está activo, pasar `onCopied`)
- Test: `habitat/client/src/composables/useTerminal.test.ts`

**Interfaces:**
- Consumes: `joinBufferLines`, `copyText`, `flashCopied` (de Task 3), `createLongPress` (de Task 4).
- Produces:
  - `rowFromY(clientY: number, rectTop: number, rectHeight: number, rows: number, viewportY: number): number` — índice de línea absoluto del buffer bajo la coordenada Y, clampeado a `[viewportY, viewportY + rows - 1]`.
  - `useTerminal(container, id, opts?: { onCopied?: () => void })` ahora retorna también `selectMode: Ref<boolean>`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `useTerminal.test.ts` (sumar `rowFromY` al import de la línea 2):

```ts
describe('rowFromY', () => {
  // term de 24 filas, rect de 0..480 (20px por fila), viewport arrancando en 0.
  it('mapea el medio del rect a la fila del medio', () => {
    expect(rowFromY(250, 0, 480, 24, 0)).toBe(12)
  })

  it('clampa por arriba a la primera fila visible', () => {
    expect(rowFromY(-50, 0, 480, 24, 0)).toBe(0)
  })

  it('clampa por abajo a la última fila visible', () => {
    expect(rowFromY(9999, 0, 480, 24, 0)).toBe(23)
  })

  it('suma el desplazamiento del viewport (scrollback)', () => {
    expect(rowFromY(10, 0, 480, 24, 100)).toBe(100)
    expect(rowFromY(9999, 0, 480, 24, 100)).toBe(123)
  })

  it('rect degenerado (alto 0) cae a la primera fila del viewport', () => {
    expect(rowFromY(10, 0, 0, 24, 5)).toBe(5)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- useTerminal`
Expected: FAIL con "rowFromY is not a function".

- [ ] **Step 3: Implementar `rowFromY`**

En `useTerminal.ts`, cerca de `joinBufferLines`:

```ts
// Índice de línea ABSOLUTO del buffer bajo una coordenada Y (px de pantalla),
// clampeado a las filas visibles. Sirve para seleccionar líneas con el dedo.
export function rowFromY(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  rows: number,
  viewportY: number,
): number {
  if (rectHeight <= 0 || rows <= 0) return viewportY
  const r = Math.floor(((clientY - rectTop) / rectHeight) * rows)
  const clamped = Math.max(0, Math.min(rows - 1, r))
  return viewportY + clamped
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- useTerminal`
Expected: PASS.

- [ ] **Step 5: Agregar modo selección al `useTerminal` (glue)**

Cambiar la firma de `useTerminal` para aceptar `opts` y declarar `selectMode`:

```ts
export function useTerminal(
  container: Ref<HTMLElement | null>,
  id: Ref<string | null | undefined>,
  opts: { onCopied?: () => void } = {},
) {
```

Agregar al tope del cuerpo (junto a las otras `let`):

```ts
  const selectMode = ref(false) // import ref desde 'vue' (ya está importado watch/onUnmounted)
  let selStart: number | null = null
```

> Nota: actualizar el import de la línea 1 a `import { ref, watch, onUnmounted, type Ref } from 'vue'`.

Definir los handlers touch (cerca de `onTermMouseDownCapture`):

```ts
  // Modo selección: mientras está activo, arrastrar con el dedo selecciona líneas
  // en xterm (preventDefault evita que tmux/scroll se coman el gesto). Al soltar,
  // copiamos con copyText —el copy-on-select por API no anda en HTTP/LAN—.
  function onTouchStartSel(e: TouchEvent) {
    if (!selectMode.value || !term) return
    const t = e.touches[0]
    if (!t) return
    const rect = (mouseEl ?? container.value!).getBoundingClientRect()
    selStart = rowFromY(t.clientY, rect.top, rect.height, term.rows, term.buffer.active.viewportY)
    e.preventDefault()
  }
  function onTouchMoveSel(e: TouchEvent) {
    if (!selectMode.value || selStart === null || !term) return
    const t = e.touches[0]
    if (!t) return
    const rect = (mouseEl ?? container.value!).getBoundingClientRect()
    const cur = rowFromY(t.clientY, rect.top, rect.height, term.rows, term.buffer.active.viewportY)
    term.selectLines(Math.min(selStart, cur), Math.max(selStart, cur))
    e.preventDefault()
  }
  function onTouchEndSel() {
    if (!selectMode.value || selStart === null || !term) return
    selStart = null
    const sel = term.getSelection()
    if (sel) {
      copyText(sel)
      term.clearSelection()
      lastSelection = ''
      opts.onCopied?.()
    }
  }
```

En `setup`, después de `el.addEventListener('mousedown', onTermMouseDownCapture, true)` (línea ~156), registrar los touch:

```ts
    el.addEventListener('touchstart', onTouchStartSel, { passive: false })
    el.addEventListener('touchmove', onTouchMoveSel, { passive: false })
    el.addEventListener('touchend', onTouchEndSel)
```

En `teardown`, quitarlos (junto al `removeEventListener` de `onTermMouseDownCapture`):

```ts
    if (mouseEl) {
      mouseEl.removeEventListener('mousedown', onTermMouseDownCapture, true)
      mouseEl.removeEventListener('touchstart', onTouchStartSel)
      mouseEl.removeEventListener('touchmove', onTouchMoveSel)
      mouseEl.removeEventListener('touchend', onTouchEndSel)
      mouseEl = null
    }
```

Exponer `selectMode` en el `return`:

```ts
  return { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode }
```

> **Verificación de API (hacer antes del build):** confirmar que `term.selectLines(start, end)` existe en la versión instalada de `@xterm/xterm` (v6): `grep -rn "selectLines" node_modules/@xterm/xterm/typings/*.d.ts`. Es API pública estándar de xterm. Si por algún motivo no estuviera, usar el equivalente por fila con `term.select(0, row, term.cols)` acumulando, pero NO debería hacer falta.

- [ ] **Step 6: Toggle + guard del long-press en `DetailPanel.vue`**

Actualizar el destructuring y pasar `onCopied`:

```ts
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode } =
  useTerminal(termEl, selectedId, { onCopied: flashCopied })
```

> `flashCopied` ya existe de la Task 3; asegurarse de que esté declarado **antes** de esta llamada (mover el bloque del toast arriba si hiciera falta, ya que `onCopied: flashCopied` lo referencia).

Guardar el long-press cuando el modo selección está activo (modificar `onTouchStart` de la Task 4):

```ts
function onTouchStart(e: TouchEvent) {
  if (selectMode.value) return // en modo selección el gesto es para seleccionar, no long-press
  const t = e.touches[0]
  if (t) lp.start(t.clientX, t.clientY)
}
```

En el template, agregar el toggle en `.term-bar`, antes del botón "copiar visible":

```html
          <button
            class="termbtn"
            :class="{ on: selectMode }"
            @click="selectMode = !selectMode"
            title="Arrastrá con el dedo para seleccionar y copiar"
          >{{ selectMode ? '✓ seleccionar' : 'seleccionar' }}</button>
```

> El botón "copiar visible" ya tenía `margin-left:auto`. Para que el primer botón empuje el grupo a la derecha, mover el `margin-left:auto` al botón "seleccionar" (el primero del grupo) y quitarlo de "copiar visible". Es decir: agregar `style="margin-left:auto"` al toggle y borrar el `margin-left:auto` de la regla `.termbtn`. Resultado: `[tt] ……… [seleccionar][copiar visible] [en vivo]`.

Agregar estilo del estado activo (en `<style scoped>`):

```css
.termbtn.on { border-color: var(--color-brass); color: var(--color-brass); background: rgba(224,169,75,.12); }
```

Y reflejar visualmente el modo en la terminal (cursor de selección):

```css
.term.selecting .term-body { cursor: crosshair; }
```

En el template, marcar la clase en el contenedor `.term`:

```html
      <div class="term" :class="{ selecting: selectMode }">
```

- [ ] **Step 7: Verificar build y tests**

Run: `npm run build && npm test -- useTerminal`
Expected: build OK; tests PASS (incluye `rowFromY`, `joinBufferLines`, y los previos).

- [ ] **Step 8: Commit**

```bash
git add src/composables/useTerminal.ts src/composables/useTerminal.test.ts src/components/DetailPanel.vue
git commit -m "feat(habitat): modo selección táctil — arrastrar con el dedo selecciona y copia"
```

---

### Task 6: Verificación manual en tablet (no automatizable)

**Files:** ninguno (verificación en dispositivo real entrando por LAN/HTTP).

- [ ] **Step 1: Correr toda la suite del client**

Run: `cd habitat/client && npm test`
Expected: tests del client en verde. (Módulos del server pueden fallar por deps faltantes — preexistente, ignorar.)

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Verificar en la tablet (entrando por http://IP-LAN)**

Checklist a mano:
- [ ] Tocar un link en la terminal lo abre en pestaña nueva.
- [ ] Tablet en **portrait**: se ve rail + panel lado a lado (layout desktop), NO solo pods.
- [ ] Botón "copiar visible" copia y aparece el toast "copiado ✓"; pegar el resultado en otra app y verificar el contenido.
- [ ] Activar "seleccionar", arrastrar el dedo verticalmente sobre la terminal: se marcan líneas; al soltar aparece "copiado ✓" y el texto queda en el portapapeles.
- [ ] Long-press sobre la terminal (con modo selección apagado) abre el menú Copiar/Pegar.
- [ ] En desktop nada se rompió: Ctrl/Cmd+C/V, click derecho, y selección con Shift+arrastre siguen andando.

- [ ] **Step 4: Cerrar la branch según CLAUDE.md**

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/niko
git fetch origin
git merge origin/main   # resolver conflictos si los hubiera; re-correr npm test/build
git push origin niko
gh pr create --base main --head niko
```

---

## Notas de cierre

- **Riesgo conocido (modo selección):** la selección es por **líneas completas** (`term.selectLines`), no por columnas. Para copiar un fragmento de una línea, se copia la línea entera y el usuario recorta. Es el fallback robusto acordado en el spec; la selección por columnas en touch quedó fuera de alcance por riesgo.
- **Por qué `copyText` y no copy-on-select en modo selección:** en HTTP/LAN `navigator.clipboard.writeText` es `undefined`, así que el `onSelectionChange` existente no copia. Por eso el modo selección copia explícito con `copyText` (fallback `execCommand`) al soltar.
