# Teclas en pantalla para la terminal (tablet) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una fila de botones táctiles (`↑ ↓ ← → Enter Esc Tab`) que manden la tecla al pty en la terminal principal y en el editor, activable desde Settings, para poder navegar los menús de Claude Code y nvim en Android (donde el teclado no tiene flechas/Esc/Tab).

**Architecture:** La lógica de "qué bytes mandar" vive en el composable `useTerminal.ts` (elige la secuencia de flecha según `term.modes.applicationCursorKeysMode`). Un composable nuevo `useTermKeys.ts` guarda el toggle en localStorage (default por detección táctil). Un componente presentacional `TermKeys.vue` (la fila de botones) se monta en `DetailPanel` y `EditorTerminal`, y el toggle se expone en `SettingsView`.

**Tech Stack:** Vue 3 (composables + SFC), TypeScript, `@xterm/xterm` ^6, Vitest ^2.

## Global Constraints

- Trabajar desde `habitat/client/`. Tests: `npm run test` o `npx vitest run <ruta>`. Typecheck: `npx vue-tsc --noEmit`.
- Funciones puras nuevas exportadas y testeadas (patrón de `rowFromY`/`joinBufferLines`, `useCompactPods`).
- Comentarios en español.
- Secuencias exactas: flechas `\x1bO{A,B,C,D}` con DECCKM activo, `\x1b[{A,B,C,D}` si no; `Enter`=`\r`, `Esc`=`\x1b`, `Tab`=`\t` (A=up, B=down, C=right, D=left).
- El toggle es por-dispositivo (localStorage, clave `habitat.termKeys`), NO server-backed. Default: valor guardado si existe, si no `matchMedia('(pointer: coarse)').matches`.
- Los botones NO deben robar el foco del terminal (`@pointerdown.prevent`).
- Tasks 3 y 4 (SFC/wiring) no son unit-testeables (el repo no tiene component tests); se validan con `vue-tsc --noEmit` + prueba manual en la tablet.

---

### Task 1: `keySeq` + `sendKey` en useTerminal

**Files:**
- Modify: `habitat/client/src/composables/useTerminal.ts` (agregar `SpecialKey` + `keySeq` junto a las otras funciones puras; agregar `sendKey` dentro de `useTerminal` y exponerlo en el return)
- Test: `habitat/client/src/composables/useTerminal.test.ts` (agregar `describe('keySeq')`)

**Interfaces:**
- Consumes: `term`, `ws`, `enc` (ya existen en el módulo).
- Produces:
  - `export type SpecialKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab'`
  - `export function keySeq(key: SpecialKey, appCursorKeys: boolean): string`
  - `useTerminal(...)` devuelve además `sendKey(key: SpecialKey): void`

- [ ] **Step 1: Escribir el test que falla**

En `habitat/client/src/composables/useTerminal.test.ts`, agregar `keySeq` al import de la línea 2:

```ts
import { copyPasteIntent, decideKeyAction, canReadClipboard, joinBufferLines, rowFromY, wheelNotchesFromDelta, isVerticalDrag, keySeq } from './useTerminal'
```

Y al final del archivo:

```ts
describe('keySeq', () => {
  it('flechas en modo normal (CSI)', () => {
    expect(keySeq('up', false)).toBe('\x1b[A')
    expect(keySeq('down', false)).toBe('\x1b[B')
    expect(keySeq('right', false)).toBe('\x1b[C')
    expect(keySeq('left', false)).toBe('\x1b[D')
  })
  it('flechas en modo application cursor keys (SS3)', () => {
    expect(keySeq('up', true)).toBe('\x1bOA')
    expect(keySeq('down', true)).toBe('\x1bOB')
    expect(keySeq('right', true)).toBe('\x1bOC')
    expect(keySeq('left', true)).toBe('\x1bOD')
  })
  it('Enter/Esc/Tab no dependen del modo', () => {
    expect(keySeq('enter', false)).toBe('\r')
    expect(keySeq('enter', true)).toBe('\r')
    expect(keySeq('esc', false)).toBe('\x1b')
    expect(keySeq('tab', true)).toBe('\t')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts`
Expected: FAIL — `keySeq is not a function`.

- [ ] **Step 3: Implementar `SpecialKey`, `keySeq` y `sendKey`**

En `habitat/client/src/composables/useTerminal.ts`, después de `isVerticalDrag` (las funciones puras que agregó el trabajo de scroll), agregar:

```ts
// Teclas especiales que el teclado táctil de Android no tiene y que mandamos por botones.
export type SpecialKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab'

// Secuencia de bytes para una tecla especial. Las flechas dependen del modo del
// terminal: con application cursor keys (DECCKM) activo la app espera \x1bO_, si no
// \x1b[_ (A=arriba, B=abajo, C=derecha, D=izquierda). Enter/Esc/Tab no dependen del modo.
export function keySeq(key: SpecialKey, appCursorKeys: boolean): string {
  const prefix = appCursorKeys ? '\x1bO' : '\x1b['
  switch (key) {
    case 'up': return prefix + 'A'
    case 'down': return prefix + 'B'
    case 'right': return prefix + 'C'
    case 'left': return prefix + 'D'
    case 'enter': return '\r'
    case 'esc': return '\x1b'
    case 'tab': return '\t'
  }
}
```

Dentro de `useTerminal`, junto a `insert` (~línea 181), agregar:

```ts
  // Manda una tecla especial (flecha/Esc/Tab/Enter) al pty. Elige la secuencia según
  // el modo application-cursor-keys que xterm tenga activo en este momento (como un
  // teclado real). No-op si el WS no está abierto.
  function sendKey(key: SpecialKey) {
    if (!term || !ws || ws.readyState !== 1) return
    ws.send(enc.encode(keySeq(key, !!term.modes.applicationCursorKeysMode)))
  }
```

Y agregar `sendKey` al objeto que devuelve `useTerminal` (~línea 309):

```ts
  return { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode, sendKey }
```

- [ ] **Step 4: Correr el test y typecheck**

Run: `cd habitat/client && npx vitest run src/composables/useTerminal.test.ts && npx vue-tsc --noEmit`
Expected: PASS (todos los describe) y typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTerminal.ts habitat/client/src/composables/useTerminal.test.ts
git commit -m "feat(habitat): keySeq/sendKey para teclas especiales en la terminal"
```

---

### Task 2: composable `useTermKeys` (toggle localStorage)

**Files:**
- Create: `habitat/client/src/composables/useTermKeys.ts`
- Test: `habitat/client/src/composables/useTermKeys.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export function readInitialEnabled(stored: string | null, coarse: boolean): boolean`
  - `export function useTermKeys(): { enabled: import('vue').Ref<boolean>; toggle: () => void }`

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/composables/useTermKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readInitialEnabled } from './useTermKeys'

describe('readInitialEnabled', () => {
  it('respeta el valor guardado "1" (ON) por encima de la detección táctil', () => {
    expect(readInitialEnabled('1', false)).toBe(true)
  })
  it('respeta el valor guardado "0" (OFF) por encima de la detección táctil', () => {
    expect(readInitialEnabled('0', true)).toBe(false)
  })
  it('sin valor guardado usa la detección táctil (coarse=true → ON)', () => {
    expect(readInitialEnabled(null, true)).toBe(true)
  })
  it('sin valor guardado y no táctil → OFF', () => {
    expect(readInitialEnabled(null, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useTermKeys.test.ts`
Expected: FAIL — no existe el módulo `./useTermKeys`.

- [ ] **Step 3: Implementar el composable**

Crear `habitat/client/src/composables/useTermKeys.ts`:

```ts
import { ref } from 'vue'

// Preferencia POR-DISPOSITIVO (localStorage) para mostrar el strip de teclas en
// pantalla. Patrón de useCompactPods. Guards `typeof` para importar en node (tests).
const KEY = 'habitat.termKeys'

// Valor inicial del toggle: si hay algo guardado ('1'/'0') gana; si no, usa la
// detección táctil (coarse) como default (ON en tablet/teléfono, OFF en desktop).
export function readInitialEnabled(stored: string | null, coarse: boolean): boolean {
  if (stored === '1') return true
  if (stored === '0') return false
  return coarse
}

function coarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
}

function storedValue(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
}

// Singleton a nivel de módulo: la vista de Settings y las terminales comparten el ref.
const enabled = ref(readInitialEnabled(storedValue(), coarsePointer()))

export function useTermKeys() {
  function toggle() {
    enabled.value = !enabled.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, enabled.value ? '1' : '0')
    }
  }
  return { enabled, toggle }
}
```

- [ ] **Step 4: Correr el test y typecheck**

Run: `cd habitat/client && npx vitest run src/composables/useTermKeys.test.ts && npx vue-tsc --noEmit`
Expected: PASS (4 tests) y typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useTermKeys.ts habitat/client/src/composables/useTermKeys.test.ts
git commit -m "feat(habitat): useTermKeys (toggle localStorage con default táctil)"
```

---

### Task 3: componente `TermKeys.vue` + montaje en terminal y editor

**Files:**
- Create: `habitat/client/src/components/TermKeys.vue`
- Modify: `habitat/client/src/components/DetailPanel.vue` (script: destructurar `sendKey`, importar `TermKeys` + `useTermKeys`; template: montar el strip entre `term-bar` y `term-body`; agregar CSS del row)
- Modify: `habitat/client/src/components/EditorTerminal.vue` (script: destructurar `sendKey`, importar `TermKeys` + `useTermKeys`; template: barra con el strip entre el header y `ed-term`; CSS)

**Interfaces:**
- Consumes: `SpecialKey`, `sendKey` (Task 1); `useTermKeys().enabled` (Task 2).
- Produces: `TermKeys.vue` que emite `press(key: SpecialKey)`.

**Nota:** no unit-testeable (sin component tests en el repo). Verificación: `vue-tsc --noEmit` + prueba manual en tablet (Step 5).

- [ ] **Step 1: Crear `TermKeys.vue`**

Crear `habitat/client/src/components/TermKeys.vue`:

```vue
<script setup lang="ts">
import type { SpecialKey } from '../composables/useTerminal'

const emit = defineEmits<{ (e: 'press', key: SpecialKey): void }>()

// Fila de teclas que Android no tiene: flechas + Enter/Esc/Tab.
const KEYS: { key: SpecialKey; label: string; title: string }[] = [
  { key: 'up', label: '↑', title: 'Flecha arriba' },
  { key: 'down', label: '↓', title: 'Flecha abajo' },
  { key: 'left', label: '←', title: 'Flecha izquierda' },
  { key: 'right', label: '→', title: 'Flecha derecha' },
  { key: 'enter', label: '⏎', title: 'Enter' },
  { key: 'esc', label: 'Esc', title: 'Escape' },
  { key: 'tab', label: 'Tab', title: 'Tab' },
]
</script>

<template>
  <div class="termkeys">
    <button
      v-for="k in KEYS"
      :key="k.key"
      class="tk"
      :title="k.title"
      @pointerdown.prevent
      @click="emit('press', k.key)"
    >{{ k.label }}</button>
  </div>
</template>

<style scoped>
.termkeys { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tk {
  min-width: 40px; min-height: 34px; padding: 4px 10px;
  background: var(--color-raise, #2a2018); color: var(--color-ink, #e8dcc0);
  border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px);
  font-size: 15px; line-height: 1; cursor: pointer; user-select: none;
}
.tk:active { border-color: var(--color-brass, #e0a94b); color: var(--color-brass, #e0a94b); }
</style>
```

`@pointerdown.prevent` evita que el botón robe el foco del terminal; `@click` emite la tecla (el click sigue disparándose aunque se prevenga el pointerdown).

- [ ] **Step 2: Montar en `DetailPanel.vue`**

En el `<script setup>`, agregar los imports (junto a los otros, ~línea 12):

```ts
import TermKeys from './TermKeys.vue'
import { useTermKeys } from '../composables/useTermKeys'
```

Destructurar `sendKey` del composable (línea 20, agregarlo a la lista existente):

```ts
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode, sendKey } =
  useTerminal(termEl, selectedId, { onCopied: flashCopied })
```

Y obtener `enabled` (después de esa línea):

```ts
const { enabled: termKeysEnabled } = useTermKeys()
```

En el template, entre el cierre de `term-bar` (línea 142, `</div>`) y el `term-body` (línea 143), insertar:

```html
        <div v-if="termKeysEnabled" class="term-keys-row"><TermKeys @press="sendKey" /></div>
```

En el `<style scoped>`, agregar:

```css
.term-keys-row { padding: 5px 6px; border-top: 1px solid var(--color-line); }
```

- [ ] **Step 3: Montar en `EditorTerminal.vue`**

Reemplazar el `<script setup>` completo (líneas 1-11) por:

```ts
<script setup lang="ts">
import { ref } from 'vue'
import { useTerminal } from '../composables/useTerminal'
import { useTermKeys } from '../composables/useTermKeys'
import TermKeys from './TermKeys.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const termEl = ref<HTMLElement | null>(null)
const idRef = ref<string>(props.id)
const { sendKey } = useTerminal(termEl, idRef, { role: 'edit' })
const { enabled: termKeysEnabled } = useTermKeys()
</script>
```

En el template, entre el `</header>` y el `<div ref="termEl" class="ed-term">`, insertar:

```html
    <div v-if="termKeysEnabled" class="ed-keys"><TermKeys @press="sendKey" /></div>
```

En el `<style scoped>`, agregar:

```css
.ed-keys { padding: 5px 7px; border-bottom: 1px solid var(--color-line, #3a2e22); }
```

- [ ] **Step 4: Typecheck**

Run: `cd habitat/client && npx vue-tsc --noEmit && npx vitest run`
Expected: typecheck sin errores; toda la suite de tests sigue en verde.

- [ ] **Step 5: Commit (y prueba manual pendiente en tablet)**

La prueba manual (flechas navegando menús de Claude Code + nvim en la tablet) la hace el humano tras el deploy; no bloquea el commit.

```bash
git add habitat/client/src/components/TermKeys.vue habitat/client/src/components/DetailPanel.vue habitat/client/src/components/EditorTerminal.vue
git commit -m "feat(habitat): strip de teclas en pantalla en terminal y editor"
```

---

### Task 4: toggle en `SettingsView.vue`

**Files:**
- Modify: `habitat/client/src/components/SettingsView.vue` (script: importar/usar `useTermKeys`; template: fila con checkbox)

**Interfaces:**
- Consumes: `useTermKeys()` → `{ enabled, toggle }` (Task 2).
- Produces: nada.

**Nota:** no unit-testeable; verificación por typecheck + prueba manual (el toggle muestra/oculta el strip y persiste).

- [ ] **Step 1: Agregar el composable al script**

En `habitat/client/src/components/SettingsView.vue`, agregar el import (después de la línea 4):

```ts
import { useTermKeys } from '../composables/useTermKeys'
```

Y después de la línea 6 (`const { permissionMode, ... } = useSettings()`):

```ts
const { enabled: termKeys, toggle: toggleTermKeys } = useTermKeys()
```

- [ ] **Step 2: Agregar la fila del toggle al template**

En el template, después del `<p class="desc">...</p>` del permission mode (línea 29) y antes de `<p class="err" ...>` (línea 30), insertar:

```html
    <div class="row">
      <label for="termkeys">Teclas en pantalla (flechas / Esc / Tab)</label>
      <label class="toggle">
        <input id="termkeys" type="checkbox" :checked="termKeys" @change="toggleTermKeys" />
        <span>{{ termKeys ? 'Activado' : 'Desactivado' }}</span>
      </label>
    </div>
    <p class="desc">Muestra una fila de teclas táctiles en la terminal y el editor. Útil en tablets/teléfonos sin flechas físicas.</p>
```

En el `<style scoped>`, agregar:

```css
.toggle { display: flex; align-items: center; gap: 8px; font-family: var(--font-system); font-size: 13px; color: var(--color-ink); }
.toggle input { width: 18px; height: 18px; accent-color: var(--color-brass); }
```

- [ ] **Step 3: Typecheck y tests**

Run: `cd habitat/client && npx vue-tsc --noEmit && npx vitest run`
Expected: typecheck limpio; toda la suite en verde.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/SettingsView.vue
git commit -m "feat(habitat): toggle de teclas en pantalla en Settings"
```

---

## Cierre

Antes de cerrar (según CLAUDE.md), estando ya en la branch `sora`:

```bash
git fetch origin
git merge origin/main   # resolver conflictos, re-correr tests/typecheck
git push origin sora
# el PR #64 (sora) ya existe; este trabajo se suma ahí
```

## Self-Review (hecho)

- **Cobertura del spec:** mecanismo/secuencias → Task 1 (`keySeq`+`sendKey`, DECCKM vía `term.modes.applicationCursorKeysMode`); toggle localStorage + default táctil → Task 2 (`useTermKeys`/`readInitialEnabled`); strip en terminal y editor + no robar foco → Task 3 (`TermKeys.vue` con `@pointerdown.prevent`, montado en `DetailPanel` y `EditorTerminal`); control en Settings → Task 4. Testing: `keySeq` (Task 1) y `readInitialEnabled` (Task 2) con unit tests; SFCs por typecheck + manual. Sin huecos.
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** `SpecialKey`, `keySeq(key, appCursorKeys)`, `sendKey(key)`, `readInitialEnabled(stored, coarse)`, `useTermKeys() → { enabled, toggle }` y el evento `press(key: SpecialKey)` de `TermKeys.vue` se usan con las mismas firmas en todos los tasks.
