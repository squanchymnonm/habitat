# Rediseño de Habitat — PR 4: ajustes, login y cierre — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la vista de ajustes legacy por `SettingsLayout` con secciones (General, Apariencia con `ThemePicker`, Proyectos con `ProjectDetail` por pestañas, Cuenta), reestilizar `LoginView`, y cerrar el rediseño: borrar `style.css` legacy y el bloque de alias, activar el preflight de Tailwind y eliminar lo que quedó sin uso.

**Architecture:** Las secciones de ajustes son rutas hash (`#/settings/<sección>`, `#/settings/projects/<proyecto>/<pestaña>`) renderizadas por `SettingsLayout`, con navegación lateral en landscape y arriba en portrait/phone. La lógica de proyectos (alta con navegador, clonar, configurar relacionados/infra/.env) se mueve de `ProjectsManager`/`ProjectConfig` a `ProjectsSettings`/`ProjectDetail` y a un composable `useProjectConfigDraft`, sin cambiar el contrato con el server. Al final, con todos los componentes migrados, se activa el preflight y se borra el CSS legacy.

**Tech Stack:** Vue 3.5, Pinia, vue-router 4, shadcn-vue 2.4.0 (Reka UI: Switch, Textarea, Tabs ya generado), Tailwind v4 con tokens semánticos, lucide-vue-next, vitest + happy-dom + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-10-05-habitat-redesign-design.md` (§1 Preflight, §2 Rutas, Ajustes, Login; §3 Componentes; §5; §6 fila PR 4; §7).

## Global Constraints

- Los componentes nuevos usan **solo tokens semánticos**, nunca colores literales. Un color que viene de datos (color de proyecto, muestras de un tema en el `ThemePicker`) puede ir por `:style`.
- Hasta la Task 6 el **preflight sigue apagado**: todo `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>` nuevo lleva estilos explícitos (`border-0` o `border border-<token>` con la utilidad de ancho, fondo, color con token, `font-[inherit]`, `cursor-pointer`; links `no-underline`; `<p>/<h*>/<ul>` con `m-0`, `<ul>` con `list-none p-0`). Así los componentes se ven igual antes y después de activar el preflight.
- **Tamaño táctil:** controles de al menos 40×40 px (`min-h-10`, `min-w-10` en sólo ícono).
- Textos de UI y comentarios en español rioplatense. `tsconfig` usa `lib: ES2020` (nada de `.at()`).
- Todo acceso a `localStorage` va en try/catch.
- No cambia el contrato HTTP/WS ni el server.
- Rutas de ajustes: `#/settings/general`, `appearance`, `projects`, `projects/:name/:tab`, `account`; `#/settings` va a `general`.
- Los tests de `ProjectConfig` y `ProjectsManager` se migran a sus sucesores **sin perder casos** (spec §7).

## Rulings sobre el spec

- **Select:** el permission mode usa un `<select>` nativo estilado con tokens, no el Select de Reka: es accesible, en el celular abre el selector del sistema y no necesita portal. Lo mismo en los selects de Infra y .env.
- **`:name` del proyecto en la ruta** es el último segmento de su `dir` (único dentro de `PROJECTS_ROOT`), no el label (que el usuario puede repetir o cambiar). La página muestra el label.
- **"Barra de sesiones colapsada por defecto"** fija el colapsado de landscape y portrait a la vez (`useLayoutMode().setCollapsedAll(v)`); el switch está prendido si ambos están colapsados. El botón de la barra sigue alternando el modo actual.
- **Zoom** se mueve del menú de usuario a Apariencia (el menú queda con Ajustes y Salir).
- **Toast:** no hace falta en este PR (los mensajes de guardado van en línea, como hoy). Se omite (YAGNI).
- **Limpieza de código muerto** que entra acá: `staminaHue` (sprites), `selectTick` (store), `cyclePos`/`cyclePosFrom`/`msToReset` (useUsage), el outline de foco nativo en `DialogContent`/`SheetContent` (pendiente del PR 3). El server no se toca (el `readUsage` de más en `index.js` queda).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/components/ui/{switch,textarea}/**` (nuevos, shadcn) | primitivas |
| `src/composables/useLayoutMode.ts` (mod) | `setCollapsedAll`, `allCollapsed` |
| `src/composables/useAuth.ts` (mod) | `user` desde `/auth/me` |
| `src/components/settings/ThemePicker.vue`, `AppearanceSettings.vue`, `GeneralSettings.vue`, `AccountSettings.vue`, `SettingsLayout.vue` (+tests) | ajustes |
| `src/components/settings/ProjectsSettings.vue` (+test, migra `ProjectsManager.test.ts`) | lista, alta, clonar |
| `src/composables/useProjectConfigDraft.ts` (+test) | borrador de relacionados/infra/.env y guardado |
| `src/components/settings/ProjectDetail.vue`, `project/ProjectGeneralTab.vue`, `ProjectRelatedTab.vue`, `ProjectInfraTab.vue`, `ProjectEnvTab.vue` (+tests, migran `ProjectConfig.test.ts`) | página de proyecto |
| `src/router.ts`, `src/views/SettingsRoute.vue` (mod) | rutas de ajustes |
| `src/components/shell/UserMenu.vue` (mod) | sin zoom |
| `src/components/LoginView.vue` (mod) | reestilo |
| `src/styles/theme.css` (mod), `src/style.css` (se elimina), `src/main.ts` (mod) | preflight, base global |
| Se eliminan | `SettingsView.vue`, `ProjectsManager.vue` (+test), `ProjectConfig.vue` (+test), `style.css` |

Comandos: cliente `cd habitat/client && npx vitest run <ruta>`; suite `npx vitest run`; typecheck + build `npm run build`. Server (no cambia): `cd habitat && npm test`.

Branch: `feat/habitat-redesign-ajustes`, desde `main` actualizado (incluye PR 1–3).

---

### Task 1: Primitivas, `ThemePicker` y Apariencia

**Files:**
- Create: `src/components/ui/switch/**`, `src/components/ui/textarea/**` (shadcn), `src/components/settings/ThemePicker.vue`, `ThemePicker.test.ts`, `src/components/settings/AppearanceSettings.vue`, `AppearanceSettings.test.ts`
- Modify: `src/composables/useLayoutMode.ts` (+test), `src/components/shell/UserMenu.vue` (sin zoom), `src/components/shell/TopBar.test.ts` (si asertaba el zoom del menú: los asserts de zoom pasan a `AppearanceSettings.test.ts`)

**Interfaces:**
- Consumes: `useTheme()` → `{ theme: Ref<ThemeId>, themes: ThemeDef[], setTheme(id) }` (`ThemeDef { id, name, swatch: [bg, surface, accent], colors }`); `useZoom()` → `{ zoomPct, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut }`; `useTermKeys()` → `{ enabled, toggle }`; `useLayoutMode()`.
- Produces:
  - `useLayoutMode()` suma `allCollapsed: ComputedRef<boolean>` (landscape y portrait colapsados) y `setCollapsedAll(v: boolean): void` (fija y persiste ambos).
  - `<ThemePicker />`: una tarjeta (`data-test="theme-card"`, `<button>`, `aria-pressed`) por tema con vista previa (las tres muestras de `swatch` por `:style`) y el nombre; al hacer clic aplica el tema en vivo (`setTheme`).
  - `<AppearanceSettings />`: ThemePicker; zoom (`data-test="zoom-out"`, `zoom-reset`, `zoom-in`); switch de teclas en pantalla (`data-test="termkeys-switch"`); switch de barra colapsada por defecto (`data-test="nav-collapsed-switch"`); créditos de sprites al pie ("Sprites: Ninja Adventure — Pixel-Boy / AAA · CC0").
  - `@/components/ui/switch` (`Switch`, `v-model` booleano) y `@/components/ui/textarea` (`Textarea`, `v-model`).

- [ ] **Step 1: Generar las primitivas**

```bash
cd habitat/client
npx shadcn-vue@2.4.0 add switch textarea --yes
```
Mismo tratamiento que en PR 2/3: `@lucide/vue` → `lucide-vue-next`; colores de shadcn → tokens (`bg-primary` → `bg-accent`, `bg-input` → `bg-surface-raised`, `border-input`/`border` sin color → `border border-border`, `ring-ring` → `ring-accent`, `bg-background` queda, `text-muted-foreground` → `text-muted`); sin `dark:`; radios `rounded-[var(--radius)]` (el switch puede quedar `rounded-full`); el Switch con área táctil ≥40px (envolverlo en un `label` de `min-h-10` alcanza en el uso) y `cursor-pointer`; el Textarea con `border border-border bg-background text-text font-mono` cuando se use para `.env`. Verificar con `grep -rnE "primary|secondary|muted-foreground|popover|destructive|ring-ring|bg-input|dark:|white|black|@lucide/vue" src/components/ui/switch src/components/ui/textarea` (sin resultados).

- [ ] **Step 2: Tests que fallan**

`src/composables/useLayoutMode.test.ts`, agregar:
```ts
describe('colapsado por defecto', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  it('setCollapsedAll fija landscape y portrait y lo persiste', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const { useLayoutMode } = await import('./useLayoutMode')
    const l = useLayoutMode()
    expect(l.allCollapsed.value).toBe(false)
    l.setCollapsedAll(true)
    expect(l.allCollapsed.value).toBe(true)
    expect(l.collapsed.value).toBe(true)
    expect(localStorage.getItem('habitat.nav.collapsed.landscape')).toBe('1')
    expect(localStorage.getItem('habitat.nav.collapsed.portrait')).toBe('1')
    l.toggleCollapsed() // el botón de la barra sigue alternando sólo el modo actual
    expect(l.allCollapsed.value).toBe(false)
  })
})
```

`src/components/settings/ThemePicker.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.resetModules() })

describe('ThemePicker', () => {
  it('una tarjeta por tema, marca el activo y aplica en vivo', async () => {
    const { applyStoredTheme } = await import('../../composables/useTheme')
    applyStoredTheme()
    const ThemePicker = (await import('./ThemePicker.vue')).default
    const w = mount(ThemePicker)
    const cards = w.findAll('[data-test="theme-card"]')
    expect(cards.map((c) => c.text())).toEqual(['Forja refinada', 'Pizarra pixel', 'Noche de taberna'])
    expect(cards[0].attributes('aria-pressed')).toBe('true')
    await cards[2].trigger('click')
    expect(document.documentElement.dataset.theme).toBe('taberna')
    expect(localStorage.getItem('habitat.theme')).toBe('taberna')
    expect(w.findAll('[data-test="theme-card"]')[2].attributes('aria-pressed')).toBe('true')
  })
  it('tarjetas táctiles y sin estilo nativo', async () => {
    const ThemePicker = (await import('./ThemePicker.vue')).default
    const cls = mount(ThemePicker).findAll('[data-test="theme-card"]')[0].classes()
    expect(cls).toEqual(expect.arrayContaining(['min-h-10', 'cursor-pointer', 'font-[inherit]']))
  })
})
```

`src/components/settings/AppearanceSettings.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppearanceSettings from './AppearanceSettings.vue'
import { useZoom } from '../../composables/useZoom'
import { useLayoutMode } from '../../composables/useLayoutMode'

beforeEach(() => { localStorage.clear() })

describe('AppearanceSettings', () => {
  it('incluye el ThemePicker y los créditos de los sprites', () => {
    const w = mount(AppearanceSettings)
    expect(w.findAll('[data-test="theme-card"]').length).toBe(3)
    expect(w.text()).toContain('Ninja Adventure')
  })
  it('zoom: acercar, alejar y volver a 100%', async () => {
    const w = mount(AppearanceSettings)
    const { zoomPct } = useZoom()
    const start = zoomPct.value
    await w.get('[data-test="zoom-in"]').trigger('click')
    expect(zoomPct.value).toBeGreaterThan(start)
    await w.get('[data-test="zoom-reset"]').trigger('click')
    expect(zoomPct.value).toBe(100)
  })
  it('barra colapsada por defecto', async () => {
    const w = mount(AppearanceSettings, { attachTo: document.body })
    await w.get('[data-test="nav-collapsed-switch"]').trigger('click')
    await flushPromises()
    expect(useLayoutMode().allCollapsed.value).toBe(true)
    w.unmount()
  })
})
```

En `TopBar.test.ts`, quitar el caso que abre el menú y busca los botones de zoom (`Alejar`, `100%`, `Acercar`), si existe; reemplazarlo por un assert de que el menú ya no tiene zoom (`document.body.querySelector('[aria-label="Acercar"]')` es `null` con el menú abierto).

- [ ] **Step 3: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useLayoutMode.test.ts src/components/settings src/components/shell/TopBar.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

`useLayoutMode.ts`, dentro de `useLayoutMode()`:
```ts
// "Colapsada por defecto" (Ajustes → Apariencia): fija landscape y portrait a la vez.
const allCollapsed = computed(() => collapsedByMode.value.landscape && collapsedByMode.value.portrait)
function setCollapsedAll(v: boolean) {
  collapsedByMode.value = { ...collapsedByMode.value, landscape: v, portrait: v }
  for (const m of ['landscape', 'portrait'] as const) {
    try { localStorage.setItem(KEY(m), v ? '1' : '0') } catch { /* sin storage */ }
  }
}
```
y devolverlos (`return { mode, collapsed, setCollapsed, toggleCollapsed, allCollapsed, setCollapsedAll }`).

`src/components/settings/ThemePicker.vue`:
```vue
<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useTheme } from '../../composables/useTheme'
import { cn } from '@/lib/utils'

// Tarjetas de los temas con vista previa; elegir uno lo aplica en vivo.
const { theme, themes, setTheme } = useTheme()
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <button v-for="t in themes" :key="t.id" data-test="theme-card" type="button" :aria-pressed="theme === t.id ? 'true' : 'false'"
      :class="cn('flex min-h-10 cursor-pointer flex-col gap-2 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-3 text-left font-[inherit] text-text hover:bg-surface-raised',
        theme === t.id && 'ring-2 ring-accent')"
      @click="setTheme(t.id)">
      <!-- Vista previa: fondo, superficie y acento del tema (colores de datos del registro). -->
      <span class="flex h-12 overflow-hidden rounded-[var(--radius)] border border-border" aria-hidden="true">
        <i class="flex-[2]" :style="{ background: t.swatch[0] }" />
        <i class="flex-[2]" :style="{ background: t.swatch[1] }" />
        <i class="flex-1" :style="{ background: t.swatch[2] }" />
      </span>
      <span class="flex items-center justify-between gap-2 text-sm font-semibold">
        {{ t.name }}<Check v-if="theme === t.id" class="size-4 text-accent" />
      </span>
    </button>
  </div>
</template>
```

`src/components/settings/AppearanceSettings.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import ThemePicker from './ThemePicker.vue'
import { useZoom } from '../../composables/useZoom'
import { useTermKeys } from '../../composables/useTermKeys'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { Switch } from '@/components/ui/switch'

const { zoomPct, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useZoom()
const { enabled: termKeys, toggle: toggleTermKeys } = useTermKeys()
const { allCollapsed, setCollapsedAll } = useLayoutMode()
const termKeysModel = computed({ get: () => termKeys.value, set: (v: boolean) => { if (v !== termKeys.value) toggleTermKeys() } })
const navModel = computed({ get: () => allCollapsed.value, set: (v: boolean) => setCollapsedAll(v) })
const iconBtn = 'inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-surface-raised font-[inherit] text-text hover:text-accent disabled:cursor-default disabled:opacity-40'
</script>

<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Tema</h2>
      <ThemePicker />
    </section>
    <section class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Zoom</h2>
      <div class="flex items-center gap-2">
        <button data-test="zoom-out" type="button" :class="iconBtn" :disabled="!canZoomOut" aria-label="Alejar" @click="zoomOut"><Minus class="size-4" /></button>
        <button data-test="zoom-reset" type="button" title="Volver a 100%" @click="resetZoom"
          class="min-h-10 w-16 cursor-pointer rounded-[var(--radius)] border-0 bg-transparent font-[inherit] text-sm tabular-nums text-text">{{ zoomPct }}%</button>
        <button data-test="zoom-in" type="button" :class="iconBtn" :disabled="!canZoomIn" aria-label="Acercar" @click="zoomIn"><Plus class="size-4" /></button>
      </div>
    </section>
    <section class="flex flex-col gap-1">
      <label class="flex min-h-10 cursor-pointer items-center justify-between gap-4">
        <span class="flex flex-col">
          <span class="text-sm font-semibold text-text">Teclas en pantalla</span>
          <span class="text-xs text-muted">Flechas, Esc y Tab en la terminal y el editor. Útil en tablets y celulares sin teclado físico.</span>
        </span>
        <Switch v-model="termKeysModel" data-test="termkeys-switch" />
      </label>
      <label class="flex min-h-10 cursor-pointer items-center justify-between gap-4">
        <span class="flex flex-col">
          <span class="text-sm font-semibold text-text">Barra de sesiones colapsada por defecto</span>
          <span class="text-xs text-muted">Sólo avatares con la luz de estado, en horizontal y en vertical.</span>
        </span>
        <Switch v-model="navModel" data-test="nav-collapsed-switch" />
      </label>
    </section>
    <p class="m-0 font-mono text-xs text-muted">Sprites: Ninja Adventure — Pixel-Boy / AAA · CC0</p>
  </div>
</template>
```
(Si el `Switch` generado por shadcn-vue 2.4.0 usa `v-model:checked` en vez de `v-model`, ajustar las dos líneas.)

`src/components/shell/UserMenu.vue`: quitar `useZoom`, los íconos `Minus`/`Plus` y el bloque del zoom; el menú queda con "Ajustes" (`router.push('/settings/general')`) y "Salir". Actualizar el comentario.

- [ ] **Step 5: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 6: Commit**

```bash
git add -A habitat/client/src habitat/client/components.json
git commit -m "feat(habitat): Apariencia con ThemePicker, zoom y preferencias; zoom sale del menú"
```

---

### Task 2: `SettingsLayout`, rutas, General y Cuenta

**Files:**
- Create: `src/components/settings/SettingsLayout.vue`, `SettingsLayout.test.ts`, `GeneralSettings.vue`, `GeneralSettings.test.ts`, `AccountSettings.vue`, `AccountSettings.test.ts`
- Modify: `src/router.ts` (+`router.test.ts`), `src/views/SettingsRoute.vue`, `src/composables/useAuth.ts` (+`useAuth.test.ts`)

**Interfaces:**
- Consumes: `useSettings()` → `{ permissionMode: Ref<PermissionMode>, error, saving, save(mode) }`; `useAuth()`; `useLayoutMode()` (`mode`); `AppearanceSettings` (Task 1); `ProjectsManager.vue` (legacy, sólo hasta la Task 3).
- Produces:
  - Rutas: `/settings` → redirect `/settings/general`; `/settings/:section(general|appearance|projects|account)` (`name: 'settings'`); `/settings/projects/:name/:tab?` (`name: 'project'`); una sección desconocida redirige a `/settings/general`.
  - `useAuth()` suma `user: Ref<string | null>` (de `GET /auth/me` → `{ user }`; `null` si no viene).
  - `<SettingsLayout />`: nav de secciones (`data-test="settings-nav"`, links `data-test="settings-link"` con `aria-current="page"` en la activa) a la izquierda en landscape y arriba (scroll horizontal) en portrait/phone; el contenido según la ruta: `general` → `GeneralSettings`, `appearance` → `AppearanceSettings`, `projects` y la ruta `project` → `ProjectsManager` (legacy, temporal: la lista nueva llega en la Task 3 y la página de proyecto en la Task 4), `account` → `AccountSettings`.
  - `<GeneralSettings />`: `<select id="pmode" data-test="pmode">` nativo con los 4 modos y la descripción del elegido debajo.
  - `<AccountSettings />`: usuario actual (`data-test="account-user"`; si es `null`, "Entraste con token") y botón Salir (`data-test="logout"`).

- [ ] **Step 1: Tests que fallan**

`src/router.test.ts`, agregar:
```ts
describe('rutas de ajustes', () => {
  it('/settings va a general y acepta las secciones', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings'); await router.isReady()
    expect(router.currentRoute.value.fullPath).toBe('/settings/general')
    for (const s of ['appearance', 'projects', 'account']) {
      await router.push(`/settings/${s}`)
      expect(router.currentRoute.value.params.section).toBe(s)
    }
  })
  it('sección desconocida vuelve a general', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings/nada'); await router.isReady()
    expect(router.currentRoute.value.fullPath).toBe('/settings/general')
  })
  it('página de proyecto con pestaña', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings/projects/back/infra'); await router.isReady()
    expect(router.currentRoute.value.name).toBe('project')
    expect(router.currentRoute.value.params).toMatchObject({ name: 'back', tab: 'infra' })
  })
})
```

`src/composables/useAuth.test.ts`, agregar: con `fetch` stubeado a `{ status: 200, json: async () => ({ user: 'mnonm' }) }`, `checkAuth()` deja `user.value === 'mnonm'`; con `{ user: null }` o 401, `user.value === null`; `logout()` lo deja en `null`.

`src/components/settings/GeneralSettings.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const permissionMode = ref('acceptEdits')
const save = vi.fn(async () => true)
vi.mock('../../composables/useSettings', () => ({ useSettings: () => ({ permissionMode, error: ref(''), saving: ref(false), save }) }))
import GeneralSettings from './GeneralSettings.vue'

describe('GeneralSettings', () => {
  it('muestra el modo actual con su descripción y guarda al cambiar', async () => {
    const w = mount(GeneralSettings)
    const sel = w.get('[data-test="pmode"]')
    expect((sel.element as HTMLSelectElement).value).toBe('acceptEdits')
    expect(w.text()).toContain('Auto-aprueba ediciones')
    await sel.setValue('plan')
    expect(save).toHaveBeenCalledWith('plan')
  })
  it('select táctil y estilado', () => {
    expect(mount(GeneralSettings).get('[data-test="pmode"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border', 'border-border', 'font-[inherit]']))
  })
})
```

`src/components/settings/AccountSettings.test.ts`: mockear `useAuth` con `user: ref('mnonm')` y `logout: vi.fn()`; asertar el texto `mnonm`, que el click en `logout` llama a `logout`, y que con `user: ref(null)` dice "Entraste con token".

`src/components/settings/SettingsLayout.test.ts`: montar con `createHabitatRouter(createMemoryHistory())` en `/settings/appearance` y `useLayoutMode` mockeado (`mode` ref): la nav tiene los links General, Apariencia, Proyectos y Cuenta (en ese orden), el de Apariencia con `aria-current="page"`, y el contenido muestra `[data-test="theme-card"]`; ir a `/settings/account` muestra `[data-test="account-user"]`; en `landscape` la nav tiene `flex-col` y en `portrait` no. Mockear `ProjectsManager.vue` con un stub.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/router.test.ts src/composables/useAuth.test.ts src/components/settings`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/router.ts`, reemplazar la ruta de settings por:
```ts
{ path: '/settings', redirect: '/settings/general' },
{ path: '/settings/:section(general|appearance|projects|account)', name: 'settings', component: () => import('./views/SettingsRoute.vue') },
{ path: '/settings/projects/:name/:tab?', name: 'project', component: () => import('./views/SettingsRoute.vue') },
{ path: '/settings/:pathMatch(.*)*', redirect: '/settings/general' },
```
(antes del catch-all general). Si algún test o componente navega a `/settings/:section?` sin sección, ahora redirige a `general`.

`src/composables/useAuth.ts`: `const user = ref<string | null>(null)`; en `checkAuth`, si `res.status === 200`, `user.value = ((await res.json().catch(() => ({}))) as { user?: string | null }).user ?? null`; si no, `null`; `logout` lo pone en `null`; `login` exitoso vuelve a llamar `checkAuth()` para traer el usuario. Devolver `user`.

`src/components/settings/GeneralSettings.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSettings } from '../../composables/useSettings'
import type { PermissionMode } from '../../types'

const { permissionMode, error, saving, save } = useSettings()
const MODES: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'default', label: 'Default', desc: 'Pregunta antes de cada acción (comportamiento normal).' },
  { value: 'acceptEdits', label: 'Auto-accept edits', desc: 'Auto-aprueba ediciones de archivos; pregunta por bash y acciones sensibles.' },
  { value: 'plan', label: 'Plan', desc: 'Arranca en modo plan: investiga y propone sin tocar nada.' },
  { value: 'bypassPermissions', label: 'Bypass', desc: 'Aprueba TODO sin preguntar. Usalo con cuidado.' },
]
const desc = computed(() => MODES.find((m) => m.value === permissionMode.value)?.desc ?? '')
</script>

<template>
  <section class="flex max-w-xl flex-col gap-2">
    <label for="pmode" class="text-sm font-semibold text-text">Permission mode de las sesiones nuevas</label>
    <select id="pmode" data-test="pmode" :value="permissionMode" :disabled="saving"
      class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text"
      @change="save(($event.target as HTMLSelectElement).value as PermissionMode)">
      <option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
    </select>
    <p class="m-0 text-sm text-muted">{{ desc }}</p>
    <p v-if="error" class="m-0 text-sm text-danger">{{ error }}</p>
  </section>
</template>
```

`src/components/settings/AccountSettings.vue`:
```vue
<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { useAuth } from '../../composables/useAuth'

const { user, logout } = useAuth()
</script>

<template>
  <section class="flex max-w-xl flex-col gap-3">
    <p class="m-0 text-sm text-muted">Usuario</p>
    <p data-test="account-user" class="m-0 text-base font-semibold text-text">{{ user ?? 'Entraste con token' }}</p>
    <button data-test="logout" type="button" @click="logout()"
      class="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-surface-raised px-4 font-[inherit] text-sm text-text hover:text-danger">
      <LogOut class="size-4" />Salir
    </button>
  </section>
</template>
```

`src/components/settings/SettingsLayout.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { SlidersHorizontal, Palette, FolderGit2, CircleUser } from 'lucide-vue-next'
import { useLayoutMode } from '../../composables/useLayoutMode'
import GeneralSettings from './GeneralSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AccountSettings from './AccountSettings.vue'
import ProjectsManager from '../ProjectsManager.vue'
import { cn } from '@/lib/utils'

const route = useRoute()
const { mode } = useLayoutMode()
const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Apariencia', icon: Palette },
  { id: 'projects', label: 'Proyectos', icon: FolderGit2 },
  { id: 'account', label: 'Cuenta', icon: CircleUser },
]
// La página de un proyecto cuenta como la sección Proyectos.
const current = computed(() => (route.name === 'project' ? 'projects' : String(route.params.section ?? 'general')))
const side = computed(() => mode.value === 'landscape')
</script>

<template>
  <div :class="cn('flex h-full min-h-0', side ? 'flex-row' : 'flex-col')">
    <nav data-test="settings-nav" aria-label="Secciones de ajustes"
      :class="cn('flex shrink-0 gap-1 bg-surface p-2', side ? 'w-52 flex-col border-r border-border' : 'overflow-x-auto border-b border-border')">
      <RouterLink v-for="s in SECTIONS" :key="s.id" :to="`/settings/${s.id}`" data-test="settings-link"
        :aria-current="current === s.id ? 'page' : undefined"
        :class="cn('flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--radius)] px-3 text-sm no-underline',
          current === s.id ? 'bg-surface-raised text-text' : 'text-muted hover:bg-surface-raised hover:text-text')">
        <component :is="s.icon" class="size-4" />{{ s.label }}
      </RouterLink>
    </nav>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <GeneralSettings v-if="current === 'general'" />
      <AppearanceSettings v-else-if="current === 'appearance'" />
      <AccountSettings v-else-if="current === 'account'" />
      <!-- Legacy hasta que lleguen ProjectsSettings / ProjectDetail (Tasks 3 y 4). -->
      <ProjectsManager v-else />
    </div>
  </div>
</template>
```

`src/views/SettingsRoute.vue`:
```vue
<script setup lang="ts">
import SettingsLayout from '../components/settings/SettingsLayout.vue'
</script>

<template>
  <div class="h-full min-h-0"><SettingsLayout /></div>
</template>
```

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): ajustes con navegación por secciones (General, Apariencia, Cuenta)"
```

---

### Task 3: Proyectos (lista, alta y clonar)

**Files:**
- Create: `src/components/settings/ProjectsSettings.vue`, `ProjectsSettings.test.ts` (migra **todos** los casos de `src/components/ProjectsManager.test.ts`)
- Modify: `src/components/settings/SettingsLayout.vue` (sección `projects` → `ProjectsSettings`)
- Delete: `src/components/ProjectsManager.test.ts` (migrado). `ProjectsManager.vue` se borra en la Task 4 (la ruta `project` todavía lo usa).

**Interfaces:**
- Consumes: `useProjects()` → `{ projects, canManage, canClone, error, browse(rel), listRepos(), cloneRepo(nameWithOwner), addProject({dir, label?, color, chars?}), updateProject, removeProject }`, `PALETTE` (`src/palette`), `CHARACTERS` (`src/sprites`).
- Produces: `<ProjectsSettings />`:
  - lista (`data-test="project-row"`): color, nombre, ruta, y un link `data-test="project-open"` a `/settings/projects/<basename(dir)>/general` (sin los swatches inline ni "configurar"/"quitar": eso pasa a la página del proyecto);
  - "+ Agregar proyecto" (`data-test="add-open"`) abre el navegador de carpetas y, al elegir una, el formulario de alta (nombre, color, personajes permitidos, Agregar/cancelar), con la misma lógica que hoy;
  - "Clonar repo" (`data-test="clone-open"`, sólo si `canClone`) con filtro (`data-test="repo-filter"`), lista (`data-test="repo"`), errores por owner y "clonar" que, al terminar, abre el alta precargada con la carpeta clonada;
  - el aviso de gestión deshabilitada si `!canManage`.
  - Exporta además `projectSlug(dir: string): string` (último segmento de la ruta) desde `src/components/settings/projectSlug.ts`, para la Task 4.

Lógica a trasladar **tal cual** desde `src/components/ProjectsManager.vue` (todo el `<script>`: navegador, borrador de alta, panel de repos, `clone`, `submitAdd`, `toggleDraftChar`), salvo `setColor` y `remove`, que pasan a la Task 4. Template nuevo con tokens:
- secciones con `h2.m-0`; filas `flex min-h-10 items-center gap-3 rounded-[var(--radius)] bg-surface px-3`;
- el color del proyecto como `<i class="size-3 rounded-sm" :style="{ background: p.color }">`;
- botones `min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50`;
- inputs `min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text`;
- swatches de color del alta: `<button>` `size-10` con `:style` y `ring-2 ring-accent` el elegido;
- personajes del alta: `<button>` con la cara (`faceFor('', c)`, `pixel`) y el nombre en `title`, `ring-2 ring-accent` los elegidos (en vez de los botones de texto actuales);
- errores en `text-sm text-danger`.

- [ ] **Step 1: Test que falla**

`src/components/settings/ProjectsSettings.test.ts`: copiar los dos casos de `ProjectsManager.test.ts` (listar repos/filtrar/marcar clonados/errores por owner; clonar abre el alta precargada) adaptando el componente montado y los selectores (`data-test` de arriba), y sumar:
```ts
it('cada proyecto linkea a su página', async () => {
  // projects = [{ dir: '/home/u/proyectos/back', name: 'Back', color: '#61afef' }]
  const w = mountSettings()
  const a = w.get('[data-test="project-open"]')
  expect(a.attributes('href')).toContain('/settings/projects/back/general')
  expect(w.get('[data-test="project-row"]').text()).toContain('Back')
})
it('alta: elegir carpeta, nombre, color y personajes', async () => {
  // browse devuelve una carpeta "front"; al agregar se llama addProject con dir/label/color/chars
})
```
(con el `vi.mock('../../composables/useProjects', …)` y el router de memoria que necesite el `RouterLink`; escribir el segundo caso completo: abrir `add-open`, click en "elegir" de la carpeta, completar nombre, elegir un color y un personaje, "Agregar", y asertar el `addProject` con `{ dir: 'front', label: …, color: …, chars: [...] }`).

`src/components/settings/projectSlug.test.ts`: `projectSlug('/a/b/back') === 'back'`, `projectSlug('back/') === 'back'`, `projectSlug('back') === 'back'`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/settings/ProjectsSettings.test.ts src/components/settings/projectSlug.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/components/settings/projectSlug.ts`:
```ts
// Identificador del proyecto en la URL: el último segmento de su carpeta (único
// dentro de PROJECTS_ROOT). El label lo elige el usuario y puede repetirse.
export function projectSlug(dir: string): string {
  return dir.split('/').filter(Boolean).pop() ?? dir
}
```
`ProjectsSettings.vue` según la lista de arriba. En `SettingsLayout.vue`, la sección `projects` renderiza `ProjectsSettings`; la ruta `project` sigue en `ProjectsManager` hasta la Task 4.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): ajustes de proyectos (lista, alta con navegador y clonar)"
```

---

### Task 4: `ProjectDetail` con pestañas y fuera los ajustes legacy

**Files:**
- Create: `src/composables/useProjectConfigDraft.ts`, `useProjectConfigDraft.test.ts`, `src/components/settings/ProjectDetail.vue`, `ProjectDetail.test.ts`, `src/components/settings/project/ProjectGeneralTab.vue`, `ProjectRelatedTab.vue`, `ProjectInfraTab.vue`, `ProjectEnvTab.vue` (sus tests migran **todos** los casos de `src/components/ProjectConfig.test.ts`)
- Modify: `src/components/settings/SettingsLayout.vue` (ruta `project` → `ProjectDetail`)
- Delete: `src/components/SettingsView.vue`, `src/components/ProjectsManager.vue`, `src/components/ProjectConfig.vue`, `src/components/ProjectConfig.test.ts`

**Interfaces:**
- Consumes: `useProjects()` (`projects`, `browse`, `saveConfig(dir, {related, infra, envFiles})`, `getEnv`, `importEnv`, `saveEnv`, `updateProject`, `removeProject`), `projectSlug` (Task 3), `PALETTE`, `CHARACTERS`, `faceFor`, `@/components/ui/tabs`, `@/components/ui/textarea` (Task 1), `ConfirmDialog` (`src/components/focus/ConfirmDialog.vue`).
- Produces:
  - `useProjectConfigDraft(project: Ref<Project>)` → `{ related, infraRepo, infraPath, infraUp, infraDown, envFiles, repoOptions, repoLabel, save(): Promise<void>, saving, configError, configOk }` — el borrador y el guardado de `ProjectConfig.vue` (`draft()`, `save()`), sin cambios de comportamiento.
  - `<ProjectDetail />`: lee `route.params.name` y `route.params.tab` (default `general`), busca el proyecto por `projectSlug(p.dir) === name`; si no existe, "Proyecto no encontrado" con link a `/settings/projects`. Cabecera con el color y el label, link "‹ Proyectos". Pestañas (`@/components/ui/tabs` o botones `role="tab"`, `data-test="project-tab"`): **General**, **Relacionados**, **Infra**, **Archivos .env**; cambiar de pestaña hace `router.replace` a `/settings/projects/<name>/<tab>` (`general|related|infra|env`).
  - Las pestañas Relacionados, Infra y .env comparten **un** borrador (`useProjectConfigDraft`, creado en `ProjectDetail` y pasado por prop `draft`) y el botón "Guardar configuración" (`data-test="save-config"`) visible en esas tres; el editor de `.env` mantiene su guardado propio.
  - `ProjectGeneralTab`: label (input, `data-test="project-label"`, guarda con `updateProject({ dir, label })`), color (swatches), personajes permitidos (caras, guarda con `updateProject({ dir, chars })`), y "Quitar de la lista" (`data-test="project-remove"`) con `ConfirmDialog` → `removeProject(dir)` y navega a `/settings/projects`.

Lógica a trasladar **tal cual** desde `src/components/ProjectConfig.vue`: todo el `<script>` (borrador, `save`, navegador de relacionados `openPicker/go/pick/removeRelated`, `.env`: `addEnvFile`, `removeEnvFile`, edición por `(repo, path)`, `openEnv`, `doImport`, `doSaveEnv`, la ayuda de variables `{{stack}}`, `{{port:NOMBRE}}`, `{{path:…}}`, `{{branch}}`). Y desde `ProjectsManager.vue`: `setColor` y `remove` (este último con `ConfirmDialog` en vez de `confirm`). Mantener los `data-test` que usan los tests actuales de `ProjectConfig` (`related-row`, `related-add`, `related-pick`, `infra-repo`, `infra-path`, `env-open`, `env-text`, `env-import`, `env-save`, `save-config`); el relacionado inexistente (`r.exists === false`) se marca con `text-danger` y un ícono (no sólo color) en vez de la clase `missing`; el test que lo verificaba asserta `text-danger` y el texto "no existe".

Estilo con tokens (mismas clases que la Task 3 para botones, inputs y selects nativos); el `Textarea` del `.env` con `font-mono min-h-48`; la ayuda de variables en un `<details>` con `<summary class="min-h-10 cursor-pointer">`.

- [ ] **Step 1: Tests que fallan**

`src/composables/useProjectConfigDraft.test.ts`: con un proyecto con `related`, `infra` y `envFiles`, el borrador arranca con esos valores; `save()` llama a `saveConfig(dir, { related, infra: { repo, path, up, down }, envFiles })`; con `infraRepo = ''` manda `infra: null`; si `saveConfig` devuelve `{ ok: false, error }` deja `configError`.

Migrar los 6 casos de `ProjectConfig.test.ts` a `ProjectRelatedTab.test.ts`, `ProjectInfraTab.test.ts` y `ProjectEnvTab.test.ts` (cada caso al tab que corresponde; los tabs se montan con un `draft` creado con `useProjectConfigDraft(ref(project))`), y sumar en `ProjectDetail.test.ts` (router de memoria en `/settings/projects/back/general`, `useProjects` mockeado con `projects = [{ dir: '/p/back', name: 'Back', color: '#61afef', related: [], infra: null, envFiles: [] }]`):
```ts
it('muestra el proyecto por su carpeta y la pestaña de la URL', async () => { /* label "Back" en la cabecera; pestaña General activa */ })
it('cambiar de pestaña actualiza la URL', async () => { /* click en "Infra" → fullPath /settings/projects/back/infra */ })
it('proyecto inexistente: aviso y link a la lista', async () => { /* /settings/projects/nada/general */ })
it('quitar pide confirmación y vuelve a la lista', async () => { /* project-remove → confirm-ok → removeProject('/p/back') y ruta /settings/projects */ })
it('cambiar el color guarda con updateProject', async () => { /* click en un swatch → updateProject({ dir: '/p/back', color }) */ })
```
Escribir los cinco completos (con `attachTo: document.body` y `unmount` donde haya portal; `vi.waitFor` si una navegación a una ruta lazy no se refleja con un `flushPromises`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useProjectConfigDraft.test.ts src/components/settings`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Según la lista de arriba. En `SettingsLayout.vue`, la rama legacy se reemplaza: `current === 'projects'` → `route.name === 'project' ? ProjectDetail : ProjectsSettings`; quitar el import de `ProjectsManager`. Borrar `SettingsView.vue`, `ProjectsManager.vue`, `ProjectConfig.vue` y `ProjectConfig.test.ts`. Verificar: `grep -rn "SettingsView\|ProjectsManager\|ProjectConfig" src` sólo encuentra `useProjectConfigDraft` (y ningún import roto).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): página de proyecto con pestañas; fuera SettingsView, ProjectsManager y ProjectConfig"
```

---

### Task 5: `LoginView` con tokens

**Files:**
- Modify: `src/components/LoginView.vue`
- Create: `src/components/LoginView.test.ts`

**Interfaces:**
- Consumes: `useAuth().login(user, password): Promise<boolean>`. `applyStoredTheme()` ya corre en `main.ts` antes de montar, así que el login usa el tema guardado o el default.
- Produces: el mismo comportamiento (submit, error "Usuario o contraseña incorrectos.", "No se pudo conectar.", `busy`), reestilizado: tarjeta centrada `bg-surface border border-border rounded-[calc(var(--radius)+4px)]`, logo "Hábitat" en `font-display text-accent`, subtítulo `text-muted`, inputs con `<label>` visibles (Usuario, Contraseña) además del placeholder, botón primario `bg-accent text-accent-foreground min-h-10`, error en `text-danger` con "!" delante. Sin `<style scoped>`.

- [ ] **Step 1: Test que falla**

`src/components/LoginView.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const login = vi.fn(async () => false)
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ login }) }))
import LoginView from './LoginView.vue'

beforeEach(() => login.mockReset())

describe('LoginView', () => {
  it('manda usuario y contraseña y muestra el error si fallan', async () => {
    login.mockResolvedValueOnce(false)
    const w = mount(LoginView)
    await w.get('input[autocomplete="username"]').setValue('mnonm')
    await w.get('input[type="password"]').setValue('x')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('mnonm', 'x')
    expect(w.text()).toContain('Usuario o contraseña incorrectos.')
  })
  it('sin conexión avisa', async () => {
    login.mockRejectedValueOnce(new Error('net'))
    const w = mount(LoginView)
    await w.get('form').trigger('submit'); await flushPromises()
    expect(w.text()).toContain('No se pudo conectar.')
  })
  it('labels visibles y controles táctiles sin estilo nativo', () => {
    const w = mount(LoginView)
    expect(w.findAll('label').map((l) => l.text())).toEqual(['Usuario', 'Contraseña'])
    expect(w.get('button[type="submit"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border-0', 'bg-accent', 'cursor-pointer']))
    expect(w.get('input[type="password"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border', 'border-border']))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/LoginView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Reemplazar el template y borrar el `<style scoped>`:
```vue
<template>
  <div class="flex min-h-full items-center justify-center bg-background p-4">
    <form class="flex w-full max-w-sm flex-col gap-4 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-6" @submit.prevent="submit">
      <div class="flex flex-col gap-1 text-center">
        <h1 class="m-0 font-display text-3xl font-bold text-accent">Hábitat</h1>
        <p class="m-0 text-sm text-muted">monitor de sesiones · Claude Code</p>
      </div>
      <label class="flex flex-col gap-1 text-sm text-muted">Usuario
        <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus
          class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text" />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">Contraseña
        <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password"
          class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text" />
      </label>
      <button :disabled="busy" type="submit"
        class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-accent px-4 font-[inherit] text-sm font-semibold text-accent-foreground disabled:opacity-60">
        {{ busy ? 'Entrando…' : 'Entrar' }}
      </button>
      <p v-if="error" class="m-0 rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger"><span aria-hidden="true">! </span>{{ error }}</p>
    </form>
  </div>
</template>
```
(La lista de labels del test toma el texto del label sin el input: si `text()` incluye el placeholder, envolver el texto del label en un `<span>` y asertar sobre ese span con `data-test="login-label"`.)

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): LoginView con los tokens del tema"
```

---

### Task 6: Preflight, fuera el CSS legacy y código muerto

**Files:**
- Modify: `src/styles/theme.css`, `src/main.ts`, `src/components/ui/dialog/DialogContent.vue`, `DialogScrollContent.vue`, `src/components/ui/sheet/SheetContent.vue`, `src/sprites.ts` (+test), `src/stores/sessions.ts` (+test), `src/composables/useUsage.ts` (+test)
- Delete: `src/style.css`, `src/components/ui/tabs/**` **si** quedó sin uso (si `ProjectDetail` lo usa, se queda)

**Interfaces:**
- Produces: preflight de Tailwind activo; reglas globales mínimas en `theme.css` (`@layer base`): `html, body { height: 100% }`, `#app { display:flex; flex-direction:column; height: calc(100dvh / var(--zoom, 1)); overflow: hidden }`, `body { font-family: var(--font-ui); color: var(--text); background: var(--background) }`, `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation: none !important; transition: none !important } }`. Sin el bloque de alias legacy (`--color-brass`, `--font-lore`, etc.) y sin `--color-base`.

- [ ] **Step 1: Verificar que nada usa lo que se va a borrar**

```bash
cd habitat/client
grep -rnE "var\(--(color-(bg|surface-2|raise|line|edge|edge-soft|ink|ink-2|dim|faint|brass|brass-2|ember|amber|moss|crimson|base)|font-(lore|system|machine)|radius-(sm|card|medallion)|shadow-|f-|glow-|bevel|bg2?|ink|dim|gold|teal|coral|green|red|lav|purple|magenta|surface2|soft)\b" src --include=*.vue --include=*.ts --include=*.css | grep -v "src/styles/theme.css" | grep -v "src/style.css"
grep -rn "font-machine\|staminaHue\|selectTick\|cyclePos\|msToReset" src --include=*.vue --include=*.ts | grep -v "\.test\.ts"
```
Expected: el primero sin resultados (si aparece alguno, migrarlo a su token semántico equivalente — `--color-ink` → `--text`, `--color-dim` → `--text-muted`, `--color-brass` → `--accent`, `--color-edge` → `--border`, etc. — en ese mismo componente). El segundo sólo muestra las definiciones a borrar.

- [ ] **Step 2: Activar el preflight y mover lo global**

`src/styles/theme.css`:
- reemplazar el comentario de "SIN preflight" y agregar `@import "tailwindcss/preflight.css" layer(base);` junto a los otros imports;
- borrar el bloque `:root { … }` de alias legacy completo;
- borrar `.font-machine` del `@layer base` (y su uso si quedara);
- agregar al `@layer base` las reglas de "Produces".

`src/main.ts`: quitar `import './style.css'`. Borrar `src/style.css`.

`DialogContent.vue`, `DialogScrollContent.vue`, `SheetContent.vue`: agregar `outline-none` a la raíz del contenido (el foco visible queda en los controles con `focus-visible:ring-2 focus-visible:ring-accent`).

Código muerto: borrar `staminaHue` de `sprites.ts` y su test; `selectTick` de `stores/sessions.ts` (y su `++`) y cualquier assert sobre él; `cyclePos`, `cyclePosFrom` y `msToReset` de `useUsage.ts` (conservar `mana`, `resetLabel`, `usage`, `setUsage`, `fmtReset`, `manaFromUsage`) y sus tests. `ui/tabs` se borra sólo si `grep -rn "ui/tabs" src` no encuentra usos.

- [ ] **Step 3: Correr la suite y el build**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -1`
Expected: verde y build OK. Si algún test asertaba estilos que el preflight cambia, ajustar sólo el assert (no el comportamiento).

- [ ] **Step 4: Commit**

```bash
git add -A habitat/client/src
git commit -m "chore(habitat): preflight de Tailwind, fuera style.css legacy, alias y código muerto"
```

---

### Task 7: Capturas, verificación visual y cierre

**Files:**
- Modify: `habitat/scripts/screenshots.mjs` (vistas de ajustes y login), `habitat/README.md` (ajustes y temas)

**Interfaces:**
- Produces: vistas `settings` (ahora `#/settings/general`), `settings-appearance`, `settings-projects`, `settings-project` (`#/settings/projects/<carpeta del primer proyecto>/infra`; la carpeta se toma del `HABITAT_PROJECTS` de la instancia) y `login` (requiere una instancia **con** `HABITAT_USER`/`HABITAT_PASSWORD_HASH` de prueba y sin `?token=`; si no se puede sembrar sin tocar archivos reales, capturar el login montando la instancia con un usuario de prueba documentado en el reporte).

- [ ] **Step 1: Script**

Agregar las vistas a `ALL_VIEWS`. `node --check habitat/scripts/screenshots.mjs`.

- [ ] **Step 2: Instancia aislada y capturas**

Igual que en el PR 3: `env -i PATH="$PATH" HOME="$HOME" HABITAT_PORT=8399 HABITAT_TOKEN=shots HABITAT_TMUX_SOCKET=habitat-shots-pr4 HABITAT_ALLOW_SPAWN=1 HABITAT_PROJECTS=<worktree> HABITAT_DOCKER_CLEANUP=0 HABITAT_STATE=… HABITAT_SESSIONS=… HABITAT_PROJECTS_STATE=… HABITAT_SETTINGS=… node server/index.js`, estado en el scratchpad, PID capturado, `tmux: null` verificado en el archivo de estado antes de capturar, sesiones por `POST /hooks`, uso por `/status`. Nunca el endpoint de spawn. Matar por PID, confirmar que 8399 quedó libre y que no queda chrome. `LD_LIBRARY_PATH` sólo para chrome. Nunca producción (8377, `~/HabitatProdu`).

Capturar **toda la app con el preflight activo**: 3 temas × 3 tamaños en `focus`, `board` y `settings`; forja en `settings-appearance`, `settings-projects`, `settings-project` (3 tamaños), `phone-list`, `phone-focus`, `new-session`, `focus-git`, `focus-files` y `login` (1440×900 y 400×860). Revisar **cada** captura con Read buscando regresiones del preflight (márgenes, bordes, fuentes, imágenes, listas, inputs) además de los criterios de las vistas nuevas: nav de ajustes a la izquierda en 1440×900 y arriba en los otros; ThemePicker con las tres tarjetas y el activo marcado; pestañas de proyecto; login centrado. Corregir lo que falle (commits `fix(habitat): …`).

- [ ] **Step 3: README**

En `habitat/README.md`, sección "Temas y capturas": el tema se elige en Ajustes → Apariencia (junto con el zoom, las teclas en pantalla y la barra colapsada); quitar cualquier mención al zoom en el menú de usuario.

- [ ] **Step 4: Verificación final y commit**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
cd ../.. && git add habitat/scripts habitat/README.md && git commit -m "chore(habitat): capturas de ajustes y login, README"
```
El push y el PR los hace el controlador después de la revisión final de toda la branch.
