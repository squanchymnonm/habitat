# Maná de sesión (uso de Claude) + ciclo día/noche — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar el uso de la ventana de límite de Claude (5h) como "maná" + tiempo a renovación con indicador ☀️/🌙 continuo y un ciclo día/noche global del fondo.

**Architecture:** El statusline ya postea su JSON a `POST /status` (server Node). Se extrae `rate_limits.five_hour` a un estado global en memoria, se difunde por WS (`{type:'usage'}`) y se incluye en el snapshot inicial. El cliente Vue 3 lo consume en un composable singleton, deriva maná/cuenta regresiva/posición del ciclo, y lo renderiza en el chrome flotante + una capa de fondo día/noche.

**Tech Stack:** Node (server, `node --test`), Vue 3 + TS + Pinia + Vite (cliente, Vitest).

## Global Constraints

- Server en `habitat/server`; tests con `node --test <archivo>`. Cliente en `habitat/client`; tests `npm run test`, typecheck `npm run typecheck`, build `npm run build`.
- El dato de uso es **de cuenta** (global), no por sesión: estado único en la store, **en memoria** (no se persiste; el persist serializa solo el array de sesiones). Se repuebla con el próximo statusline.
- Solo disponible en planes Pro/Max y tras la 1ª respuesta → todo el flujo maneja `null` sin romper; si no hay dato, la UI de uso no se muestra y el ciclo queda neutro.
- `resets_at` viene en **segundos** epoch. Ventana = 5h = `18_000_000` ms.
- Maná = `100 − used_percentage` (azul sólido `#3FA8FF`, sin virar a rojo). Emotes Ninja: `assets/emote/21.png` desde 75% consumido, `assets/emote/22.png` desde 90%.
- `cyclePos` 0..1: 0 = recién renovado (amanecer), 1 = por renovar (noche).
- Nombres exactos del payload (`rate_limits.five_hour.used_percentage`/`resets_at`) verificados por doc; parseo **defensivo** (ausencia → `null`).
- Composables con estado compartido = singleton a nivel de módulo (patrón `useAuth.ts`). Componentes en `<script setup lang="ts">`.
- Respetar `@media (prefers-reduced-motion: reduce)` (ya existe en `style.css`).
- Commits terminan con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `usageFromStatus` (server, pura)

**Files:**
- Modify: `habitat/server/hooks-logic.js`
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `usageFromStatus(body) → { pct: number, resetAt: number } | null` (pct clampeado 0..100; resetAt en segundos epoch).

- [ ] **Step 1: Escribir el test que falla** (agregar al final de `hooks-logic.test.js`; reusar los `import { test } from 'node:test'` / `assert` ya presentes en el archivo, y agregar `usageFromStatus` al import existente desde `./hooks-logic.js`)

```js
test('usageFromStatus extrae five_hour y clampea pct', () => {
  const u = usageFromStatus({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } } });
  assert.deepEqual(u, { pct: 23.5, resetAt: 1738425600 });
});
test('usageFromStatus devuelve null sin rate_limits', () => {
  assert.equal(usageFromStatus({}), null);
  assert.equal(usageFromStatus({ rate_limits: {} }), null);
});
test('usageFromStatus null si campos no numéricos; clampea >100', () => {
  assert.equal(usageFromStatus({ rate_limits: { five_hour: { used_percentage: 'x', resets_at: 1 } } }), null);
  assert.equal(usageFromStatus({ rate_limits: { five_hour: { used_percentage: 5 } } }), null);
  assert.deepEqual(usageFromStatus({ rate_limits: { five_hour: { used_percentage: 150, resets_at: 9 } } }), { pct: 100, resetAt: 9 });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd habitat/server && node --test hooks-logic.test.js`
Expected: FAIL — `usageFromStatus is not a function` / import no resuelto.

- [ ] **Step 3: Implementar** (en `hooks-logic.js`, junto a `staminaFromStatus`)

```js
export function usageFromStatus(body) {
  const r = body && body.rate_limits && body.rate_limits.five_hour;
  if (!r) return null;
  const pct = r.used_percentage, resetAt = r.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return null;
  return { pct: Math.max(0, Math.min(100, pct)), resetAt };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd habitat/server && node --test hooks-logic.test.js`
Expected: PASS (incluye los 3 tests nuevos).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): usageFromStatus lee rate_limits.five_hour del statusline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Estado de uso global + broadcast + snapshot (server)

**Files:**
- Modify: `habitat/server/state.js` (createStore: usage en memoria)
- Modify: `habitat/server/index.js` (`POST /status`: broadcast usage)
- Modify: `habitat/server/ws.js` (snapshot incluye usage)
- Test: `habitat/server/state.test.js`

**Interfaces:**
- Consumes: `usageFromStatus` (Task 1).
- Produces: `store.getUsage() → {pct,resetAt}|null` (default null), `store.setUsage(u)`. WS broadcast `{type:'usage', usage}`. Snapshot `{type:'snapshot', sessions, usage}`.

- [ ] **Step 1: Test que falla** (agregar a `state.test.js`; reusar imports de `node:test`/`assert` y `createStore` del archivo)

```js
test('store.getUsage default null; setUsage guarda', () => {
  const s = createStore({});
  assert.equal(s.getUsage(), null);
  s.setUsage({ pct: 40, resetAt: 123 });
  assert.deepEqual(s.getUsage(), { pct: 40, resetAt: 123 });
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `cd habitat/server && node --test state.test.js`
Expected: FAIL — `s.getUsage is not a function`.

- [ ] **Step 3: Implementar usage en `createStore`** (dentro de `createStore`, antes del `return`, agregar `let usage = null;`, y en el objeto devuelto agregar dos métodos)

```js
    getUsage: () => usage,
    setUsage: (u) => { usage = u; },
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `cd habitat/server && node --test state.test.js`
Expected: PASS.

- [ ] **Step 5: Wire en `POST /status` (`index.js`)** — importar `usageFromStatus` junto a `staminaFromStatus` (mismo import desde `./hooks-logic.js`), y dentro del handler `if (s) { ... }`, después del bloque de stamina, agregar:

```js
        const usage = usageFromStatus(body);
        if (usage) {
          store.setUsage(usage);
          hub.broadcast({ type: 'usage', usage });
        }
```

- [ ] **Step 6: Snapshot con usage (`ws.js`)** — en la línea del `ws.send` de snapshot, reemplazar:

```js
    ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot(), usage: store.getUsage() }));
```

- [ ] **Step 7: Verificar que el server arranca y los tests tocados pasan**

Run: `cd habitat/server && node --test state.test.js ws.test.js`
Expected: PASS (los que ya pasaban siguen; `ws.test.js` puede fallar por dep faltante pngjs/ws — si falla por import de dependencia y NO por el cambio, anotarlo y seguir; el cambio de snapshot es aditivo).
Run: `cd habitat/server && node -e "import('./index.js').then(()=>console.log('import ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `import ok` (sin errores de sintaxis).

- [ ] **Step 8: Commit**

```bash
git add habitat/server/state.js habitat/server/index.js habitat/server/ws.js habitat/server/state.test.js
git commit -m "feat(habitat): estado global de uso + broadcast usage + snapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tipos + composable `useUsage` (cliente, TDD)

**Files:**
- Modify: `habitat/client/src/types.ts`
- Create: `habitat/client/src/composables/useUsage.ts`
- Test: `habitat/client/src/composables/useUsage.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface Usage { pct: number; resetAt: number }` (resetAt: segundos epoch).
  - `ServerMessage` variante `{ type: 'usage'; usage: Usage | null }`; `snapshot` con `usage?: Usage | null`.
  - `WINDOW_MS = 18_000_000`.
  - Puras: `manaFromUsage(u): number|null`, `cyclePosFrom(u, nowMs): number|null`, `fmtReset(ms): string`.
  - `setUsage(u: Usage|null): void`.
  - `useUsage(): { usage, mana, msToReset, cyclePos, resetLabel, setUsage }` (refs/computed).

- [ ] **Step 1: Test que falla**

```ts
// habitat/client/src/composables/useUsage.test.ts
import { describe, it, expect } from 'vitest'
import { manaFromUsage, cyclePosFrom, fmtReset, WINDOW_MS, setUsage, useUsage } from './useUsage'

describe('useUsage helpers', () => {
  it('manaFromUsage = 100 - pct, clamp, null', () => {
    expect(manaFromUsage({ pct: 63, resetAt: 0 })).toBe(37)
    expect(manaFromUsage({ pct: 150, resetAt: 0 })).toBe(0)
    expect(manaFromUsage(null)).toBe(null)
  })
  it('cyclePosFrom: 0 recién renovado, 1 por renovar, 0.5 mitad', () => {
    const now = 1_000_000_000_000
    expect(cyclePosFrom(null, now)).toBe(null)
    expect(cyclePosFrom({ pct: 0, resetAt: (now + WINDOW_MS) / 1000 }, now)).toBeCloseTo(0)
    expect(cyclePosFrom({ pct: 0, resetAt: now / 1000 }, now)).toBeCloseTo(1)
    expect(cyclePosFrom({ pct: 0, resetAt: (now + WINDOW_MS / 2) / 1000 }, now)).toBeCloseTo(0.5)
  })
  it('fmtReset formatea', () => {
    expect(fmtReset(2 * 3600000 + 14 * 60000)).toBe('2h 14m')
    expect(fmtReset(14 * 60000)).toBe('14m')
    expect(fmtReset(null)).toBe('')
  })
  it('setUsage actualiza el ref compartido', () => {
    setUsage({ pct: 20, resetAt: 5 })
    expect(useUsage().usage.value).toEqual({ pct: 20, resetAt: 5 })
    setUsage(null)
    expect(useUsage().usage.value).toBe(null)
  })
})
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `cd habitat/client && npm run test -- useUsage`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Tipos en `types.ts`** — agregar la interfaz y extender el union:

```ts
export interface Usage { pct: number; resetAt: number } // resetAt: epoch en segundos
```

Reemplazar la línea del snapshot y agregar la variante usage en `ServerMessage`:

```ts
  | { type: 'snapshot'; sessions: Session[]; usage?: Usage | null }
  | { type: 'usage'; usage: Usage | null }
```

- [ ] **Step 4: Implementar `useUsage.ts`**

```ts
import { ref, computed } from 'vue'
import type { Usage } from '../types'

export const WINDOW_MS = 18_000_000 // 5h

const usage = ref<Usage | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

export function manaFromUsage(u: Usage | null): number | null {
  return u ? Math.max(0, Math.min(100, Math.round(100 - u.pct))) : null
}
export function cyclePosFrom(u: Usage | null, nowMs: number): number | null {
  if (!u) return null
  const left = u.resetAt * 1000 - nowMs
  return Math.max(0, Math.min(1, 1 - left / WINDOW_MS))
}
export function fmtReset(ms: number | null): string {
  if (ms == null) return ''
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function setUsage(u: Usage | null) { usage.value = u }

export function useUsage() {
  if (!timer && typeof setInterval !== 'undefined') {
    timer = setInterval(() => { now.value = Date.now() }, 30_000)
  }
  const mana = computed(() => manaFromUsage(usage.value))
  const msToReset = computed(() => (usage.value ? usage.value.resetAt * 1000 - now.value : null))
  const cyclePos = computed(() => cyclePosFrom(usage.value, now.value))
  const resetLabel = computed(() => fmtReset(msToReset.value))
  return { usage, mana, msToReset, cyclePos, resetLabel, setUsage }
}
```

- [ ] **Step 5: Correr (debe pasar) + typecheck**

Run: `cd habitat/client && npm run test -- useUsage && npm run typecheck`
Expected: PASS; typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useUsage.ts habitat/client/src/composables/useUsage.test.ts
git commit -m "feat(habitat): tipos Usage + composable useUsage (maná, cuenta regresiva, cyclePos)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wiring del WS en el cliente (`useSocket.ts`)

**Files:**
- Modify: `habitat/client/src/composables/useSocket.ts`

**Interfaces:**
- Consumes: `setUsage` (Task 3); mensajes `snapshot` (ahora con `usage`) y `usage`.
- Produces: nada nuevo.

- [ ] **Step 1: Importar `setUsage`** — agregar al tope del archivo:

```ts
import { setUsage } from './useUsage'
```

- [ ] **Step 2: Rutear los mensajes** — en `ws.onmessage`, reemplazar la línea del snapshot y agregar la rama usage:

```ts
    if (msg.type === 'snapshot') { store.setAll(msg.sessions); setUsage(msg.usage ?? null) }
    else if (msg.type === 'usage') setUsage(msg.usage)
```

(El resto de las ramas `else if` quedan igual, a continuación.)

- [ ] **Step 3: Typecheck + tests (sin regresiones)**

Run: `cd habitat/client && npm run typecheck && npm run test`
Expected: typecheck sin errores; todos los tests siguen en PASS.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/composables/useSocket.ts
git commit -m "feat(habitat): useSocket rutea usage (snapshot + mensaje usage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `useDayNight` — helpers puros del ciclo (cliente, TDD)

**Files:**
- Create: `habitat/client/src/composables/useDayNight.ts`
- Test: `habitat/client/src/composables/useDayNight.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `dialPositions(cyclePos: number|null): { sun: number; moon: number }` — translateY en %; `y(q)=120-240q`, `qSun=p`, `qMoon=(p+0.5)%1`; `null`→p=0.
  - `skyGradient(cyclePos: number|null): string` — `''` si null; si no, `linear-gradient(180deg, <top>, <bot>)` interpolado por fase.

- [ ] **Step 1: Test que falla**

```ts
// habitat/client/src/composables/useDayNight.test.ts
import { describe, it, expect } from 'vitest'
import { dialPositions, skyGradient } from './useDayNight'

describe('useDayNight', () => {
  it('dialPositions: sol y luna desfasados medio ciclo', () => {
    expect(dialPositions(0)).toEqual({ sun: 120, moon: 0 })   // sol abajo, luna centro
    expect(dialPositions(0.25)).toEqual({ sun: 60, moon: -60 })
    expect(dialPositions(0.5)).toEqual({ sun: 0, moon: 120 })  // luna reaparece abajo
    expect(dialPositions(null)).toEqual({ sun: 120, moon: 0 })
  })
  it('skyGradient: null vacío; con valor devuelve linear-gradient', () => {
    expect(skyGradient(null)).toBe('')
    expect(skyGradient(0)).toMatch(/^linear-gradient\(180deg, /)
    expect(skyGradient(1)).toMatch(/^linear-gradient\(180deg, /)
  })
})
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `cd habitat/client && npm run test -- useDayNight`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// habitat/client/src/composables/useDayNight.ts
// Helpers puros del ciclo día/noche (mismo modelo que el mock aprobado).

const STOPS = [
  { p: 0.00, top: '#3f2c40', bot: '#62381f' }, // amanecer
  { p: 0.16, top: '#33445c', bot: '#3d3318' }, // día
  { p: 0.52, top: '#384a60', bot: '#42371b' }, // día (media tarde)
  { p: 0.78, top: '#47283b', bot: '#4c2010' }, // atardecer
  { p: 1.00, top: '#131028', bot: '#191020' }, // noche
]
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function hex(h: string) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] }
function mix(h1: string, h2: string, t: number) {
  const a = hex(h1), b = hex(h2)
  return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`
}

export function skyGradient(cyclePos: number | null): string {
  if (cyclePos == null) return ''
  const p = Math.max(0, Math.min(1, cyclePos))
  let i = 0
  while (i < STOPS.length - 1 && p > STOPS[i + 1].p) i++
  const a = STOPS[i], b = STOPS[Math.min(i + 1, STOPS.length - 1)]
  const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p)
  return `linear-gradient(180deg, ${mix(a.top, b.top, t)}, ${mix(a.bot, b.bot, t)})`
}

export function dialPositions(cyclePos: number | null): { sun: number; moon: number } {
  const p = cyclePos ?? 0
  const y = (q: number) => 120 - 240 * q
  return { sun: y(p), moon: y((p + 0.5) % 1) }
}
```

- [ ] **Step 4: Correr (debe pasar) + typecheck**

Run: `cd habitat/client && npm run test -- useDayNight && npm run typecheck`
Expected: PASS; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useDayNight.ts habitat/client/src/composables/useDayNight.test.ts
git commit -m "feat(habitat): useDayNight helpers (skyGradient, dialPositions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `UsageHud.vue` — maná + emotes + dial ☀️/🌙, montado en App.vue

**Files:**
- Create: `habitat/client/src/components/UsageHud.vue`
- Modify: `habitat/client/src/App.vue` (montar `<UsageHud />`)
- Modify: `habitat/client/src/style.css` (estilos del HUD)

**Interfaces:**
- Consumes: `useUsage()` → `{ usage, mana, resetLabel, cyclePos }` (Task 3); `dialPositions` (Task 5).
- Produces: clases `.usage-hud`, `.mana-box`, `.time-box`, `.mana-track/.mana-fill`, `.usage-mote`, `.dn`, `.dn-sun/.dn-moon` (solo en este componente/estilos).

- [ ] **Step 1: Crear `UsageHud.vue`**

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useUsage } from '../composables/useUsage'
import { dialPositions } from '../composables/useDayNight'

const { usage, mana, resetLabel, cyclePos } = useUsage()

const used = computed(() => (usage.value ? usage.value.pct : 0))
const moteSrc = computed(() => {
  if (used.value >= 90) return 'assets/emote/22.png'
  if (used.value >= 75) return 'assets/emote/21.png'
  return ''
})

// Dial ☀️/🌙: aplicar translateY por refs y suprimir la transición en el salto de reaparición.
const sunEl = ref<HTMLElement | null>(null)
const moonEl = ref<HTMLElement | null>(null)
let prevSun = 120, prevMoon = 0
function setY(el: HTMLElement | null, y: number, prev: number) {
  if (!el) return
  el.style.transition = Math.abs(y - prev) > 200 ? 'none' : 'transform .5s ease'
  el.style.transform = `translateY(${y}%)`
}
watch(cyclePos, (p) => {
  const { sun, moon } = dialPositions(p)
  setY(sunEl.value, sun, prevSun); setY(moonEl.value, moon, prevMoon)
  prevSun = sun; prevMoon = moon
}, { immediate: true })
</script>

<template>
  <div class="usage-hud" v-if="usage">
    <div class="mana-box">
      <span class="mana-lbl">Maná</span>
      <span class="mana-track"><i class="mana-fill" :style="{ width: (mana ?? 0) + '%' }"></i></span>
      <img v-if="moteSrc" class="usage-mote" :src="moteSrc" alt="" />
    </div>
    <div class="time-box">
      <span class="dn"><span class="dn-sun" ref="sunEl">☀️</span><span class="dn-moon" ref="moonEl">🌙</span></span>
      <span class="time-lbl">próxima</span>
      <span class="time-val">{{ resetLabel }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Estilos en `style.css`** (agregar cerca de `.stats-hud`)

```css
  /* --- HUD de uso de Claude (maná + tiempo) --- */
  .usage-hud{position:fixed; top:12px; right:12px; z-index:30; display:flex; gap:8px; align-items:stretch}
  .usage-hud .mana-box, .usage-hud .time-box{display:flex; align-items:center; gap:7px; padding:6px 10px;
    background:linear-gradient(180deg,#2c2012,#190f07); border:2px solid var(--line); box-shadow:var(--bevel)}
  .usage-hud .mana-box{position:relative}
  .mana-lbl{font-size:9px; text-transform:uppercase; letter-spacing:.6px; color:#cbedff}
  .mana-track{position:relative; width:74px; height:12px; background:#15100a; border:1px solid var(--line); overflow:hidden}
  .mana-fill{position:absolute; inset:0; background:#3FA8FF; box-shadow:0 0 9px rgba(63,168,255,.85), 0 0 18px rgba(63,168,255,.45);
    transition:width .4s steps(10)}
  .mana-fill::before{content:""; position:absolute; top:0; left:0; right:0; height:2px; background:#9fd6ff}
  .usage-mote{position:absolute; right:6px; top:50%; margin-top:-10px; width:20px; height:20px; image-rendering:pixelated;
    z-index:2; animation:emoteBounce .7s steps(2) infinite}
  .time-lbl{font-size:9px; text-transform:uppercase; letter-spacing:.6px; color:var(--dim)}
  .time-val{font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums}
  .dn{position:relative; width:20px; height:18px; overflow:hidden; flex:0 0 auto}
  .dn span{position:absolute; left:0; right:0; text-align:center; font-size:14px; line-height:18px; transform:translateY(120%)}
```

(`@keyframes emoteBounce` ya existe en `style.css` por la feature de pods compactos. Si no estuviera, agregar: `@keyframes emoteBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`.)

- [ ] **Step 3: Montar en `App.vue`** — leer `App.vue` primero. Importar el componente y renderizarlo dentro del bloque autenticado (junto a `.stats-hud`). En `<script setup>` agregar:

```ts
import UsageHud from './components/UsageHud.vue'
```

Y en el `<template>`, dentro de `<template v-else-if="authed === true">`, agregar la línea (p. ej. justo después del `<div class="stats-hud">…</div>`):

```vue
    <UsageHud />
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `cd habitat/client && npm run typecheck && npm run test && npm run build`
Expected: typecheck sin errores; tests en PASS; build OK.

- [ ] **Step 5: Verificación manual**

Run: `cd habitat/client && npm run dev`
Expected: con datos de uso (o simulando en consola `__setUsage`/recibiendo un `{type:'usage'}`), arriba-derecha aparece el recuadro de **Maná** (azul, drena con el consumo) y el recuadro de **tiempo** con ☀️/🌙 y "próxima Xh YYm", ambos del mismo alto. Subiendo el consumo a ≥75% aparece el emote #21 y ≥90% el #22, sin agrandar la card. Sin datos de uso, no se muestra nada. (La animación viva del dial se valida en Task 7 con el ciclo real; acá alcanza con que renderice.)

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/UsageHud.vue habitat/client/src/App.vue habitat/client/src/style.css
git commit -m "feat(habitat): UsageHud (maná + emotes 21/22 + dial sol/luna) en el chrome flotante

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Ciclo día/noche global del fondo (capa en App.vue)

**Files:**
- Modify: `habitat/client/src/App.vue` (capa `.sky-ambient` + bind del gradiente)
- Modify: `habitat/client/src/style.css` (estilos de la capa)

**Interfaces:**
- Consumes: `useUsage().cyclePos` (Task 3), `skyGradient` (Task 5).
- Produces: capa de fondo global.

- [ ] **Step 1: `App.vue` — computar el gradiente** — en `<script setup>` agregar:

```ts
import { computed } from 'vue'
import { useUsage } from './composables/useUsage'
import { skyGradient } from './composables/useDayNight'

const { cyclePos } = useUsage()
const skyBg = computed(() => skyGradient(cyclePos.value))
```

(Si `computed`/`useUsage` ya están importados por Task 6, no duplicar imports.)

- [ ] **Step 2: `App.vue` — capa de fondo** — como **primer** hijo dentro de `<template v-else-if="authed === true">`, agregar:

```vue
    <div class="sky-ambient" :style="skyBg ? { background: skyBg } : {}" aria-hidden="true"></div>
```

- [ ] **Step 3: Estilos en `style.css`**

```css
  /* --- Ciclo día/noche global (capa de fondo; detrás del contenido) --- */
  .sky-ambient{position:fixed; inset:0; z-index:-1; pointer-events:none; opacity:.85; transition:background .6s linear}
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `cd habitat/client && npm run typecheck && npm run test && npm run build`
Expected: typecheck sin errores; tests en PASS; build OK.

- [ ] **Step 5: Verificación manual (clave: z-index)**

Run: `cd habitat/client && npm run dev`
Expected: con datos de uso, el fondo de la app vira amanecer→día→atardecer→noche según `cyclePos`, **sin tapar** pods, HUD ni texto (verificar que la capa quede detrás: si algo queda cubierto, dar `position:relative; z-index:1` al contenedor afectado — p. ej. `.hlayout` — en `style.css`, y anotarlo). Sin datos de uso (`skyBg` vacío) el fondo queda como siempre. El dial ☀️/🌙 ahora se mueve con el tiempo (uno entra mientras el otro se va). Con `prefers-reduced-motion`, sin transiciones.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/App.vue habitat/client/src/style.css
git commit -m "feat(habitat): ciclo día/noche global del fondo segun la ventana de Claude

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de cierre (al terminar todas las tasks)

Flujo Git del repo (CLAUDE.md): antes de cerrar, `git fetch origin && git merge origin/main`, resolver conflictos, verificar typecheck/test/build (cliente) y `node --test` de los módulos del server tocados, push y PR contra `main`.

**Pendiente de verificación real (no bloquea el plan):** confirmar los nombres exactos del payload del statusline (`rate_limits.five_hour.used_percentage` / `resets_at`) con un statusline real de un plan Pro/Max; el parseo es defensivo, así que si los nombres difirieran solo habría que ajustar `usageFromStatus` (Task 1).
