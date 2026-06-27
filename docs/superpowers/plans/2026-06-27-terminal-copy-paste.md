# Refactor de copy/paste de la terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que copiar y pegar en la terminal web de Habitat funcione de forma confiable en https/localhost y en HTTP/LAN, con semántica de teclas familiar (Ctrl+V pega, Ctrl+C copia si hay selección).

**Architecture:** El evento `paste` nativo del navegador es la única fuente de verdad para pegar (xterm pega solo con `clipboardData`, idéntico en contexto seguro e inseguro). Copiar usa `navigator.clipboard.writeText` con fallback a `document.execCommand('copy')` para que ande también en HTTP. La lógica de decisión (qué tecla hace qué, copiar-vs-SIGINT) se extrae a funciones puras testeables; el cableado con xterm se verifica manualmente.

**Tech Stack:** Vue 3 + TypeScript, xterm.js 6, Vitest (entorno `node`, solo funciones puras), tmux (sin cambios).

## Global Constraints

- No tocar el servidor (`habitat/server/term.js`): tmux sigue con `mouse on`; la rueda scrollea el historial y se selecciona con Shift+arrastrar (Alt+arrastrar en Mac).
- Tests solo de funciones puras: el entorno de Vitest es `node`, sin `document`/`navigator`. El cableado con el DOM/xterm se verifica manualmente en el navegador (probar en https/localhost **y** en HTTP/LAN).
- Comando de tests: desde `habitat/client`, `npx vitest run src/composables/useTerminal.test.ts`.
- Typecheck: desde `habitat/client`, `npm run typecheck`.
- Mensajes de commit en español, estilo del repo (`feat(habitat): ...`, `fix(habitat): ...`, `test(habitat): ...`).

---

### Task 1: Funciones puras de decisión (intent + acción)

Extiende el detector `copyPasteIntent` para cubrir las teclas reales de pegado (Ctrl+V, Shift+Insert, Cmd+V, y Ctrl+Shift+V como alias) y de copiado (Ctrl+C, Cmd+C). Agrega `decideKeyAction`, que resuelve copiar-vs-SIGINT según haya selección. Ambas son puras y se testean con Vitest.

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (función `copyPasteIntent`, líneas 10-22; agregar `decideKeyAction`)
- Test: `habitat/client/src/composables/useTerminal.test.ts`

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `copyPasteIntent(e: Pick<KeyboardEvent, 'type'|'ctrlKey'|'shiftKey'|'metaKey'|'code'>): 'copy' | 'paste' | null`
  - `decideKeyAction(intent: 'copy' | 'paste' | null, hasSelection: boolean): 'copy' | 'paste' | 'passthrough'`

- [ ] **Step 1: Reescribir los tests de `copyPasteIntent` y agregar los de `decideKeyAction`**

Reemplazá el bloque `describe('copyPasteIntent', ...)` completo en `habitat/client/src/composables/useTerminal.test.ts` por lo siguiente, y agregá el `import` de `decideKeyAction` y su `describe`. El `describe('canReadClipboard', ...)` queda intacto.

```ts
import { describe, it, expect } from 'vitest'
import { copyPasteIntent, decideKeyAction, canReadClipboard } from './useTerminal'

const ev = (o: Partial<KeyboardEvent>) =>
  ({ type: 'keydown', ctrlKey: false, shiftKey: false, metaKey: false, code: '', ...o }) as KeyboardEvent

describe('copyPasteIntent', () => {
  it('pega con Ctrl+V (semántica web, dispara el paste nativo)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('pega con Shift+Insert', () => {
    expect(copyPasteIntent(ev({ shiftKey: true, code: 'Insert' }))).toBe('paste')
  })

  it('pega con Cmd+V en Mac (metaKey)', () => {
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('pega con Ctrl+Shift+V (alias por compatibilidad)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('copia con Ctrl+C y con Cmd+C', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyC' }))).toBe('copy')
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyC' }))).toBe('copy')
  })

  it('Ctrl+Shift+C NO dispara copia (el navegador lo reserva para DevTools)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))).toBe(null)
  })

  it('ignora eventos que no son keydown', () => {
    expect(copyPasteIntent(ev({ type: 'keyup', ctrlKey: true, code: 'KeyV' }))).toBe(null)
  })

  it('otras teclas con el modificador no disparan intent', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyA' }))).toBe(null)
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyK' }))).toBe(null)
  })
})

describe('decideKeyAction', () => {
  it('copy con selección copia', () => {
    expect(decideKeyAction('copy', true)).toBe('copy')
  })

  it('copy sin selección pasa al pty (SIGINT con Ctrl+C)', () => {
    expect(decideKeyAction('copy', false)).toBe('passthrough')
  })

  it('paste siempre pega, haya o no selección', () => {
    expect(decideKeyAction('paste', false)).toBe('paste')
    expect(decideKeyAction('paste', true)).toBe('paste')
  })

  it('sin intent, pasa al pty', () => {
    expect(decideKeyAction(null, true)).toBe('passthrough')
    expect(decideKeyAction(null, false)).toBe('passthrough')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: FAIL — `decideKeyAction` no existe (import roto) y/o varios casos de `copyPasteIntent` no pasan con la implementación vieja.

- [ ] **Step 3: Reescribir `copyPasteIntent` y agregar `decideKeyAction`**

En `habitat/client/src/composables/useTerminal.ts`, reemplazá el bloque actual de `copyPasteIntent` (líneas 10-22, el comentario incluido) por:

```ts
// Intent de copiar/pegar desde el teclado, agnóstico de plataforma.
// PEGAR: el navegador dispara su evento `paste` nativo con Ctrl+V, Cmd+V y
// Shift+Insert. Ctrl+Shift+V NO dispara paste nativo, pero lo aceptamos como alias.
// COPIAR: Ctrl+C (sin Shift) o Cmd+C. La decisión copiar-vs-SIGINT NO vive acá:
// depende de si hay selección y se resuelve en decideKeyAction.
export function copyPasteIntent(
  e: Pick<KeyboardEvent, 'type' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'code'>,
): 'copy' | 'paste' | null {
  if (e.type !== 'keydown') return null
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') return 'paste'
  if (e.shiftKey && e.code === 'Insert') return 'paste'
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC') return 'copy'
  if (e.metaKey && e.code === 'KeyC') return 'copy'
  return null
}

// Resuelve qué hacer con una tecla de copy/paste según el estado de selección.
// 'copy'        -> copiar la selección y NO mandar la tecla al pty.
// 'paste'       -> dejar que el navegador pegue (evento paste nativo).
// 'passthrough' -> mandar la tecla al pty (p. ej. Ctrl+C sin selección = SIGINT).
export function decideKeyAction(
  intent: 'copy' | 'paste' | null,
  hasSelection: boolean,
): 'copy' | 'paste' | 'passthrough' {
  if (intent === 'paste') return 'paste'
  if (intent === 'copy') return hasSelection ? 'copy' : 'passthrough'
  return 'passthrough'
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: PASS — todos los casos de `copyPasteIntent`, `decideKeyAction` y `canReadClipboard` en verde.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/composables/useTerminal.test.ts
git commit -m "feat(habitat): detector de teclas y decisión copiar-vs-SIGINT de la terminal"
```

---

### Task 2: Helper `copyText` con fallback `execCommand`

Agrega `copyText`, que copia al portapapeles usando `writeText` cuando está disponible (contexto seguro) y cae a `document.execCommand('copy')` con un textarea temporal en contexto inseguro (HTTP/LAN). Sin test unitario: el entorno de Vitest es `node` (sin `document`/`navigator`); se verifica manualmente en la Task 3/4.

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (agregar `copyText` y `execCommandCopy` cerca de `canReadClipboard`, después de la línea 33)

**Interfaces:**
- Consumes: nada.
- Produces: `copyText(text: string): void` — copia `text` al portapapeles del sistema. Debe llamarse dentro de un gesto del usuario (keydown/click) para que `execCommand('copy')` funcione en contexto inseguro.

- [ ] **Step 1: Agregar `copyText` y `execCommandCopy`**

En `habitat/client/src/composables/useTerminal.ts`, justo después de la función `canReadClipboard` (línea 33), agregá:

```ts
// Copia texto al portapapeles. En contexto seguro usa la Async Clipboard API; en
// contexto inseguro (HTTP/LAN) writeText no existe, así que cae a execCommand('copy')
// con un textarea temporal. DEBE llamarse dentro de un gesto del usuario.
export function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCommandCopy(text))
    return
  }
  execCommandCopy(text)
}

function execCommandCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try { document.execCommand('copy') } catch { /* sin soporte: no-op */ }
  ta.remove()
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS (sin errores de TypeScript).

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts
git commit -m "feat(habitat): copyText con fallback execCommand para contexto inseguro"
```

---

### Task 3: Cablear el handler de teclado y el copiado en `useTerminal`

Conecta las funciones puras y `copyText` con xterm: el handler de teclado decide copiar / pegar-nativo / passthrough, y `copySelection` (que usa el menú) pasa a copiar con `copyText` para andar en HTTP. Verificación manual en el navegador.

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (función `copySelection` líneas 82-87; bloque `attachCustomKeyEventHandler` líneas 136-151)

**Interfaces:**
- Consumes: `copyPasteIntent`, `decideKeyAction` (Task 1), `copyText` (Task 2), y los locales existentes `getSelection`, `lastSelection`, `term`.
- Produces: comportamiento de teclado de la terminal (no expone símbolos nuevos).

- [ ] **Step 1: Reemplazar `copySelection` para usar `copyText`**

En `habitat/client/src/composables/useTerminal.ts`, reemplazá la función `copySelection` (líneas 82-87) por:

```ts
  // Copia la selección (actual o la última vista) al portapapeles. Devuelve true si copió.
  // Usa copyText para que ande también en contexto inseguro (la usa el menú de click derecho).
  function copySelection() {
    const sel = getSelection()
    if (sel) { copyText(sel); return true }
    return false
  }
```

- [ ] **Step 2: Reemplazar el bloque `attachCustomKeyEventHandler`**

Reemplazá el bloque actual (líneas 136-151, desde `term.attachCustomKeyEventHandler((e) => {` hasta su cierre `})`) por:

```ts
    term.attachCustomKeyEventHandler((e) => {
      const action = decideKeyAction(copyPasteIntent(e), !!getSelection())
      if (action === 'passthrough') return true // p. ej. Ctrl+C sin selección -> SIGINT
      if (action === 'copy') {
        e.preventDefault()
        copyText(getSelection())
        term?.clearSelection()
        lastSelection = ''
        term?.focus()
        return false
      }
      // action === 'paste': NO hacemos preventDefault. Devolver false evita que xterm
      // emita ^V al pty, pero deja que el navegador dispare el evento `paste` nativo,
      // que el textarea oculto de xterm pega con clipboardData. Funciona igual en
      // https y en HTTP/LAN, sin leer el portapapeles por API.
      return false
    })
```

- [ ] **Step 3: Verificar typecheck y tests**

Run: `cd habitat/client && npm run typecheck && npx vitest run src/composables/useTerminal.test.ts`
Expected: PASS (typecheck sin errores; tests en verde).

- [ ] **Step 4: Verificación manual en el navegador (CRÍTICA — riesgo del evento paste)**

Levantá la app (`cd habitat/client && npm run dev`, con el server backend corriendo) y abrí una sesión con terminal.

1. **Pegar en https/localhost:** copiá texto fuera de la terminal, hacé foco en la terminal y probá `Ctrl+V`, `Shift+Insert` y `Ctrl+Shift+V`. Cada uno debe pegar el texto **una sola vez** y **no** dejar un `^V` literal en el prompt.
   - Si aparece un `^V` además del texto, o no pega: el `return false` del handler está suprimiendo el evento `paste` nativo. **Plan B:** agregar un listener `paste` propio. Después de `term.open(el)` en `setup`, registrar:
     ```ts
     const textarea = el.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
     textarea?.addEventListener('paste', (ev) => {
       const t = ev.clipboardData?.getData('text/plain')
       if (t) { term?.paste(t); ev.preventDefault() }
     })
     ```
     y removerlo en `teardown`. (El handler de teclado sigue devolviendo false para no emitir `^V`.)
2. **Copiar con Ctrl+C:** seleccioná texto con `Shift+arrastrar` y apretá `Ctrl+C`. Debe copiar (pegalo en otra app) y limpiar la selección. Sin selección, `Ctrl+C` debe interrumpir un comando (probá `sleep 30` y cortarlo con `Ctrl+C`).
3. **Rueda:** verificá que la rueda del mouse sigue scrolleando el historial (sin regresión).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts
git commit -m "feat(habitat): Ctrl+V pega vía evento nativo; Ctrl+C copia si hay selección"
```

---

### Task 4: Menú contextual — atajos visibles y "Pegar" deshabilitado en contexto inseguro

Mejora la descubribilidad: el menú de click derecho muestra los atajos (⌃C / ⌃V) y deshabilita "Pegar" en contexto inseguro (donde un click no puede leer el portapapeles), con un hint hacia Ctrl+V.

**Files:**
- Modify: `habitat/client/src/components/DetailPanel.vue` (import línea 9; lógica del menú; template líneas 90-96; estilos)

**Interfaces:**
- Consumes: `canReadClipboard` (exportada en `useTerminal.ts`), `copySelection`, `pasteClipboard`, `getSelection` (ya expuestas por `useTerminal`).
- Produces: UI (no expone símbolos).

- [ ] **Step 1: Importar `canReadClipboard` y exponer `canPaste`**

En `habitat/client/src/components/DetailPanel.vue`, cambiá el import de la línea 9:

```ts
import { useTerminal, canReadClipboard } from '../composables/useTerminal'
```

Y agregá, justo después de la línea `const { fit, insert, getSelection, copySelection, pasteClipboard } = useTerminal(termEl, selectedId)` (línea 16):

```ts
// En contexto inseguro (HTTP/LAN) no se puede leer el portapapeles desde un click:
// el botón "Pegar" se deshabilita y el usuario pega con Ctrl+V (evento nativo).
const canPaste = canReadClipboard()
```

- [ ] **Step 2: Actualizar el template del menú**

Reemplazá el bloque del menú (líneas 92-95, los dos `<button>` dentro de `.ctxmenu`) por:

```html
        <div class="ctxmenu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
          <button :disabled="!menu.hasSel" @click="menuCopy">Copiar <span class="sc">⌃C</span></button>
          <button :disabled="!canPaste" :title="canPaste ? '' : 'Pegá con Ctrl+V'" @click="menuPaste">
            Pegar <span class="sc">⌃V</span>
          </button>
        </div>
```

- [ ] **Step 3: Agregar el estilo `.sc` del atajo**

En el bloque `<style scoped>`, después de la regla `.ctxmenu button:disabled { ... }` (línea 130), agregá:

```css
.ctxmenu button { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.ctxmenu .sc { opacity: 0.5; font-size: 11px; }
```

- [ ] **Step 4: Verificar typecheck y build**

Run: `cd habitat/client && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verificación manual del menú**

1. **Contexto seguro (localhost):** click derecho en la terminal. "Copiar" se habilita solo si hay selección y copia; "Pegar" está habilitado y pega. Ambos muestran el atajo (⌃C / ⌃V).
2. **Contexto inseguro (HTTP por IP de LAN):** "Pegar" aparece **deshabilitado** con tooltip "Pegá con Ctrl+V"; "Copiar" (con selección) **sí** copia (vía `execCommand`).

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): menú de terminal muestra atajos y deshabilita Pegar en HTTP"
```

---

## Cierre (workflow Git obligatorio del repo)

Antes de cerrar, sincronizar con `main`, resolver conflictos, verificar tests/typecheck, y abrir el PR:

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ellie
git fetch origin && git merge origin/main
cd habitat/client && npm run typecheck && npx vitest run
git push origin ellie
gh pr create --base main --head ellie
```

---

## Notas de verificación de cobertura (self-review del plan)

- Pegar Ctrl+V / Shift+Insert / Cmd+V / Ctrl+Shift+V → Task 1 (detección) + Task 3 (cableado). ✓
- "a veces funciona" (seguro vs inseguro) → Task 3: un solo camino vía evento nativo, sin `readText` para pegar. ✓
- Ctrl+C copia si hay selección, si no SIGINT → Task 1 (`decideKeyAction`) + Task 3 (handler). ✓
- Copiar en HTTP/LAN → Task 2 (`copyText` + `execCommand`) usado por handler (Task 3) y menú (Task 4). ✓
- copy-on-select best-effort en seguro → ya existe en `onSelectionChange` (líneas 129-135), no requiere cambios. ✓
- Rueda intacta / sin cambios de servidor → ninguna tarea toca `term.js`; verificación en Task 3 Step 4. ✓
- Menú con atajos + Pegar deshabilitado en inseguro → Task 4. ✓
- Riesgo del `return false`/evento paste → Task 3 Step 4 con plan B explícito. ✓
