# Hábitat Tab Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a la pestaña del Hábitat un favicon de marca y avisar (título + favicon con badge, notificación y sonido) cuando una sesión entra en estado `waiting` ("te necesita").

**Architecture:** Una composable de nivel app (`useTabAlert`) observa `store.needCount` y el conjunto de sesiones en `waiting`. Refleja el estado en el título y en un favicon compositado en `<canvas>` (siempre), y dispara notificación + chime WebAudio solo en la *transición* a `waiting` y solo si la tab está en background. La detección de transición se aísla en una función pura testeable.

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, Vite, Vitest, Canvas 2D, Notification API, WebAudio API.

## Global Constraints

- Idioma de la UI/copy: **español** (etiquetas como "te necesita").
- Título base exacto: `Hábitat · El Mono`.
- Favicon source: `/assets/char/Monkey/face.png` (38×38 RGBA, ya existe).
- No agregar assets binarios nuevos (sonido por WebAudio; favicon de alerta por canvas).
- Sin dependencias npm nuevas.
- Tests con Vitest: `npm test` (= `vitest run`) desde `habitat/client`.
- Typecheck: `npm run typecheck` (= `vue-tsc --noEmit`).

---

### Task 1: Función pura de detección de transición a `waiting`

**Files:**
- Create: `habitat/client/src/composables/tabAlert.ts`
- Test: `habitat/client/src/composables/tabAlert.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `newlyWaiting(prev: ReadonlySet<string>, current: ReadonlySet<string>): string[]`
    — ids presentes en `current` y ausentes en `prev`, en el orden de iteración de `current`.

- [ ] **Step 1: Write the failing test**

`habitat/client/src/composables/tabAlert.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newlyWaiting } from './tabAlert'

describe('newlyWaiting', () => {
  it('devuelve los ids nuevos que no estaban antes', () => {
    const prev = new Set(['a'])
    const current = new Set(['a', 'b', 'c'])
    expect(newlyWaiting(prev, current)).toEqual(['b', 'c'])
  })

  it('no devuelve nada si no hay nuevos', () => {
    expect(newlyWaiting(new Set(['a', 'b']), new Set(['a']))).toEqual([])
    expect(newlyWaiting(new Set(['a']), new Set(['a']))).toEqual([])
  })

  it('desde vacío devuelve todos los actuales', () => {
    expect(newlyWaiting(new Set(), new Set(['x', 'y']))).toEqual(['x', 'y'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/client && npx vitest run src/composables/tabAlert.test.ts`
Expected: FAIL — `newlyWaiting` no está definido / módulo no existe.

- [ ] **Step 3: Write minimal implementation**

`habitat/client/src/composables/tabAlert.ts`:

```ts
// Lógica pura de las alertas de tab, aislada para testear sin DOM.

/** ids que están en `current` pero no estaban en `prev` (orden de `current`). */
export function newlyWaiting(prev: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const id of current) if (!prev.has(id)) out.push(id)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/client && npx vitest run src/composables/tabAlert.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/tabAlert.ts habitat/client/src/composables/tabAlert.test.ts
git commit -m "feat(habitat): helper puro newlyWaiting para alertas de tab"
```

---

### Task 2: Favicon base en el HTML

**Files:**
- Modify: `habitat/client/index.html` (dentro de `<head>`)

**NOTA:** NO editar `habitat/web/index.html`. Es output de build (`vite.config.ts`:
`build.outDir = ../web`, `emptyOutDir: true`) y está **gitignoreado**; se borra y
regenera en cada `npm run build` desde `client/index.html`. El `<link>` agregado en
`client/index.html` se propaga al build automáticamente.

**Interfaces:**
- Consumes: asset `/assets/char/Monkey/face.png`.
- Produces: un `<link rel="icon">` por defecto que la composable luego sobreescribe.

- [ ] **Step 1: Agregar el link en `client/index.html`**

En `habitat/client/index.html`, dentro de `<head>`, después de la línea `<meta name="viewport" ...>`:

```html
  <link rel="icon" type="image/png" href="/assets/char/Monkey/face.png" />
```

- [ ] **Step 2: Verificar que el asset existe y el link quedó**

Run: `ls habitat/client/public/assets/char/Monkey/face.png && grep -n "rel=\"icon\"" habitat/client/index.html`
Expected: existe el png y aparece el link en `client/index.html`.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/index.html
git commit -m "feat(habitat): favicon del Monkey en la tab"
```

---

### Task 3: Composable `useTabAlert` (título, favicon badge, notificación, sonido) + wiring

**Files:**
- Create: `habitat/client/src/composables/useTabAlert.ts`
- Modify: `habitat/client/src/App.vue` (script setup)

**Interfaces:**
- Consumes:
  - `newlyWaiting` de `./tabAlert` (Task 1).
  - `useSessions` de `../stores/sessions` → `store.list` (`Session[]`), `store.needCount` (`number`).
- Produces:
  - `useTabAlert(): void` — se llama una vez en `App.vue`. Sin retorno.

- [ ] **Step 1: Implementar la composable**

`habitat/client/src/composables/useTabAlert.ts`:

```ts
import { watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { newlyWaiting } from './tabAlert'

const BASE_TITLE = 'Hábitat · El Mono'
const ICON_HREF = '/assets/char/Monkey/face.png'
const SIZE = 64

// --- favicon: dibuja el rostro del Monkey en un canvas y, si hay alerta,
// le pinta un badge rojo (con número si needCount > 1). Setea el <link> via dataURL.
let iconImg: HTMLImageElement | null = null
let iconReady = false

function ensureIconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

function drawFavicon(needCount: number) {
  if (!iconReady || !iconImg) return
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false // mantener pixel-art nítido
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.drawImage(iconImg, 0, 0, SIZE, SIZE)

  if (needCount > 0) {
    const r = SIZE * 0.28
    const cx = SIZE - r - 2
    const cy = SIZE - r - 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#e03b3b'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#2a1c0a'
    ctx.stroke()
    if (needCount > 1) {
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(needCount > 9 ? '9+' : needCount), cx, cy + 1)
    }
  }
  ensureIconLink().href = canvas.toDataURL('image/png')
}

// --- sonido: chime corto de dos notas con WebAudio (sin asset). ---
let audioCtx: AudioContext | null = null
function playChime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const now = audioCtx.currentTime
    const notes = [660, 880]
    notes.forEach((freq, i) => {
      const t = now + i * 0.13
      const osc = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      osc.connect(gain).connect(audioCtx!.destination)
      osc.start(t)
      osc.stop(t + 0.13)
    })
  } catch {
    /* sin sonido si el navegador lo bloquea */
  }
}

// --- notificación del navegador (solo en background). ---
function notify(names: string[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const body =
    names.length === 1
      ? `La sesión «${names[0]}» te necesita`
      : `«${names[0]}» y ${names.length - 1} más te necesitan`
  try {
    new Notification('El Mono · Hábitat', { body, icon: ICON_HREF })
  } catch {
    /* algunos navegadores requieren ServiceWorker; se omite */
  }
}

export function useTabAlert(): void {
  const store = useSessions()

  // pedir permiso una vez (si el navegador lo soporta y está en 'default')
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission()
  }

  // cargar el sprite del Monkey y dibujar el favicon inicial
  iconImg = new Image()
  iconImg.onload = () => {
    iconReady = true
    drawFavicon(store.needCount)
  }
  iconImg.src = ICON_HREF

  // título + favicon reflejan el estado actual (siempre)
  watch(
    () => store.needCount,
    (n) => {
      document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE
      drawFavicon(n)
    },
    { immediate: true },
  )

  // transición a waiting → notif + sonido (solo en background)
  let prevWaiting = new Set(store.list.filter((s) => s.status === 'waiting').map((s) => s.id))
  watch(
    () => store.list.map((s) => `${s.id}:${s.status}`).join('|'),
    () => {
      const current = new Set(store.list.filter((s) => s.status === 'waiting').map((s) => s.id))
      const fresh = newlyWaiting(prevWaiting, current)
      prevWaiting = current
      if (fresh.length && document.hidden) {
        const names = fresh.map((id) => store.list.find((s) => s.id === id)?.name ?? id)
        notify(names)
        playChime()
      }
    },
  )
}
```

- [ ] **Step 2: Wire en `App.vue`**

En `habitat/client/src/App.vue`, en el `<script setup>`:

Agregar import junto a los otros:

```ts
import { useTabAlert } from './composables/useTabAlert'
```

Y debajo de `onMounted(startSocket)` agregar la llamada (la composable usa `watch`, se puede invocar en setup):

```ts
useTabAlert()
```

- [ ] **Step 3: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Correr toda la suite de tests**

Run: `cd habitat/client && npm test`
Expected: PASS (incluye `tabAlert.test.ts`; el resto sin regresiones).

- [ ] **Step 5: Verificación manual (build dev)**

Run: `cd habitat/client && npm run dev` y abrir el Hábitat.
Expected:
- Tab muestra el favicon del Monkey y título `Hábitat · El Mono`.
- Llevar una sesión a `waiting`: título pasa a `(1) Hábitat · El Mono`, favicon con badge rojo.
- Con la tab en background al pasar a `waiting`: aparece notificación + suena el chime.
- Volver la sesión a `idle`/`done`: título y favicon vuelven al estado base.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/composables/useTabAlert.ts habitat/client/src/App.vue
git commit -m "feat(habitat): alertas de tab (título, favicon badge, notificación y sonido) en 'te necesita'"
```

---

## Self-Review

- **Spec coverage:** §1 favicon base → Task 2; §2 favicon canvas/badge → Task 3 (`drawFavicon`); §3 composable `useTabAlert` → Task 3; §4 transición → Task 1 (`newlyWaiting`) + Task 3 (`prevWaiting`/watch, init sin disparar); §5 notificación → Task 3 (`notify` + `requestPermission`); §6 sonido WebAudio → Task 3 (`playChime`); §7 wiring → Task 3 Step 2. Testing §unit → Task 1. Cubierto.
- **Placeholder scan:** sin TBD/TODO; todo el código presente.
- **Type consistency:** `newlyWaiting(prev, current)` mismo nombre/firma en Task 1 y su uso en Task 3; `useTabAlert(): void` consistente con el wiring; `ICON_HREF`/`BASE_TITLE` usados de forma coherente.
```