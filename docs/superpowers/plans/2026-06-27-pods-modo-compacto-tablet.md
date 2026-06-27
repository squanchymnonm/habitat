# UI tablet: pods compactos + chrome flotante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar la UI del hábitat a tablet: un toggle global de "pods compactos" (fila chica con avatar, nombre, proyecto y pelotita de stamina en vez de la batalla), rail más angosto en landscape, y reemplazo del header fijo por un menú hamburguesa flotante + badge de stats flotante.

**Architecture:** Cliente Vue 3 + TypeScript + Pinia + Vite en `habitat/client`. El estado de compacto es un composable singleton (patrón de `useAuth`) persistido en `localStorage`. Los pods leen ese estado y cambian su render/CSS. El chrome (controles + stats) sale del `<header>` y pasa a overlays `position:fixed`.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Pinia, Vitest (runner; entorno node, sin DOM — los globals se mockean con `vi.stubGlobal`), CSS global en `src/style.css`.

## Global Constraints

- Directorio de trabajo del cliente: `habitat/client`. Todos los comandos `npm` se corren ahí.
- Test runner: Vitest. Correr tests: `npm run test`. Typecheck: `npm run typecheck`. Build: `npm run build`.
- Entorno de tests = node (sin DOM). Cualquier global de browser (`fetch`, `localStorage`) se mockea con `vi.stubGlobal(...)` (ver `src/composables/useAuth.test.ts`).
- Composables con estado compartido = singleton a nivel de módulo (`const x = ref(...)` fuera de la función exportada), como `useAuth.ts`.
- Componentes en `<script setup lang="ts">`.
- Persistencia en `localStorage` con prefijo `habitat.` (ej. `habitat.railWidth`).
- Mensajes de commit terminan con:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Cambio puramente aditivo: no tocar la lógica interna de `MiniArena.vue` ni `SpawnMenu.vue`; el `<footer>` se mantiene.

---

### Task 1: Composable `useCompactPods`

Estado global del modo compacto, persistido. Singleton seguro de importar sin `localStorage` (entorno de test node).

**Files:**
- Create: `habitat/client/src/composables/useCompactPods.ts`
- Test: `habitat/client/src/composables/useCompactPods.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `useCompactPods(): { compact: Ref<boolean>, toggleCompact(): void }`. La clave de persistencia es `'habitat.compactPods'` con valores `'1'`/`'0'`.

- [ ] **Step 1: Write the failing test**

```ts
// habitat/client/src/composables/useCompactPods.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCompactPods } from './useCompactPods'

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('useCompactPods', () => {
  it('toggleCompact invierte el estado y lo persiste en localStorage', () => {
    const store = memStorage()
    vi.stubGlobal('localStorage', store)
    const { compact, toggleCompact } = useCompactPods()
    const start = compact.value
    toggleCompact()
    expect(compact.value).toBe(!start)
    expect(store.getItem('habitat.compactPods')).toBe(compact.value ? '1' : '0')
    toggleCompact()
    expect(compact.value).toBe(start)
    expect(store.getItem('habitat.compactPods')).toBe(compact.value ? '1' : '0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/client && npm run test -- useCompactPods`
Expected: FAIL — `Failed to resolve import './useCompactPods'` / módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// habitat/client/src/composables/useCompactPods.ts
import { ref } from 'vue'

// Estado global del modo compacto de los pods, persistido entre recargas.
// Guard `typeof localStorage` para que el módulo sea seguro de importar en
// entornos sin DOM (tests en node).
const KEY = 'habitat.compactPods'

function readInitial(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
}

const compact = ref(readInitial())

export function useCompactPods() {
  function toggleCompact() {
    compact.value = !compact.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, compact.value ? '1' : '0')
    }
  }
  return { compact, toggleCompact }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/client && npm run test -- useCompactPods`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useCompactPods.ts habitat/client/src/composables/useCompactPods.test.ts
git commit -m "feat(habitat): composable useCompactPods (toggle + persistencia)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Helper puro `staminaHue`

Color de la pelotita de stamina por gradiente continuo. Función pura, reutilizable y testeable. Vive en `sprites.ts` (que ya agrupa helpers de display como `ago()`).

**Files:**
- Modify: `habitat/client/src/sprites.ts` (agregar export)
- Test: `habitat/client/src/sprites.test.ts` (agregar casos)

**Interfaces:**
- Consumes: nada.
- Produces: `staminaHue(stamina: number): number` — recibe 0..100 (clampa fuera de rango), devuelve un hue entero 0..120 (`0`=rojo, `60`=amarillo, `120`=verde). Fórmula `hue = round(clamp(stamina,0,100) * 1.2)`.

- [ ] **Step 1: Write the failing test**

```ts
// habitat/client/src/sprites.test.ts — agregar al final, dentro del archivo
import { staminaHue } from './sprites'

describe('staminaHue', () => {
  it('mapea 0/50/100 a rojo/amarillo/verde', () => {
    expect(staminaHue(0)).toBe(0)
    expect(staminaHue(50)).toBe(60)
    expect(staminaHue(100)).toBe(120)
  })
  it('clampa fuera de rango', () => {
    expect(staminaHue(-10)).toBe(0)
    expect(staminaHue(150)).toBe(120)
  })
  it('redondea a entero', () => {
    expect(staminaHue(33)).toBe(40) // 33 * 1.2 = 39.6 -> 40
  })
})
```

(Si `sprites.test.ts` no usa aún `describe/it/expect` importados, agregá el
import correspondiente arriba; si ya los importa, reusá ese import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/client && npm run test -- sprites`
Expected: FAIL — `staminaHue is not a function` / import no resuelto.

- [ ] **Step 3: Write minimal implementation**

```ts
// habitat/client/src/sprites.ts — agregar
// Hue HSL para la pelotita de stamina: gradiente continuo rojo->amarillo->verde.
// 0%=hue 0 (rojo), 50%=hue 60 (amarillo), 100%=hue 120 (verde).
export function staminaHue(stamina: number): number {
  const s = Math.max(0, Math.min(100, stamina))
  return Math.round(s * 1.2)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/client && npm run test -- sprites`
Expected: PASS (incluye los 3 casos nuevos).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/sprites.ts habitat/client/src/sprites.test.ts
git commit -m "feat(habitat): helper staminaHue para gradiente continuo de stamina

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Render compacto del pod + pelotita de stamina

`SessionPod.vue` muestra una fila chica (avatar | nombre+proyecto | pelotita) cuando `compact` está activo, ocultando `MiniArena`, `.action` y `.since`. Estilos en `style.css`.

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`
- Modify: `habitat/client/src/style.css` (bloque nuevo `.pod.compact`, `.stam-dot`, `.stam-pct`, `.pod .face-mini`)

**Interfaces:**
- Consumes: `useCompactPods(): { compact }` (Task 1); `staminaHue(n)` y `faceFor(name, char)` de `sprites.ts` (Task 2 + existente).
- Produces: clase CSS `.pod.compact` y elementos `.face-mini`, `.stam-dot`, `.stam-pct` (consumidos solo acá).

- [ ] **Step 1: Reescribir `SessionPod.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { useCompactPods } from '../composables/useCompactPods'
import { STATUS_LABEL, type Session } from '../types'
import { ago, faceFor, staminaHue } from '../sprites'
import MiniArena from './MiniArena.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { colorForProject } = useProjects()
const { compact } = useCompactPods()
const selected = computed(() => store.selectedId === props.session.id)
const tint = computed(() => {
  const c = colorForProject(props.session.project)
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const stamStyle = computed(() => {
  const h = staminaHue(stam.value)
  return { background: `hsl(${h} 70% 45%)`, boxShadow: `0 0 6px hsl(${h} 70% 45% / .7)` }
})

function select() {
  store.select(props.session.id)
}
</script>

<template>
  <div
    class="pod"
    :class="[session.status, { selected, compact }]"
    :style="tint"
    tabindex="0"
    role="button"
    :aria-pressed="selected"
    @click="select"
    @keydown.enter="select"
  >
    <div class="ring"></div>

    <template v-if="compact">
      <img class="face-mini" :src="faceFor(session.name, session.char)" alt="" />
      <div class="meta">
        <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      </div>
      <div class="stam">
        <span class="stam-dot" :style="stamStyle" :title="'STAMINA ' + Math.round(stam) + '%'"></span>
        <span class="stam-pct">{{ Math.round(stam) }}%</span>
      </div>
    </template>

    <template v-else>
      <MiniArena :session="session" :height="56" />
      <div class="meta">
        <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
        <div class="action">{{ session.action }}</div>
        <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Agregar estilos en `style.css`**

Insertá este bloque justo después de las reglas de `.since` (cerca de la línea 100, dentro del mismo scope global donde están `.pod`/`.meta`):

```css
  /* --- Pod compacto (modo tablet) --- */
  .pod.compact{display:flex; align-items:center; gap:10px; padding:8px 10px}
  .pod.compact .face-mini{flex:0 0 auto; width:36px; height:36px; image-rendering:pixelated;
    border:2px solid var(--line); box-shadow:var(--bevel); background:#160e07}
  .pod.compact .meta{margin-top:0; flex:1; min-width:0}
  .pod.compact .name{font-size:13px}
  .pod.compact .repo{margin-top:2px; font-size:12px}
  .pod.compact .stam{flex:0 0 auto; display:flex; align-items:center; gap:5px}
  .stam-dot{display:inline-block; width:13px; height:13px; border-radius:50%;
    border:1px solid rgba(0,0,0,.4); transition:background .4s linear, box-shadow .4s linear}
  .stam-pct{font-family:var(--f-ui); font-size:10px; line-height:1; color:#d8c39a; text-shadow:1px 1px 0 #000}
```

- [ ] **Step 3: Typecheck y tests (sin regresiones)**

Run: `cd habitat/client && npm run typecheck && npm run test`
Expected: typecheck sin errores; todos los tests previos siguen en PASS.

- [ ] **Step 4: Verificación manual**

Run: `cd habitat/client && npm run dev` (o el flujo de `/run` del proyecto).
Expected: sin el toggle aún visible no se puede activar; verificá temporalmente seteando en la consola del browser `localStorage.setItem('habitat.compactPods','1')` y recargando — los pods se ven como fila chica con avatar + nombre + proyecto + pelotita; el color de la pelotita varía con la stamina. Volvé a `'0'` para el modo normal. (El botón llega en Task 5.)

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue habitat/client/src/style.css
git commit -m "feat(habitat): render compacto del pod con avatar y pelotita de stamina

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rail más angosto en landscape compacto

`HabitatLayout.vue` usa un ancho de rail propio (más angosto, mín 180) cuando `compact` está activo, persistido aparte para no pisar el ancho normal. El resize sigue activo y clampa según el modo.

**Files:**
- Modify: `habitat/client/src/components/HabitatLayout.vue`

**Interfaces:**
- Consumes: `useCompactPods(): { compact }` (Task 1).
- Produces: nada nuevo para otras tasks. Clave nueva de persistencia: `'habitat.railWidthCompact'`.

- [ ] **Step 1: Modificar el `<script setup>` de `HabitatLayout.vue`**

Reemplazá el bloque de ancho del rail (las constantes `RAIL_MIN/RAIL_MAX`, el `railW` y `startResize`, actualmente líneas ~13-30) por:

```ts
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useViewport } from '../composables/useViewport'
import { useCompactPods } from '../composables/useCompactPods'
import SessionRail from './SessionRail.vue'
import DetailPanel from './DetailPanel.vue'

const store = useSessions()
const { isNarrow } = useViewport()
const { compact } = useCompactPods()
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)

// Ancho del rail (px), persistido. En modo compacto usamos una clave y un
// mínimo más chicos (tablet landscape) sin pisar el ancho del modo normal.
const NORMAL = { key: 'habitat.railWidth', min: 280, max: 640, def: 340 }
const COMPACT = { key: 'habitat.railWidthCompact', min: 180, max: 360, def: 210 }
const cfg = computed(() => (compact.value ? COMPACT : NORMAL))

function loadW(c: { key: string; min: number; max: number; def: number }) {
  return Math.min(c.max, Math.max(c.min, Number(localStorage.getItem(c.key)) || c.def))
}
const railWNormal = ref(loadW(NORMAL))
const railWCompact = ref(loadW(COMPACT))
const railW = computed(() => (compact.value ? railWCompact.value : railWNormal.value))

function startResize(e: MouseEvent) {
  e.preventDefault()
  const c = cfg.value
  const target = compact.value ? railWCompact : railWNormal
  const onMove = (m: MouseEvent) => {
    target.value = Math.min(c.max, Math.max(c.min, m.clientX))
    panel.value?.fit()
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem(c.key, String(target.value))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
```

Y agregá un `watch` para reajustar el panel cuando cambia el modo (junto a los otros `watch`, después de `watch(isNarrow, refit)`):

```ts
watch(compact, refit)
```

El `<template>` no cambia: ya usa `:style="{ '--rail-w': railW + 'px' }"`, y ahora `railW` es un `computed`.

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Verificación manual**

Run: `cd habitat/client && npm run dev`
Expected: en landscape (≥900px), con `habitat.compactPods='1'` y recarga, la columna de sesiones aparece más angosta (~210px) y se puede arrastrar el divisor hasta un mínimo de ~180px; el ancho compacto persiste tras recargar y no altera el ancho del modo normal al volver a `'0'`.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/HabitatLayout.vue
git commit -m "feat(habitat): rail mas angosto y persistido en landscape compacto

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Menú hamburguesa flotante (`AppMenu.vue`)

Componente con botón ☰ flotante (arriba-izq) que abre un drawer con: brand, switch de vista, toggle Compacto, `+ Nueva sesión` (SpawnMenu embebido) y Salir. Cierra con click-fuera, Escape o al elegir vista.

**Files:**
- Create: `habitat/client/src/components/AppMenu.vue`
- Modify: `habitat/client/src/style.css` (reglas `.hamburger`, `.app-menu`)

**Interfaces:**
- Consumes: `useCompactPods()` (Task 1), `useAuth()` (existente; `logout`), `SpawnMenu.vue` (existente).
- Produces: componente `<AppMenu v-model:view="...">` con prop `view: 'sessions' | 'settings'` y emit `update:view`. Consumido por `App.vue` (Task 6).

- [ ] **Step 1: Crear `AppMenu.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useCompactPods } from '../composables/useCompactPods'
import SpawnMenu from './SpawnMenu.vue'

type View = 'sessions' | 'settings'
defineProps<{ view: View }>()
const emit = defineEmits<{ 'update:view': [v: View] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const { logout } = useAuth()
const { compact, toggleCompact } = useCompactPods()

function pickView(v: View) { emit('update:view', v); open.value = false }
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false }
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app-menu-root" ref="root">
    <button class="hamburger ctl" @click="open = !open" :aria-expanded="open" aria-label="Menú">☰</button>
    <div class="app-menu" v-if="open">
      <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
      <button class="ctl" :class="{ active: view === 'sessions' }" @click="pickView('sessions')">Sesiones</button>
      <button class="ctl" :class="{ active: view === 'settings' }" @click="pickView('settings')">⚙ Settings</button>
      <button class="ctl" :class="{ active: compact }" @click="toggleCompact" title="Pods compactos">▭ Compacto</button>
      <SpawnMenu />
      <button class="ctl" @click="logout">Salir</button>
    </div>
  </div>
</template>

<style scoped>
.app-menu .ctl.active { background: var(--gold); color: #2a1c0a; }
.app-menu .brand { margin-bottom: 4px; }
</style>
```

- [ ] **Step 2: Estilos del overlay en `style.css`**

Agregá (cerca de las reglas `.spawn`, ~línea 138):

```css
  /* --- Menú hamburguesa flotante --- */
  .app-menu-root{position:fixed; top:12px; left:12px; z-index:30}
  .hamburger{font-size:16px; line-height:1; padding:8px 10px}
  .app-menu{position:absolute; top:calc(100% + 8px); left:0; min-width:200px;
    display:flex; flex-direction:column; gap:8px; padding:12px;
    background:linear-gradient(180deg,#2c2012,#190f07); border:2px solid var(--line);
    box-shadow:var(--bevel), 6px 6px 0 #0b0703, var(--glow-gold)}
  .app-menu > .ctl{text-align:left}
```

Nota: el `<SpawnMenu>` mantiene su propio popover (`.spawn-menu` es `position:absolute; right:0`); dentro del drawer se despliega anclado a su botón sin cambios de lógica.

- [ ] **Step 3: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores. (El componente aún no se renderiza hasta Task 6.)

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/AppMenu.vue habitat/client/src/style.css
git commit -m "feat(habitat): AppMenu hamburguesa flotante con controles del header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Quitar header en `App.vue` + stats flotantes

`App.vue` elimina el `<header>` y monta `<AppMenu>` + un badge de stats flotante. Se borran las reglas CSS del header que ya no se usan (`header`, `.count`). Se mantienen `.brand`/`.dot` (reusadas por el drawer) y el `<footer>`.

**Files:**
- Modify: `habitat/client/src/App.vue`
- Modify: `habitat/client/src/style.css` (borrar reglas de `header` y `.count`; agregar `.stats-hud`)

**Interfaces:**
- Consumes: `<AppMenu v-model:view>` (Task 5); store `useSessions()` (`list`, `needCount`) existente.
- Produces: nada para tasks posteriores (última task).

- [ ] **Step 1: Reescribir el `<template>` de `App.vue`**

Reemplazá el `<header>...</header>` completo por `<AppMenu>` y el badge flotante; importá `AppMenu` y quitá imports que queden sin uso (`SpawnMenu` ya no se usa en `App.vue` porque vive en `AppMenu`). El bloque queda así:

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import { useTabAlert } from './composables/useTabAlert'
import { useAuth } from './composables/useAuth'
import HabitatLayout from './components/HabitatLayout.vue'
import AppMenu from './components/AppMenu.vue'
import SettingsView from './components/SettingsView.vue'
import LoginView from './components/LoginView.vue'

const store = useSessions()
const view = ref<'sessions' | 'settings'>('sessions')
const { authed, checkAuth } = useAuth()

onMounted(checkAuth)
watch(authed, (v) => { if (v === true) startSocket() })
useTabAlert()
</script>

<template>
  <LoginView v-if="authed === false" />
  <template v-else-if="authed === true">
    <AppMenu v-model:view="view" />
    <div class="stats-hud">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <HabitatLayout v-if="view === 'sessions'" />
    <SettingsView v-else />
    <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
  </template>
</template>

<style scoped>
</style>
```

(El `<style scoped>` queda vacío porque `.views` ya no existe; podés borrar el bloque `<style scoped>` entero si preferís.)

- [ ] **Step 2: Limpiar y agregar CSS en `style.css`**

Borrá las reglas del header que quedaron huérfanas — la regla `header{...}` (líneas ~38-42) y `.count{...}` + `.count b/.count .need` (líneas ~48-49). **Conservá** `.brand`, `.brand b`, `.brand .dot`, `.brand small` (las usa el drawer). Agregá el badge flotante:

```css
  /* --- Stats flotantes (HUD) --- */
  .stats-hud{position:fixed; top:12px; right:12px; z-index:30; display:flex; gap:14px; align-items:center;
    font-family:var(--f-ui); font-size:12px; color:var(--dim);
    padding:7px 11px; background:linear-gradient(180deg,#2c2012,#190f07);
    border:2px solid var(--line); box-shadow:var(--bevel), 4px 4px 0 #0b0703}
  .stats-hud b{color:var(--ink)}
  .stats-hud .need{color:var(--coral)}
```

- [ ] **Step 3: Typecheck + tests + build**

Run: `cd habitat/client && npm run typecheck && npm run test && npm run build`
Expected: typecheck sin errores; todos los tests en PASS; build OK (sale a `../web`).

- [ ] **Step 4: Verificación manual (tablet landscape y portrait)**

Run: `cd habitat/client && npm run dev`
Expected:
- No hay header; el ☰ flotante arriba-izquierda abre el drawer con Sesiones/Settings, ▭ Compacto, + Nueva sesión y Salir; cierra con click-fuera y Escape.
- El badge de stats flotante arriba-derecha muestra `N SESIONES` y `M TE NECESITAN` (coral) y se actualiza.
- ▭ Compacto achica todos los pods (avatar + nombre + proyecto + pelotita) y en landscape angosta el rail; la preferencia persiste al recargar.
- Cambiar de vista a Settings y volver funciona; Salir desloguea.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/App.vue habitat/client/src/style.css
git commit -m "feat(habitat): quita header; controles en hamburguesa y stats flotantes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de cierre (al terminar todas las tasks)

Seguir el flujo Git obligatorio del repo (CLAUDE.md): antes de cerrar, `git fetch origin && git merge origin/main`, resolver conflictos, verificar typecheck/test/build, push y PR contra `main`.
