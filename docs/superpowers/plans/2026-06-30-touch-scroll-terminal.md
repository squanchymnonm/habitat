# Scroll táctil en la terminal (tablet) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un swipe vertical de un dedo scrollee el historial de tmux en la terminal, tanto en la sesión principal (`DetailPanel.vue`) como en el editor (`EditorTerminal.vue`).

**Architecture:** Toda la lógica vive en el composable `useTerminal.ts`, que ambos componentes consumen, así que heredan el scroll sin duplicar código. El historial vive en tmux (copy-mode, porque tmux corre con `mouse on`), no en el buffer de xterm; por eso un swipe se traduce a eventos de **rueda** que xterm reenvía a tmux. Mecanismo primario: despachar un `WheelEvent` sintético sobre el elemento de xterm (xterm lo codifica con el protocolo de mouse activo). Fallback (solo si el dispositivo no procesa el evento sintético): emitir las secuencias SGR de rueda por el WebSocket.

**Tech Stack:** Vue 3 (composables), TypeScript, `@xterm/xterm` ^6, Vitest ^2.

## Global Constraints

- Trabajar desde `habitat/client/` (donde vive el front y corre Vitest).
- Test runner: `npm run test` (= `vitest run`) o un archivo puntual con `npx vitest run <ruta>`.
- Las funciones puras nuevas se exportan desde `src/composables/useTerminal.ts` y se testean en `src/composables/useTerminal.test.ts` (mismo patrón que `rowFromY`/`joinBufferLines`).
- Comentarios en español, igual que el resto del archivo.
- No tocar copy/paste ni `selectMode`. Sin inercia/momentum (YAGNI).
- Convención de signo: arrastrar el dedo **hacia abajo** (clientY creciente) revela historial → scroll **hacia arriba**.

---

### Task 1: Funciones puras de traducción swipe → rueda

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (agregar dos funciones exportadas, junto a `rowFromY`/`joinBufferLines`, ~línea 95)
- Test: `habitat/client/src/composables/useTerminal.test.ts` (agregar dos `describe` al final)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `wheelNotchesFromDelta(accumulated: number, cellHeight: number): number` — cuántos "notches" enteros de rueda representa el desplazamiento acumulado en px. `Math.trunc(accumulated / cellHeight)`; `0` si `cellHeight <= 0`. El signo se conserva (positivo = dedo hacia abajo).
  - `isVerticalDrag(dx: number, dy: number): boolean` — `true` si el arrastre es mayormente vertical (`Math.abs(dy) > Math.abs(dx)`).

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/client/src/composables/useTerminal.test.ts`, agregar al import de la línea 2 los dos nombres nuevos:

```ts
import { copyPasteIntent, decideKeyAction, canReadClipboard, joinBufferLines, rowFromY, wheelNotchesFromDelta, isVerticalDrag } from './useTerminal'
```

Y al final del archivo:

```ts
describe('wheelNotchesFromDelta', () => {
  it('trunca el desplazamiento acumulado a notches enteros', () => {
    expect(wheelNotchesFromDelta(40, 17)).toBe(2) // trunc(2.35)
  })

  it('conserva el signo (dedo hacia arriba = acumulado negativo)', () => {
    expect(wheelNotchesFromDelta(-40, 17)).toBe(-2)
  })

  it('devuelve 0 si no se alcanzó una celda completa', () => {
    expect(wheelNotchesFromDelta(10, 17)).toBe(0)
  })

  it('devuelve 0 con cellHeight inválido (evita dividir por cero)', () => {
    expect(wheelNotchesFromDelta(100, 0)).toBe(0)
  })
})

describe('isVerticalDrag', () => {
  it('es vertical cuando |dy| > |dx|', () => {
    expect(isVerticalDrag(5, 40)).toBe(true)
  })

  it('no es vertical cuando el arrastre es mayormente horizontal', () => {
    expect(isVerticalDrag(40, 5)).toBe(false)
  })

  it('empate (45°) no cuenta como vertical', () => {
    expect(isVerticalDrag(20, 20)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: FAIL — `wheelNotchesFromDelta is not a function` / `isVerticalDrag is not a function` (import no resuelve).

- [ ] **Step 3: Implementar las funciones**

En `habitat/client/src/composables/useTerminal.ts`, después de `joinBufferLines` (alrededor de la línea 95), agregar:

```ts
// Cuántos "notches" enteros de rueda representa un desplazamiento vertical acumulado
// (en px). Trunca hacia cero para no emitir un notch hasta cruzar una celda completa,
// y conserva el signo: positivo = dedo hacia abajo = revelar historial (scroll up).
// Devuelve 0 si cellHeight no es válido (evita dividir por cero).
export function wheelNotchesFromDelta(accumulated: number, cellHeight: number): number {
  if (cellHeight <= 0) return 0
  return Math.trunc(accumulated / cellHeight)
}

// ¿El arrastre es mayormente vertical? Sirve para no scrollear con gestos horizontales.
export function isVerticalDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > Math.abs(dx)
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: PASS (todos los `describe`, incluidos los previos).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/composables/useTerminal.test.ts
git commit -m "feat(habitat): helpers puros para scroll táctil de la terminal"
```

---

### Task 2: Cablear el swipe-to-scroll en useTerminal (mecanismo A: WheelEvent)

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (handlers táctiles + `setup`/`teardown`)
- Modify: `habitat/client/src/components/DetailPanel.vue` (CSS `touch-action` en `.term-body`, alrededor de la línea 412)
- Modify: `habitat/client/src/components/EditorTerminal.vue` (CSS `touch-action` en `.ed-term`, línea 28)

**Interfaces:**
- Consumes: `wheelNotchesFromDelta`, `isVerticalDrag` (Task 1); las variables de closure existentes `term`, `mouseEl`, `container`, `selectMode` en `useTerminal`.
- Produces: nada nuevo en la API pública del composable (sigue devolviendo lo mismo).

**Nota:** este task no es unit-testeable de forma significativa (depende de xterm + WheelEvent reales en un navegador). Su verificación es manual en la tablet (Step 4). Si esa verificación falla, ir al Task 3.

- [ ] **Step 1: Agregar el estado y los handlers de scroll**

En `habitat/client/src/composables/useTerminal.ts`, dentro de `useTerminal`, junto a las otras variables de estado táctil (después de `let selStart: number | null = null`, ~línea 113), agregar:

```ts
  // Estado del swipe-to-scroll (modo NO-selección): un arrastre vertical se traduce a
  // eventos de rueda que xterm reenvía a tmux (copy-mode) porque tmux corre con mouse on.
  let scrollStartX = 0
  let scrollStartY = 0
  let scrollLastY = 0
  let scrollAccum = 0
  let scrolling = false
```

Y después de `onTouchEndSel` (~línea 155), agregar los handlers de scroll y un helper de emisión de rueda:

```ts
  // px por fila de la grilla de xterm, calculado desde el alto del contenedor.
  function cellHeightPx(): number {
    const el = mouseEl ?? container.value
    if (!el || !term || term.rows <= 0) return 0
    return el.getBoundingClientRect().height / term.rows
  }

  // Mecanismo A: despachar un WheelEvent sintético sobre el elemento de xterm. Con el
  // modo mouse activo (tmux mouse on), xterm lo codifica con el protocolo correcto y se
  // lo manda a tmux. notches > 0 (dedo hacia abajo) => revelar historial => scroll up =>
  // deltaY negativo (en WheelEvent, deltaY positivo es scroll hacia abajo).
  function emitWheel(notches: number, clientX: number, clientY: number, cellH: number) {
    const target = (term as unknown as { element?: HTMLElement })?.element ?? mouseEl
    if (!target) return
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -notches * cellH,
      deltaMode: 0,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }))
  }

  // Swipe-to-scroll: solo en modo NO-selección. Se decide "es scroll" cuando el arrastre
  // supera ~8px y es mayormente vertical; a partir de ahí preventDefault (corta el
  // scroll/pull-to-refresh del navegador) y se emiten notches de rueda por cada celda.
  function onTouchStartScroll(e: TouchEvent) {
    if (selectMode.value || !term) return
    const t = e.touches[0]
    if (!t) return
    scrollStartX = t.clientX
    scrollStartY = t.clientY
    scrollLastY = t.clientY
    scrollAccum = 0
    scrolling = false
  }
  function onTouchMoveScroll(e: TouchEvent) {
    if (selectMode.value || !term) return
    const t = e.touches[0]
    if (!t) return
    if (!scrolling) {
      const dx = t.clientX - scrollStartX
      const dy = t.clientY - scrollStartY
      if (Math.abs(dy) < 8 || !isVerticalDrag(dx, dy)) { scrollLastY = t.clientY; return }
      scrolling = true
    }
    e.preventDefault()
    const cellH = cellHeightPx()
    scrollAccum += t.clientY - scrollLastY
    scrollLastY = t.clientY
    const notches = wheelNotchesFromDelta(scrollAccum, cellH)
    if (notches !== 0) {
      scrollAccum -= notches * cellH
      emitWheel(notches, t.clientX, t.clientY, cellH)
    }
  }
  function onTouchEndScroll() {
    scrolling = false
    scrollAccum = 0
  }
```

- [ ] **Step 2: Registrar/desregistrar los listeners**

En `setup` (~líneas 244-246), después de los listeners de selección existentes, agregar los de scroll:

```ts
    el.addEventListener('touchstart', onTouchStartSel, { passive: false })
    el.addEventListener('touchmove', onTouchMoveSel, { passive: false })
    el.addEventListener('touchend', onTouchEndSel)
    el.addEventListener('touchstart', onTouchStartScroll, { passive: false })
    el.addEventListener('touchmove', onTouchMoveScroll, { passive: false })
    el.addEventListener('touchend', onTouchEndScroll)
    el.addEventListener('touchcancel', onTouchEndScroll)
```

En `teardown` (~líneas 159-163), agregar la baja correspondiente dentro del `if (mouseEl) { ... }`:

```ts
      mouseEl.removeEventListener('mousedown', onTermMouseDownCapture, true)
      mouseEl.removeEventListener('touchstart', onTouchStartSel)
      mouseEl.removeEventListener('touchmove', onTouchMoveSel)
      mouseEl.removeEventListener('touchend', onTouchEndSel)
      mouseEl.removeEventListener('touchstart', onTouchStartScroll)
      mouseEl.removeEventListener('touchmove', onTouchMoveScroll)
      mouseEl.removeEventListener('touchend', onTouchEndScroll)
      mouseEl.removeEventListener('touchcancel', onTouchEndScroll)
```

- [ ] **Step 3: Asegurar que el navegador no se coma el gesto (CSS)**

En `habitat/client/src/components/DetailPanel.vue`, en la regla `.term-body` (~línea 412), agregar `touch-action: none;` para que el navegador no haga su propio scroll/pull-to-refresh y nos deje los eventos táctiles:

```css
.term-body {
  /* ...propiedades existentes... */
  touch-action: none;
}
```

En `habitat/client/src/components/EditorTerminal.vue`, en `.ed-term` (línea 28), agregar lo mismo:

```css
.ed-term { flex: 1; min-height: 0; padding: 4px; touch-action: none; }
```

- [ ] **Step 4: Verificar — typecheck, tests y prueba manual en la tablet**

Run (no debe romper nada existente):
```bash
cd habitat/client && npx vitest run src/composables/useTerminal.test.ts && npx vue-tsc --noEmit
```
Expected: tests PASS, typecheck sin errores.

Prueba manual (decide A vs Task 3): abrir Habitat desde la tablet, entrar a una sesión, **arrastrar con un dedo hacia abajo** sobre la terminal.
- Expected: la terminal scrollea hacia el historial (copy-mode de tmux); arrastrar hacia arriba vuelve. El long-press (mantener quieto) sigue abriendo el menú; con "seleccionar" activo el arrastre sigue seleccionando.
- Repetir dentro del editor (botón Proyecto → abrir archivo): el swipe debe scrollear nvim.
- **Si NO scrollea** (xterm ignora el WheelEvent sintético): dejar el resto como está y hacer el Task 3 (fallback SGR).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/components/DetailPanel.vue habitat/client/src/components/EditorTerminal.vue
git commit -m "feat(habitat): scroll táctil por swipe en la terminal (WheelEvent)"
```

---

### Task 3 (CONDICIONAL — solo si el Task 2 no scrollea en la tablet): fallback SGR por WebSocket

Hacer este task **únicamente** si la verificación manual del Task 2 (Step 4) mostró que el `WheelEvent` sintético no hace scrollear. Reemplaza el cuerpo de `emitWheel` para mandar las secuencias de rueda SGR directamente al PTY por el WebSocket (determinístico para SGR, la codificación que usa tmux por defecto).

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (agregar `wheelSeq` exportada + reescribir `emitWheel`)
- Test: `habitat/client/src/composables/useTerminal.test.ts` (agregar `describe('wheelSeq')`)

**Interfaces:**
- Consumes: el `ws` y el `enc` (TextEncoder) ya existentes en el módulo; `term.cols`/`term.rows`; `mouseEl`/`container`.
- Produces: `wheelSeq(dir: 'up' | 'down', col: number, row: number): string` — la secuencia SGR de rueda (`\x1b[<64;col;row M` para up, `65` para down). `col`/`row` en celdas 1-based.

- [ ] **Step 1: Escribir el test que falla**

Agregar `wheelSeq` al import de la línea 2 del test y, al final de `useTerminal.test.ts`:

```ts
describe('wheelSeq', () => {
  it('rueda arriba = botón 64 con celda 1-based', () => {
    expect(wheelSeq('up', 3, 7)).toBe('\x1b[<64;3;7M')
  })

  it('rueda abajo = botón 65', () => {
    expect(wheelSeq('down', 3, 7)).toBe('\x1b[<65;3;7M')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: FAIL — `wheelSeq is not a function`.

- [ ] **Step 3: Implementar `wheelSeq` y reescribir `emitWheel`**

En `habitat/client/src/composables/useTerminal.ts`, agregar junto a las otras funciones puras (después de `isVerticalDrag`):

```ts
// Secuencia SGR de rueda del mouse para mandar al PTY. tmux con mouse on la interpreta
// como scroll de copy-mode. Botón 64 = rueda arriba, 65 = rueda abajo. col/row 1-based.
export function wheelSeq(dir: 'up' | 'down', col: number, row: number): string {
  const btn = dir === 'up' ? 64 : 65
  return `\x1b[<${btn};${col};${row}M`
}
```

Reescribir el cuerpo de `emitWheel` (dentro de `useTerminal`) para usar el WebSocket en vez del WheelEvent:

```ts
  // Fallback B: en vez de un WheelEvent sintético, mandamos las secuencias SGR de rueda
  // por el WebSocket. notches > 0 (dedo hacia abajo) => scroll up => rueda arriba.
  function emitWheel(notches: number, clientX: number, clientY: number, cellH: number) {
    if (!term || !ws || ws.readyState !== 1) return
    const el = mouseEl ?? container.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cellW = term.cols > 0 ? rect.width / term.cols : 0
    const col = cellW > 0 ? Math.min(term.cols, Math.max(1, Math.floor((clientX - rect.left) / cellW) + 1)) : 1
    const row = cellH > 0 ? Math.min(term.rows, Math.max(1, Math.floor((clientY - rect.top) / cellH) + 1)) : 1
    const dir = notches > 0 ? 'up' : 'down'
    const seq = wheelSeq(dir, col, row)
    for (let i = 0; i < Math.abs(notches); i++) ws.send(enc.encode(seq))
  }
```

- [ ] **Step 4: Correr los tests y typecheck**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts && npx vue-tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 5: Verificar en la tablet y commitear**

Repetir la prueba manual del Task 2 Step 4: el swipe debe scrollear ahora vía SGR.

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/composables/useTerminal.test.ts
git commit -m "fix(habitat): fallback SGR para el scroll táctil de la terminal"
```

---

## Cierre

Antes de cerrar el trabajo (según CLAUDE.md):

```bash
git fetch origin
git merge origin/main   # resolver conflictos, re-correr tests/typecheck
git push origin sora
gh pr create --base main --head sora
```

## Self-Review (hecho)

- **Cobertura del spec:** mecanismo A → Task 2; fallback B → Task 3; gestos/coexistencia → Task 2 (handlers + condición `selectMode`); funciona en editor → Task 2 (mismo composable + CSS de `EditorTerminal`); testing unitario de funciones puras → Tasks 1 y 3; verificación manual en tablet → Task 2 Step 4. Sin huecos.
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** `wheelNotchesFromDelta`, `isVerticalDrag`, `wheelSeq`, `emitWheel(notches, clientX, clientY, cellH)` y `cellHeightPx()` se usan con las mismas firmas en todos los tasks.
