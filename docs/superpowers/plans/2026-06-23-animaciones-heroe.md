# Animar al héroe según el estado de la sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cablear las animaciones (`anim_idle`/`walk`/`jump`/`item`/`dead`) del héroe a los estados de la sesión, para que el panel comunique qué hace cada agente.

**Architecture:** Enfoque declarativo. Funciones puras en `sprites.ts` (selección de sprite + máquina de precedencia de pose, con tests vitest); `MiniArena.vue` calcula la pose y la bindea al `<Sprite>`. `Sprite.vue` ya soporta `static`/`grid`/`strip` — no se toca. Se borra el scaffolding muerto `heroAnim`/`STATUS_ANIM`.

**Tech Stack:** Vue 3 (`<script setup>` + Composition API), TypeScript, Vite, Pinia, vitest.

## Global Constraints

- **Solo cliente.** No tocar `habitat/server`; el `status` ya llega por WS.
- **Borrar el scaffolding muerto** `STATUS_ANIM` + `heroAnim` de `sprites.ts` (no se importa en ningún lado). `heroIdle` y `faceFor` se mantienen.
- **El héroe se renderiza en `MiniArena.vue`**, no en `SessionPod.vue` (que ya no dibuja héroe).
- **No romper efectos existentes:** emote por estado, flinch en `error`, números de daño flotante. El overlay de loot vive en `DetailPanel.vue` y no se toca.
- **Verificación:** `npm test` (vitest), `npm run typecheck`, `npm run build`, todo desde `habitat/client/`.
- **Comandos desde `habitat/client/`.** Mensajes de commit terminan con la línea:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Sistema de poses en `sprites.ts` + tests (vitest)

**Files:**
- Modify: `habitat/client/src/sprites.ts` (borrar `STATUS_ANIM`/`heroAnim`; añadir `Pose`/`PoseRender`/`POSE_RENDER`/`heroSprite`/`HeroPoseInput`/`heroPoseFor`)
- Create: `habitat/client/src/sprites.test.ts`

**Interfaces:**
- Consumes: `Status` desde `./types`; `resolveChar` (ya existe en el archivo).
- Produces:
  - `type Pose = 'rest' | 'walk' | 'jump' | 'item' | 'dead' | 'combat'`
  - `interface PoseRender { file: string; mode: 'static' | 'grid' | 'strip'; frame?: number; duration?: number }`
  - `const POSE_RENDER: Record<Pose, PoseRender>`
  - `heroSprite(name: string, char: string | undefined, pose: Pose): string`
  - `interface HeroPoseInput { status: Status; inCombat: boolean; jabbing: boolean; celebrating: boolean }`
  - `heroPoseFor(s: HeroPoseInput): Pose`

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/sprites.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { heroPoseFor, heroSprite, POSE_RENDER } from './sprites'
import type { Status } from './types'

const base = { status: 'idle' as Status, inCombat: false, jabbing: false, celebrating: false }

describe('heroPoseFor', () => {
  it('celebrating gana sobre todo', () => {
    expect(heroPoseFor({ ...base, celebrating: true, status: 'offline', inCombat: true })).toBe('jump')
  })
  it('offline -> dead (incluso en combate)', () => {
    expect(heroPoseFor({ ...base, status: 'offline', inCombat: true })).toBe('dead')
  })
  it('combate sin jab -> combat', () => {
    expect(heroPoseFor({ ...base, status: 'working', inCombat: true })).toBe('combat')
  })
  it('combate con jab -> item', () => {
    expect(heroPoseFor({ ...base, status: 'working', inCombat: true, jabbing: true })).toBe('item')
  })
  it('working -> walk', () => {
    expect(heroPoseFor({ ...base, status: 'working' })).toBe('walk')
  })
  it('done -> jump', () => {
    expect(heroPoseFor({ ...base, status: 'done' })).toBe('jump')
  })
  it('idle/waiting/error -> rest', () => {
    expect(heroPoseFor({ ...base, status: 'idle' })).toBe('rest')
    expect(heroPoseFor({ ...base, status: 'waiting' })).toBe('rest')
    expect(heroPoseFor({ ...base, status: 'error' })).toBe('rest')
  })
})

describe('heroSprite', () => {
  it('mapea pose -> archivo correcto', () => {
    expect(heroSprite('Ann', 'NinjaBlue', 'rest')).toBe('assets/char/NinjaBlue/anim_idle.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'combat')).toBe('assets/char/NinjaBlue/idle.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'walk')).toBe('assets/char/NinjaBlue/walk.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'dead')).toBe('assets/char/NinjaBlue/dead.png')
  })
})

describe('POSE_RENDER', () => {
  it('rest=strip, walk=grid, combat=static frame 3', () => {
    expect(POSE_RENDER.rest.mode).toBe('strip')
    expect(POSE_RENDER.walk.mode).toBe('grid')
    expect(POSE_RENDER.combat.mode).toBe('static')
    expect(POSE_RENDER.combat.frame).toBe(3)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run (desde `habitat/client/`): `npm test`
Expected: FAIL — `heroPoseFor`, `heroSprite`, `POSE_RENDER` no existen (los tests del store siguen pasando).

- [ ] **Step 3: Borrar el scaffolding muerto en `sprites.ts`**

Eliminar este bloque completo (actualmente ~líneas 35-46):

```ts
export const STATUS_ANIM: Record<Status, string> = {
  idle: 'anim_idle',
  working: 'anim_idle',
  waiting: 'anim_idle',
  done: 'anim_idle',
  error: 'anim_idle',
  offline: 'anim_idle',
}

export function heroAnim(name: string, char: string | undefined, status: Status): string {
  return `assets/char/${resolveChar(name, char)}/${STATUS_ANIM[status]}.png`
}
```

- [ ] **Step 4: Añadir el sistema de poses en `sprites.ts`**

En el lugar donde estaba el bloque borrado (después de `heroIdle`/`faceFor`), agregar:

```ts
export type Pose = 'rest' | 'walk' | 'jump' | 'item' | 'dead' | 'combat'

export interface PoseRender {
  file: string
  mode: 'static' | 'grid' | 'strip'
  frame?: number
  duration?: number
}

// Cómo renderiza cada pose en <Sprite>. file = nombre del .png en assets/char/<char>/.
export const POSE_RENDER: Record<Pose, PoseRender> = {
  rest: { file: 'anim_idle', mode: 'strip', duration: 1600 },
  walk: { file: 'walk', mode: 'grid', duration: 600 },
  jump: { file: 'jump', mode: 'static', frame: 0 },
  item: { file: 'item', mode: 'static', frame: 0 },
  dead: { file: 'dead', mode: 'static', frame: 0 },
  combat: { file: 'idle', mode: 'static', frame: 3 },
}

export function heroSprite(name: string, char: string | undefined, pose: Pose): string {
  return `assets/char/${resolveChar(name, char)}/${POSE_RENDER[pose].file}.png`
}

export interface HeroPoseInput {
  status: Status
  inCombat: boolean
  jabbing: boolean
  celebrating: boolean
}

// Precedencia estado+combate -> pose. Pura y testeable.
export function heroPoseFor(s: HeroPoseInput): Pose {
  if (s.celebrating) return 'jump'
  if (s.status === 'offline') return 'dead'
  if (s.inCombat) return s.jabbing ? 'item' : 'combat'
  if (s.status === 'working') return 'walk'
  if (s.status === 'done') return 'jump'
  return 'rest'
}
```

(El `import type { Status } from './types'` ya está al tope del archivo — sigue usándose por `HeroPoseInput`.)

- [ ] **Step 5: Correr el test y verificar que pasa**

Run (desde `habitat/client/`): `npm test`
Expected: PASS — todos los `describe` nuevos en verde, más los tests del store.

- [ ] **Step 6: Typecheck**

Run (desde `habitat/client/`): `npm run typecheck`
Expected: PASS sin errores.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src/sprites.ts habitat/client/src/sprites.test.ts
git commit -m "feat(habitat): sistema de poses del héroe (heroSprite/heroPoseFor) + tests

Reemplaza el scaffolding muerto heroAnim/STATUS_ANIM.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Cablear la pose en `MiniArena.vue`

**Files:**
- Modify: `habitat/client/src/components/MiniArena.vue`

**Interfaces:**
- Consumes: `heroSprite`, `heroPoseFor`, `POSE_RENDER` de `../sprites` (Task 1); `useSessions` de `../stores/sessions` (`store.lastFight: { id, result, seq } | null`).
- Produces: nada (consumidor final).

- [ ] **Step 1: Actualizar imports**

Línea 4 actual:

```ts
import { heroIdle, monsterSprite, bossSprite, fmt } from '../sprites'
```

Reemplazar por:

```ts
import { heroSprite, heroPoseFor, POSE_RENDER, monsterSprite, bossSprite, fmt } from '../sprites'
```

Y añadir, junto a los otros imports (después de la línea 5 `import Sprite from './Sprite.vue'`):

```ts
import { useSessions } from '../stores/sessions'
```

- [ ] **Step 2: Instanciar el store y los refs transitorios**

Después de `const props = withDefaults(...)` (línea 7), agregar:

```ts
const store = useSessions()
// poses transitorias: jab en cada golpe; saltito al ganar
const jabbing = ref(false)
const celebrating = ref(false)
```

(`ref`, `computed`, `watch` ya están importados en la línea 2.)

- [ ] **Step 3: Disparar `jabbing` en el watch existente de `combat.tokens`**

En el watcher de `combat.tokens` (líneas ~28-39), dentro del `if (tok > lastTokens && dmg) { ... }`, después del `setTimeout` del float, agregar:

```ts
      jabbing.value = true
      setTimeout(() => (jabbing.value = false), 180)
```

El bloque queda:

```ts
    if (tok > lastTokens && dmg) {
      const key = ++fkey
      floats.value.push({ key, text: fmt(dmg), big: !!monster.value?.isBoss })
      setTimeout(() => (floats.value = floats.value.filter((f) => f.key !== key)), 850)
      jabbing.value = true
      setTimeout(() => (jabbing.value = false), 180)
    }
```

- [ ] **Step 4: Añadir el watch de victoria (`celebrating`)**

Después del watcher de `flinch` (línea ~51), agregar:

```ts
// Saltito de victoria cuando esta sesión vence a su monstruo.
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === props.session.id) {
      celebrating.value = true
      setTimeout(() => (celebrating.value = false), 1200)
    }
  },
)
```

- [ ] **Step 5: Añadir los computed de pose**

Al final del `<script setup>` (después del watch de victoria), agregar:

```ts
// pose final del héroe: precedencia estado+combate (ver sprites.heroPoseFor)
const pose = computed(() =>
  heroPoseFor({
    status: props.session.status,
    inCombat: !!monster.value,
    jabbing: jabbing.value,
    celebrating: celebrating.value,
  }),
)
const render = computed(() => POSE_RENDER[pose.value])
const heroSrc = computed(() => heroSprite(props.session.name, props.session.char, pose.value))
```

- [ ] **Step 6: Reemplazar el `<Sprite>` del héroe en el template**

Bloque actual (líneas ~62-69):

```html
    <Sprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroIdle(session.name, session.char)"
      :height="height"
      mode="static"
      :frame="monster ? 3 : 0"
    />
```

Reemplazar por:

```html
    <Sprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroSrc"
      :height="height"
      :mode="render.mode"
      :frame="render.frame ?? 0"
      :duration="render.duration ?? 900"
    />
```

(`walk` en modo `grid` usa la columna `dir` por defecto 0 = de frente; no hace falta pasar `:dir`. En `static`, `Sprite.vue` clampa `frame` a `[0, frames-1]`: `combat`→frame 3 mira a la derecha; jump/item/dead caen a 0.)

- [ ] **Step 7: Correr tests, typecheck y build**

Run (desde `habitat/client/`):
- `npm test` → PASS (los tests de Task 1 siguen verdes; no se agregaron tests de componente).
- `npm run typecheck` → PASS sin errores.
- `npm run build` → build OK (vue-tsc + vite).

- [ ] **Step 8: Commit**

```bash
git add habitat/client/src/components/MiniArena.vue
git commit -m "feat(habitat): el héroe anima según estado (rest/walk/jump/item/dead/combat)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verificación visual en la app

**Files:** ninguno (verificación manual; sin commit).

**Interfaces:** Consumes el resultado de las Tasks 1-2.

- [ ] **Step 1: Levantar el cliente**

Run (desde `habitat/client/`): `npm run dev` (con el server del Hábitat corriendo para ver sesiones reales).

- [ ] **Step 2: Recorrer el mapeo y confirmar cada fila**

- `idle` / `waiting` → héroe **respira** (anim_idle animado); `waiting` muestra el emote de alerta.
- `working` → **camina** en el lugar (walk).
- `done` → pose de **salto** (jump).
- `offline` → pose de **caído** (dead).
- En **combate** → mira a la derecha (idle frame 3) y **pega con el item** en cada golpe.
- Al **vencer** → **saltito** (~1.2 s) y vuelve al estado normal.
- `error` → sigue el **flinch**.

- [ ] **Step 3: Confirmar que no hay regresiones**

- Sin errores en la consola del navegador.
- Transiciones de animación (strip↔grid↔static) sin sprites colgados ni parpadeos.
- Si alguna animación va muy rápido/lenta, ajustar `duration` en `POSE_RENDER` (`sprites.ts`) y re-verificar; si se cambia, recommit Task 1.
