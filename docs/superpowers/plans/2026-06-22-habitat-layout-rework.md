# Retrabajo de UI del Hábitat (master-detail) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el drawer overlay en un panel de detalle permanente y la grid en una lista de 1 columna, con layout master-detail responsive (adaptativo por orientación + fallback overlay) y refinamiento estético selectivo.

**Architecture:** Nuevo shell `HabitatLayout` que monta siempre `SessionRail` (lista de pods) + una única instancia de `DetailPanel` (cabecera-batalla + terminal). En monitores el detalle es embebido (rail+panel, eje según orientación); bajo ~900px el mismo panel se trata como overlay deslizante. La lógica de combate/sprites se factoriza en `MiniArena`, reusada por pods y por la cabecera del detalle. La selección por defecto se resuelve con un helper puro testeado.

**Tech Stack:** Vue 3 (`<script setup>` + TS), Pinia, Vite, xterm.js + FitAddon, CSS vanilla en `style.css` + estilos scopeados. Tests con Vitest (se introduce en este plan, solo para la lógica pura/del store).

## Global Constraints

- Directorio del cliente: `habitat/client`. Todos los paths son relativos a la raíz del repo `/home/mnonm/proyectos/RPG-Agents`.
- No romper el contrato de `types.ts` ni el protocolo WS (`/ws`, `/term`). `useTerminal`, `useSocket`, `useProjects` se reutilizan **sin cambios funcionales**.
- Mantener identidad pixel-medieval (variables `:root` de `style.css` intactas). Refinar, no reemplazar.
- Breakpoint de fallback overlay: **`max-width: 899px`** (≥900px = monitores). Orientación vía `@media (orientation: portrait|landscape)`.
- Comandos de verificación (no hay otro framework instalado): `cd habitat/client && npm run typecheck` y `npm run build`. Tests nuevos: `cd habitat/client && npm test`.
- Idioma del código/copys: español rioplatense, como el resto del proyecto.
- Commits frecuentes, uno por tarea. Cerrar mensajes de commit con la línea `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Helper puro de selección + setup de Vitest

**Files:**
- Create: `habitat/client/src/stores/pickSelection.ts`
- Create: `habitat/client/src/stores/pickSelection.test.ts`
- Modify: `habitat/client/package.json` (script `test` + devDep `vitest`)

**Interfaces:**
- Produces: `pickSelection(ids: string[], current: string | null): string | null`

- [ ] **Step 1: Instalar Vitest y agregar script**

Run:
```bash
cd habitat/client && npm install -D vitest@^2
```
Luego editar `habitat/client/package.json`, dentro de `"scripts"`, agregar:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: Escribir el test que falla**

Crear `habitat/client/src/stores/pickSelection.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { pickSelection } from './pickSelection'

describe('pickSelection', () => {
  it('mantiene la selección actual si sigue en la lista', () => {
    expect(pickSelection(['a', 'b', 'c'], 'b')).toBe('b')
  })
  it('selecciona el primero cuando no hay selección', () => {
    expect(pickSelection(['a', 'b'], null)).toBe('a')
  })
  it('reselecciona el primero si el actual desapareció', () => {
    expect(pickSelection(['b', 'c'], 'a')).toBe('b')
  })
  it('devuelve null con lista vacía', () => {
    expect(pickSelection([], 'a')).toBe(null)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd habitat/client && npm test`
Expected: FAIL — no puede resolver `./pickSelection` (módulo inexistente).

- [ ] **Step 4: Implementar el helper**

Crear `habitat/client/src/stores/pickSelection.ts`:
```ts
// Decide qué sesión queda seleccionada tras un cambio en la lista.
// Conserva la selección actual si sigue existiendo; si no, cae al primero.
export function pickSelection(ids: string[], current: string | null): string | null {
  if (current && ids.includes(current)) return current
  return ids[0] ?? null
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd habitat/client && npm test`
Expected: PASS — 4 tests verdes.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/package.json habitat/client/package-lock.json habitat/client/src/stores/pickSelection.ts habitat/client/src/stores/pickSelection.test.ts
git commit -m "feat(habitat): helper puro de selección + setup vitest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Auto-selección en el store

**Files:**
- Modify: `habitat/client/src/stores/sessions.ts`
- Create: `habitat/client/src/stores/sessions.test.ts`

**Interfaces:**
- Consumes: `pickSelection(ids, current)` (Task 1)
- Produces: el store `useSessions` reconcilia `selectedId` automáticamente tras `setAll`/`upsert`/`remove` (auto-selecciona el primero; reselecciona si el activo desaparece).

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/stores/sessions.test.ts`:
```ts
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useSessions } from './sessions'
import type { Session } from '../types'

const mk = (id: string): Session => ({
  id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100,
})

describe('sessions store — selección', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('auto-selecciona el primero al recibir el snapshot', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b')])
    expect(s.selectedId).toBe('a')
  })

  it('reselecciona al primero si se elimina el seleccionado', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b')])
    s.select('a')
    s.remove('a')
    expect(s.selectedId).toBe('b')
  })

  it('queda en null si no quedan sesiones', () => {
    const s = useSessions()
    s.setAll([])
    expect(s.selectedId).toBe(null)
  })

  it('al hacer upsert de la primera sesión la selecciona', () => {
    const s = useSessions()
    s.upsert(mk('z'))
    expect(s.selectedId).toBe('z')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat/client && npm test`
Expected: FAIL — `auto-selecciona el primero…` falla (hoy `selectedId` queda en null tras `setAll`).

- [ ] **Step 3: Implementar la reconciliación**

Editar `habitat/client/src/stores/sessions.ts`. Agregar el import arriba (junto a los existentes):
```ts
import { pickSelection } from './pickSelection'
```
Dentro del `defineStore`, agregar la función `reconcile` (después de `function select(...)`):
```ts
  // Mantiene una selección válida: conserva la actual o cae al primero.
  function reconcile() {
    selectedId.value = pickSelection(list.value.map((s) => s.id), selectedId.value)
  }
```
Modificar `setAll`, `upsert` y `remove` para llamar a `reconcile()` al final, y simplificar `remove`:
```ts
  function setAll(sessions: Session[]) {
    list.value = sessions
    reconcile()
  }
  function upsert(s: Session) {
    const i = list.value.findIndex((x) => x.id === s.id)
    if (i === -1) list.value.push(s)
    else list.value[i] = s
    reconcile()
  }
  function remove(id: string) {
    list.value = list.value.filter((s) => s.id !== id)
    reconcile()
  }
```

- [ ] **Step 4: Correr el test y typecheck**

Run: `cd habitat/client && npm test && npm run typecheck`
Expected: PASS (4 tests del store + 4 de Task 1) y typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/stores/sessions.ts habitat/client/src/stores/sessions.test.ts
git commit -m "feat(habitat): auto-selección del primer pod en el store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Composable `useViewport`

**Files:**
- Create: `habitat/client/src/composables/useViewport.ts`

**Interfaces:**
- Produces: `useViewport(): { isNarrow: Ref<boolean> }` — `true` bajo 900px.

- [ ] **Step 1: Implementar el composable**

Crear `habitat/client/src/composables/useViewport.ts`:
```ts
import { ref, onMounted, onUnmounted } from 'vue'

// `isNarrow` = true bajo ~900px. Ahí el detalle pasa a overlay en vez de embebido.
export function useViewport(query = '(max-width: 899px)') {
  const isNarrow = ref(false)
  let mq: MediaQueryList | null = null
  const update = () => { if (mq) isNarrow.value = mq.matches }
  onMounted(() => {
    mq = window.matchMedia(query)
    update()
    mq.addEventListener('change', update)
  })
  onUnmounted(() => mq?.removeEventListener('change', update))
  return { isNarrow }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/composables/useViewport.ts
git commit -m "feat(habitat): composable useViewport (isNarrow <900px)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Componente `MiniArena`

Extrae la lógica de sprites/combate (héroe + monstruo + emote + stamina + daño flotante) a un componente reutilizable por el pod compacto y por la cabecera del detalle. **No** incluye el overlay grande de "VENCIDO" (ese queda solo en el detalle, Task 7).

**Files:**
- Create: `habitat/client/src/components/MiniArena.vue`

**Interfaces:**
- Consumes: `Sprite.vue`, `StaminaOrb.vue`, `heroIdle/monsterSprite/bossSprite/fmt` de `../sprites`.
- Produces: `<MiniArena :session="Session" :height="number" />` (default height 56).

- [ ] **Step 1: Crear el componente**

Crear `habitat/client/src/components/MiniArena.vue`:
```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Session, Status } from '../types'
import { heroIdle, monsterSprite, bossSprite, fmt } from '../sprites'
import Sprite from './Sprite.vue'
import StaminaOrb from './StaminaOrb.vue'

const props = withDefaults(defineProps<{ session: Session; height?: number }>(), { height: 56 })

// Emote (globo) que comunica el estado del personaje.
const EMOTE: Partial<Record<Status, number>> = {
  waiting: 22, working: 20, done: 29, error: 26, offline: 30,
}
const emote = computed(() => EMOTE[props.session.status] ?? null)
const emoteUrl = computed(() => (emote.value ? `assets/emote/${emote.value}.png` : ''))

const monster = computed(() => props.session.monster ?? null)
const monsterUrl = computed(() =>
  monster.value ? (monster.value.isBoss ? bossSprite(monster.value.label) : monsterSprite(monster.value.type)) : '',
)
const monH = computed(() => Math.round(props.height * (monster.value?.isBoss ? 1.25 : 1)))
const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))

// Número de daño flotante cuando sube combat.tokens.
const floats = ref<{ key: number; text: string; big: boolean }[]>([])
let fkey = 0
let lastTokens = props.session.combat?.tokens ?? 0
watch(
  () => props.session.combat?.tokens ?? 0,
  (tok) => {
    const dmg = props.session.combat?.lastDamage
    if (tok > lastTokens && dmg) {
      const key = ++fkey
      floats.value.push({ key, text: fmt(dmg), big: !!monster.value?.isBoss })
      setTimeout(() => (floats.value = floats.value.filter((f) => f.key !== key)), 850)
    }
    lastTokens = tok
  },
)

// Flinch del héroe en error.
const flinch = ref(false)
watch(
  () => props.session.status,
  (st) => {
    if (st === 'error') {
      flinch.value = true
      setTimeout(() => (flinch.value = false), 700)
    }
  },
)
</script>

<template>
  <div class="mini" :style="{ height: height + 'px' }">
    <div class="stamina-slot"><StaminaOrb :value="stam" /></div>
    <div
      v-if="emoteUrl"
      class="pemote"
      :class="{ alert: session.status === 'waiting' }"
      :style="{ backgroundImage: `url(${emoteUrl})` }"
    ></div>
    <Sprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroIdle(session.name, session.char)"
      :height="height"
      mode="static"
      :frame="monster ? 3 : 0"
    />
    <Sprite
      v-if="monster"
      :key="monsterUrl"
      class="fighter pmon"
      :class="{ boss: monster.isBoss }"
      :src="monsterUrl"
      :height="monH"
      :mode="monster.isBoss ? 'strip' : 'grid'"
      :dir="2"
    />
    <div v-for="d in floats" :key="d.key" class="pdmg" :class="{ big: d.big }">-{{ d.text }}</div>
  </div>
</template>

<style scoped>
.mini {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
  padding: 0 4px;
}
.fighter { image-rendering: pixelated; background-repeat: no-repeat; }
.pmon { align-self: flex-end; }
.stamina-slot { position: absolute; top: -2px; right: 2px; z-index: 3; transform: scale(0.8); transform-origin: top right; }
.pemote {
  position: absolute; left: 0; top: -4px; width: 26px; height: 24px;
  background-repeat: no-repeat; background-size: 26px 24px; image-rendering: pixelated; z-index: 4;
}
.pemote.alert { animation: emoteBounce 0.7s steps(2) infinite; }
@keyframes emoteBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.pdmg {
  position: absolute; right: 18%; top: 0; font-family: var(--f-ui); font-size: 12px; color: var(--gold);
  text-shadow: 2px 2px 0 #000; pointer-events: none; white-space: nowrap;
  animation: bdmgfloat 0.85s ease-out forwards;
}
.pdmg.big { font-size: 15px; color: #fff; }
.phero.flinch { animation: bflinch 0.3s steps(2) 2; }
</style>
```

Nota: `@keyframes bdmgfloat` y `bflinch` ya existen globalmente en `style.css`; los estilos scopeados pueden referenciarlos.

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/components/MiniArena.vue
git commit -m "feat(habitat): componente MiniArena (sprites+stamina+emote reutilizable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `SessionPod` compacto + estado seleccionado

Reescribe el pod como fila compacta (densidad cómoda): `MiniArena` arriba + meta debajo. Quita la arena de 180px, el contador, el nombre de monstruo y el loot overlay del pod (la batalla grande y el loot viven en el detalle). Resalta el pod seleccionado de forma persistente.

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`
- Modify: `habitat/client/src/style.css` (reglas `.pod*`, `.meta*`; quitar dependencia de `.stage`)

**Interfaces:**
- Consumes: `MiniArena` (Task 4), `store.selectedId` (Task 2), `STATUS_LABEL`, `ago`.

- [ ] **Step 1: Reescribir el componente**

Reemplazar **todo** el contenido de `habitat/client/src/components/SessionPod.vue` por:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { STATUS_LABEL, type Session } from '../types'
import { ago } from '../sprites'
import MiniArena from './MiniArena.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { canSpawn, kill } = useProjects()
const selected = computed(() => store.selectedId === props.session.id)

function requestClose() {
  if (confirm(`¿Cerrar la sesión "${props.session.name}"? Se perderá el trabajo en curso.`)) {
    kill(props.session.id)
  }
}
function select() {
  store.select(props.session.id)
}
</script>

<template>
  <div
    class="pod"
    :class="[session.status, { selected }]"
    tabindex="0"
    role="button"
    :aria-pressed="selected"
    @click="select"
    @keydown.enter="select"
  >
    <div class="ring"></div>
    <button v-if="canSpawn" class="killx" aria-label="cerrar sesión" @click.stop="requestClose">×</button>
    <MiniArena :session="session" :height="56" />
    <div class="meta">
      <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
      <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      <div class="action">{{ session.action }}</div>
      <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
    </div>
  </div>
</template>

<style scoped>
.killx {
  position: absolute; top: 6px; left: 8px; width: 20px; height: 20px; border-radius: 5px;
  background: #5a1f1f; border: 1px solid #a44; color: #f9c; font-size: 13px; line-height: 16px;
  cursor: pointer; opacity: 0; transition: opacity 0.12s; z-index: 5;
}
.pod:hover .killx, .pod:focus-within .killx { opacity: 1; }
</style>
```

- [ ] **Step 2: Ajustar estilos del pod en `style.css`**

En `habitat/client/src/style.css`, **reemplazar** la regla `.pod{...}` (y mantener las variantes de estado `.pod.working` etc.) por una versión compacta, y **agregar** `.pod.selected`. Reemplazar el bloque que hoy empieza en `.pod{position:relative; ...}` y `.pod:hover{...}` por:
```css
  .pod{position:relative; border:2px solid var(--line); border-radius:0; background:var(--surface);
    padding:12px 12px 10px; cursor:pointer; overflow:hidden;
    box-shadow:var(--bevel), 3px 3px 0 #0b0703; transition:transform .1s, border-color .1s}
  .pod:hover{transform:translate(-2px,-2px); border-color:var(--gold); box-shadow:var(--bevel), 5px 5px 0 #0b0703, var(--glow-gold)}
  .pod.selected{border-color:var(--gold); box-shadow:var(--bevel), 5px 5px 0 #0b0703, var(--glow-gold)}
  .pod.selected .ring{box-shadow:inset 0 0 0 2px var(--gold)}
```
**Eliminar** del `style.css` las reglas de la arena grande que ya no se usan en el pod: `.stage`, `.gfloor`, `.fighter`, `.phero`, `.pmon`, `.pmon.boss`, `.pmon.hit`, `.pmon.dying`, `.phero.flinch`, `.pcount`, `.pmonname`, `.pdmg`, `.pod.offline .stage`, `.ploot*`, `.pstam*`, `.bubble`, `.pod.waiting .bubble`, `.badge`, `.pod.done .badge.ok`, `.pod.error .badge.err`.
> Mantener `@keyframes bdmgfloat`, `bflinch`, `bdie` (los usa MiniArena/detalle) y `@keyframes needblink` (usado por `.pod.waiting .ring`).

En la misma pasada, **afinar el type-scale del meta** (densidad cómoda). Reemplazar:
```css
  .name{font-family:var(--f-ui); font-weight:700; font-size:15px; display:flex; align-items:center; gap:8px; flex-wrap:wrap}
```
por:
```css
  .meta{margin-top:8px}
  .name{font-family:var(--f-ui); font-weight:700; font-size:14px; display:flex; align-items:center; gap:8px; flex-wrap:wrap}
```
y reemplazar `.repo{... font-size:17px ...}`, `.action{... font-size:19px ...}` por:
```css
  .repo{font-family:var(--f-body); font-size:14px; color:var(--dim); margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .repo .br{color:var(--gold)}
  .action{font-family:var(--f-body); font-size:14px; color:#e0cfa6; margin-top:4px; min-height:0; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: sin errores de tipos ni de build (el pod ya no referencia símbolos eliminados).

- [ ] **Step 4: Verificación visual**

Run: `cd habitat/client && npm run dev` (en otra terminal el server, o usar datos de WS existentes).
Observar: cada pod es una fila compacta con mini-sprites (héroe + monstruo si hay) arriba y nombre/repo/acción/since debajo; el pod activo queda con borde/halo dorado persistente. No hay arena de 180px.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue habitat/client/src/style.css
git commit -m "feat(habitat): pod compacto con mini-arena y estado seleccionado

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `SessionRail` (lista 1 columna / tira) + empty state

Renombra `SessionGrid` a `SessionRail`, ajustando el contenedor para 1 columna (landscape/narrow) y tira horizontal (portrait). El estado vacío se conserva.

**Files:**
- Create: `habitat/client/src/components/SessionRail.vue`
- Delete: `habitat/client/src/components/SessionGrid.vue`
- Modify: `habitat/client/src/style.css` (reemplazar `.grid` por `.rail`; ajustar `.empty`)

**Interfaces:**
- Produces: `<SessionRail />` que renderiza `SessionPod` por cada `store.list` y el empty state si no hay sesiones.

- [ ] **Step 1: Crear `SessionRail.vue`**

Crear `habitat/client/src/components/SessionRail.vue`:
```vue
<script setup lang="ts">
import { useSessions } from '../stores/sessions'
import SessionPod from './SessionPod.vue'

const store = useSessions()
</script>

<template>
  <div class="rail">
    <div v-if="!store.list.length" class="empty">
      No hay sesiones abiertas.<br />
      Arrancá una con <code>mono &lt;proyecto&gt;</code> en el server.
    </div>
    <SessionPod v-for="s in store.list" :key="s.id" :session="s" />
  </div>
</template>
```

- [ ] **Step 2: Borrar `SessionGrid.vue`**

Run:
```bash
git rm habitat/client/src/components/SessionGrid.vue
```

- [ ] **Step 3: Reemplazar `.grid` por `.rail` en `style.css`**

En `habitat/client/src/style.css`, **reemplazar** la regla:
```css
  .grid{display:grid; gap:24px; grid-template-columns:repeat(auto-fill, minmax(340px,1fr)); max-width:1500px; margin:0 auto}
```
por:
```css
  /* Lista de pods. Por defecto: 1 columna con scroll vertical (landscape/narrow).
     En portrait ancho se convierte en tira horizontal (ver bloque de orientación). */
  .rail{display:flex; flex-direction:column; gap:14px; padding:14px; overflow:auto; height:100%}
  .rail > .pod{flex:0 0 auto}
```
Y **reemplazar** `.empty{grid-column:1/-1; ...}` por (sin `grid-column`):
```css
  .empty{text-align:center; color:var(--dim); border:2px dashed var(--soft); padding:40px 18px; font-family:var(--f-body); font-size:16px; margin:auto}
```

- [ ] **Step 4: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: error esperado **solo** en `App.vue` (todavía importa `SessionGrid`); se arregla en Task 9. Confirmar que no hay otros errores. Si querés evitar el rojo intermedio, esta verificación se cierra recién tras Task 9.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/SessionRail.vue habitat/client/src/style.css
git commit -m "feat(habitat): SessionRail (lista 1 columna) reemplaza SessionGrid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `DetailPanel` (cabecera-batalla + terminal + loot)

Extrae el contenido del drawer a un panel reutilizable (sin la lógica de overlay/scrim/drag, que va a `HabitatLayout`). Cabecera compacta con cara + `MiniArena` + info + botón cerrar; terminal dominante; overlay de "VENCIDO" para la sesión enfocada.

**Files:**
- Create: `habitat/client/src/components/DetailPanel.vue`
- Modify: `habitat/client/src/style.css` (estilos `.dpanel`, `.dhead`, `.dmini`, `.dloot`; ajustar `.term`)

**Interfaces:**
- Consumes: `useTerminal` (sin cambios), `MiniArena` (Task 4), `useProjects`, `store.selected`, `store.lastFight`.
- Produces: `<DetailPanel />` que expone `fit(): void` vía `defineExpose` (lo llama `HabitatLayout` al redimensionar).

- [ ] **Step 1: Crear `DetailPanel.vue`**

Crear `habitat/client/src/components/DetailPanel.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type FightResult } from '../types'
import { faceFor, ago, fmt } from '../sprites'
import { useTerminal } from '../composables/useTerminal'
import { useProjects } from '../composables/useProjects'
import MiniArena from './MiniArena.vue'

const store = useSessions()
const { canSpawn, kill } = useProjects()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit } = useTerminal(termEl, selectedId)

function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) kill(s.id)
}

// Overlay de loot al vencer — solo para la sesión enfocada.
const lootShown = ref(false)
const loot = ref<FightResult | null>(null)
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === store.selected?.id) {
      loot.value = lf.result
      lootShown.value = true
      setTimeout(() => (lootShown.value = false), 2600)
    }
  },
)

defineExpose({ fit })
</script>

<template>
  <div class="dpanel">
    <template v-if="store.selected">
      <div class="dhead crt">
        <img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" />
        <MiniArena class="dmini" :session="store.selected" :height="64" />
        <div class="dinfo">
          <div class="dname">
            {{ store.selected.name }}
            <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span>
          </div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
          <div class="action">{{ store.selected.action }}</div>
          <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
        </div>
        <button v-if="canSpawn" class="killsession" @click="closeSession">✕ CERRAR</button>
      </div>
      <div ref="termEl" class="term" aria-label="terminal de la sesión"></div>
      <div class="dloot" :class="{ show: lootShown }" v-if="loot">
        <div class="ttl">★ VENCIDO ★</div>
        <div class="mn">{{ loot.monster }}</div>
        <div class="stat">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div>
        <div class="lootline">LOOT: <span>{{ loot.loot.join(', ') }}</span></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.killsession {
  align-self: flex-start; background: #5a1f1f; border: 1px solid #a44; color: #f9c;
  font-family: var(--f-ui); font-size: 11px; padding: 6px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;
}
.killsession:hover { background: #7a2a2a; }
.dmini { flex: 0 0 auto; width: 120px; }
</style>
```

- [ ] **Step 2: Estilos del panel en `style.css`**

En `habitat/client/src/style.css`, **agregar** (después del bloque del drawer que se eliminará/ajustará en Task 8, o al final del archivo):
```css
  /* ===== PANEL DE DETALLE (permanente) ===== */
  .dpanel{display:flex; flex-direction:column; height:100%; min-height:0; background:#1a1428; position:relative; padding:18px}
  .dpanel .dhead{display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap}
  .dpanel .face{width:96px; height:96px; image-rendering:pixelated; border:3px solid var(--soft);
    box-shadow:var(--bevel), var(--glow-purple); background:#160e07; flex:0 0 auto}
  .dpanel .dinfo{flex:1; min-width:0}
  .dpanel .dname{font-family:var(--f-ui); font-size:17px; display:flex; align-items:center; gap:8px; flex-wrap:wrap}
  .dpanel .dinfo .action{font-family:var(--f-body); font-size:16px; color:#e0cfa6; line-height:1.3; margin-top:6px}
  .dpanel .dinfo .since{font-family:var(--f-ui); font-size:11px; color:#8a7350; margin-top:8px; letter-spacing:.3px}
  /* Terminal: superficie de trabajo, SIN scanlines, borde sobrio, texto nítido. */
  .term{margin-top:16px; background:#160e07; border:2px solid var(--line);
    padding:8px; flex:1; min-height:0; overflow:hidden; image-rendering:auto}
  .dloot{position:absolute; left:18px; right:18px; top:18px; background:radial-gradient(circle at 50% 42%, rgba(92,55,20,.95), rgba(14,9,4,.97));
    display:none; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; padding:16px; border:2px solid var(--line); box-shadow:var(--bevel)}
  .dloot.show{display:flex; animation:bfadein .2s}
  .dloot .ttl{font-family:var(--f-ui); font-size:13px; color:var(--gold); text-shadow:var(--glow-gold)}
  .dloot .mn{font-family:var(--f-body); font-size:17px; color:#fff}
  .dloot .stat{font-family:var(--f-body); font-size:14px; color:#d8c39a} .dloot .stat b{color:var(--coral)}
  .dloot .lootline{font-family:var(--f-body); font-size:13px; color:var(--green)} .dloot .lootline span{color:var(--dim)}
```

- [ ] **Step 3: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: el único error pendiente sigue siendo `App.vue` (Task 9). DetailPanel compila.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/DetailPanel.vue habitat/client/src/style.css
git commit -m "feat(habitat): DetailPanel reutilizable (cabecera-batalla + terminal + loot)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `HabitatLayout` (shell master-detail + responsive + divisor)

Shell que monta `SessionRail` + una única instancia de `DetailPanel`. En monitores: grid embebido (eje según orientación) con divisor redimensionable en landscape. Bajo 900px: el panel se trata como overlay deslizante con scrim + Esc. Refit del terminal al redimensionar y al cruzar el breakpoint.

**Files:**
- Create: `habitat/client/src/components/HabitatLayout.vue`
- Modify: `habitat/client/src/style.css` (reglas `.hlayout*`, `.scrim`; mover scanlines de `body::after` a `.crt::after`)

**Interfaces:**
- Consumes: `useViewport` (Task 3), `SessionRail` (Task 6), `DetailPanel` (Task 7, usa `panel.fit()`), `store.select` / `store.selected` / `store.selectedId`.

- [ ] **Step 1: Crear `HabitatLayout.vue`**

Crear `habitat/client/src/components/HabitatLayout.vue`:
```vue
<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { useViewport } from '../composables/useViewport'
import SessionRail from './SessionRail.vue'
import DetailPanel from './DetailPanel.vue'

const store = useSessions()
const { isNarrow } = useViewport()
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)

// Ancho del rail en landscape (px), persistido.
const RAIL_MIN = 280
const RAIL_MAX = 640
const railW = ref(Math.min(RAIL_MAX, Math.max(RAIL_MIN, Number(localStorage.getItem('habitat.railWidth')) || 340)))

function startResize(e: MouseEvent) {
  e.preventDefault()
  const onMove = (m: MouseEvent) => {
    railW.value = Math.min(RAIL_MAX, Math.max(RAIL_MIN, m.clientX))
    panel.value?.fit()
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem('habitat.railWidth', String(railW.value))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// En narrow el detalle es overlay; se abre al elegir un pod (no en la auto-selección inicial).
const mobileOpen = ref(false)
let firstSelect = true
watch(
  () => store.selectedId,
  (id) => {
    if (firstSelect) { firstSelect = false; return }
    if (isNarrow.value) mobileOpen.value = !!id
  },
)
function closeOverlay() { mobileOpen.value = false }

function refit() { nextTick(() => requestAnimationFrame(() => panel.value?.fit())) }
watch(isNarrow, refit)
function onResize() { refit() }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && isNarrow.value && mobileOpen.value) closeOverlay() }
onMounted(() => { window.addEventListener('resize', onResize); document.addEventListener('keydown', onKey) })
onUnmounted(() => { window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="hlayout" :class="isNarrow ? 'narrow' : 'wide'" :style="{ '--rail-w': railW + 'px' }">
    <SessionRail class="hrail crt" />
    <div v-if="!isNarrow" class="hdiv" @mousedown="startResize" aria-hidden="true"></div>
    <div v-if="isNarrow" class="scrim" :class="{ open: mobileOpen }" @click="closeOverlay"></div>
    <div class="hpanelhost" :class="{ open: isNarrow ? mobileOpen : true }">
      <DetailPanel ref="panel" />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Estilos del layout + scanlines por zona en `style.css`**

En `habitat/client/src/style.css`:

(a) **Mover las scanlines** de global a por-zona. Reemplazar el bloque global:
```css
  /* CRT scanlines */
  body::after{content:""; position:fixed; inset:0; pointer-events:none; z-index:60;
    background:repeating-linear-gradient(to bottom, rgba(0,0,0,.16) 0 1px, transparent 1px 3px); opacity:.6}
```
por una clase reutilizable (la terminal queda excluida):
```css
  /* CRT scanlines — solo en zonas con .crt (rail, cabecera del detalle). NO en la terminal. */
  .crt{position:relative}
  .crt::after{content:""; position:absolute; inset:0; pointer-events:none; z-index:6;
    background:repeating-linear-gradient(to bottom, rgba(0,0,0,.16) 0 1px, transparent 1px 3px); opacity:.5}
```

(b) **Reemplazar** las reglas del drawer overlay (`.scrim{...}`, `.scrim.open{...}`, `.drawer{...}`, `.drawer.open{...}`, `.dragx{...}`, `.dragx:hover{...}`, `.dhead{...}`, `.face{...}`, `.dinfo{...}`, `.dname{...}`, `.closex{...}`, `.dmeta{...}`, `.dmeta .action{...}`, `.dmeta .since{...}` y el bloque `BATTLE STAGE (drawer)` con `.hpwrap/.hpbar/.hpfill/.hpval/.bstage/.bground/.bfighter/.bhero/.bmon/.bdmg/.bmonname/.bbubble/.bloot` ) por el shell del nuevo layout. Es decir: **eliminar todas esas reglas** (el drawer y la battle-stage del drawer ya no existen) y **agregar**:
```css
  /* ===== SHELL MASTER-DETAIL ===== */
  .hlayout{flex:1; min-height:0; min-width:0}
  /* Wide (≥900px): grid embebido. */
  .hlayout.wide{display:grid; height:100%}
  .hlayout.wide .hrail{min-height:0}
  .hlayout.wide .hpanelhost{min-height:0; min-width:0}
  .hlayout.wide .hdiv{background:linear-gradient(90deg, transparent, rgba(201,143,46,.35)); cursor:ew-resize}
  .hlayout.wide .hdiv:hover{background:linear-gradient(90deg, transparent, rgba(201,143,46,.6))}
  @media (min-width:900px) and (orientation:landscape){
    .hlayout.wide{grid-template-columns:var(--rail-w,340px) 6px 1fr; grid-template-rows:100%}
    .hlayout.wide .hdiv{height:100%}
  }
  @media (min-width:900px) and (orientation:portrait){
    .hlayout.wide{grid-template-rows:minmax(140px,auto) 6px 1fr; grid-template-columns:100%}
    .hlayout.wide .hrail{flex-direction:row; overflow-x:auto; overflow-y:hidden}
    .hlayout.wide .hrail > .pod{width:280px}
    .hlayout.wide .hdiv{width:100%; height:6px; cursor:default; background:linear-gradient(180deg, transparent, rgba(201,143,46,.35))}
  }
  /* Narrow (<900px): rail full + detalle overlay deslizante. */
  .hlayout.narrow{display:block; height:100%; overflow:auto}
  .hlayout.narrow .hpanelhost{position:fixed; top:0; right:0; height:100dvh; width:min(94vw,760px);
    transform:translateX(100%); transition:transform .2s steps(6); z-index:21; border-left:3px solid var(--line)}
  .hlayout.narrow .hpanelhost.open{transform:none}
  .scrim{position:fixed; inset:0; background:rgba(8,6,12,.6); opacity:0; pointer-events:none; transition:.15s; z-index:20}
  .scrim.open{opacity:1; pointer-events:auto}
```

> Nota: el `.dpanel` ya trae `padding`/`background` (Task 7). En portrait wide la tira de pods usa scroll horizontal; el divisor existe pero queda como separador fino no arrastrable (decisión de alcance: el drag redimensiona el rail solo en landscape).

- [ ] **Step 3: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sigue el error de `App.vue` (Task 9). HabitatLayout compila.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/HabitatLayout.vue habitat/client/src/style.css
git commit -m "feat(habitat): HabitatLayout master-detail responsive + scanlines por zona

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Cablear `App.vue` + altura completa + borrar el drawer

Conecta el nuevo shell, hace que la app ocupe el alto del viewport (rail/terminal con scroll interno) y elimina el `SessionDrawer` ya reemplazado.

**Files:**
- Modify: `habitat/client/src/App.vue`
- Modify: `habitat/client/src/style.css` (`#app` flex column de alto completo; ajustar `main`/`footer`)
- Delete: `habitat/client/src/components/SessionDrawer.vue`

**Interfaces:**
- Consumes: `HabitatLayout` (Task 8).

- [ ] **Step 1: Reescribir `App.vue`**

Reemplazar **todo** el contenido de `habitat/client/src/App.vue` por:
```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import HabitatLayout from './components/HabitatLayout.vue'
import SpawnMenu from './components/SpawnMenu.vue'

const store = useSessions()
onMounted(startSocket)
</script>

<template>
  <header>
    <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
    <div class="count">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <SpawnMenu />
  </header>
  <HabitatLayout />
  <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
</template>
```

- [ ] **Step 2: Alto completo en `style.css`**

En `habitat/client/src/style.css`, **agregar** la regla de `#app` (después de `html,body{margin:0;height:100%}`):
```css
  #app{display:flex; flex-direction:column; height:100dvh; overflow:hidden}
```
**Reemplazar** `main{padding:clamp(18px,3.5vw,38px)}` (ya no hay `<main>`; eliminar esa regla) y **reemplazar** el `footer{...}` por una versión que no fuerce scroll:
```css
  footer{flex:0 0 auto; padding:6px clamp(18px,3.5vw,38px); color:#5f5980; font-family:var(--f-ui); font-size:11px; letter-spacing:.3px}
```
El `header` se mantiene; con `#app` flex-column ya queda arriba (su `position:sticky` es inocuo).

- [ ] **Step 3: Borrar el drawer**

Run:
```bash
git rm habitat/client/src/components/SessionDrawer.vue
```

- [ ] **Step 4: Typecheck + build (ahora SÍ debe quedar todo verde)**

Run: `cd habitat/client && npm run typecheck && npm run build && npm test`
Expected: typecheck sin errores, build OK, 8 tests verdes. (Confirma que ya no quedan referencias a `SessionGrid`/`SessionDrawer`.)

- [ ] **Step 5: Verificación visual completa**

Run: `cd habitat/client && npm run dev`. Con sesiones activas, verificar los tres modos:
- **Monitor horizontal (landscape, ≥900px):** rail de 1 columna a la izquierda + detalle a la derecha; arrastrar el divisor cambia el ancho del rail y el terminal re-fitea; al cargar queda seleccionado el primer pod.
- **Monitor vertical (portrait, ≥900px):** tira horizontal de pods arriba (scroll horizontal) + detalle grande abajo con el terminal a todo el ancho.
- **Ventana angosta (<900px):** la lista ocupa la pantalla; al tocar un pod entra el detalle como overlay deslizante con scrim; Esc o click en el scrim lo cierra; el terminal re-fitea al abrir.
- En todos: la terminal se ve **sin scanlines** (nítida); rail y cabecera del detalle conservan scanlines/biseles/halos.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/App.vue habitat/client/src/style.css
git commit -m "feat(habitat): cablear HabitatLayout en App, alto completo, borrar SessionDrawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Shell de 2 zonas (drawer permanente) → Tasks 8, 9. ✔
- Adaptativo por orientación (rail landscape / tira portrait) → Task 8 (media queries). ✔
- Fallback overlay <900px → Tasks 3, 8. ✔
- Pod compacto + mini-arena, densidad cómoda, seleccionado → Tasks 4, 5. ✔
- Detalle terminal-dominante (cabecera-batalla + terminal) → Task 7. ✔
- Auto-seleccionar primero / empty state cero sesiones → Tasks 2, 6. ✔
- Divisor redimensionable (landscape) con persistencia → Task 8. ✔
- Efectos retro selectivos (terminal sin scanlines) → Tasks 7, 8 (`.crt` por zona). ✔
- Refactor `SessionDrawer` → `DetailPanel` + overlay en el shell (en vez de un `DetailOverlay` separado, para no remontar el terminal) → Tasks 7, 8. Desviación documentada del spec: una sola instancia de `DetailPanel` siempre montada evita teardown/setup del terminal al cruzar el breakpoint. ✔
- `useTerminal`/batalla conservados → Tasks 4, 7. ✔

**Placeholder scan:** sin TBD/TODO; todo el código está completo. ✔

**Type consistency:** `pickSelection(string[], string|null)` consistente entre Task 1 y 2; `DetailPanel` expone `fit()` (Task 7) y `HabitatLayout` lo invoca como `panel.value?.fit()` (Task 8); `MiniArena` recibe `{ session, height }` consistente en Tasks 4/5/7. ✔

**Riesgos / notas:**
- `npm run typecheck` queda en rojo entre Task 6 y Task 9 (App.vue importa componentes en transición). Es intencional; la verificación verde completa es la de Task 9 Step 4.
- En narrow, al cruzar a wide con overlay abierto, `mobileOpen` es ignorado (wide siempre muestra `open`); el `refit()` por `watch(isNarrow)` reajusta el terminal.
