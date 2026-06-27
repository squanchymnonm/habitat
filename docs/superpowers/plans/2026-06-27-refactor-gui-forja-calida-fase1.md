# Refactor GUI "Forja cálida" — Fase 1 (Fundación) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar la fundación visual del refactor (Tailwind v4 + tokens "forja cálida" + fuentes self-hosted), la top bar (con maná + reset + ciclo día/noche cálido), el shell y el login — sin romper la lógica ni los tests existentes.

**Architecture:** Se introduce Tailwind v4 (config CSS-first con `@theme`) conviviendo con el `style.css` legacy (los componentes no migrados en esta fase siguen usándolo). Los tokens viven en `src/styles/theme.css`. Cada componente migrado usa utilities de Tailwind + estilos scoped sólo para lo "firma" (gradientes/blends/máscaras). El ciclo día/noche existente (`useDayNight`/`UsageHud`) sólo se re-grada a cálido; su lógica no cambia.

**Tech Stack:** Vue 3, Vite 5, Tailwind v4 (`@tailwindcss/vite`), Vitest, fuentes self-hosted woff2 (Fraunces / Hanken Grotesk / JetBrains Mono).

**Spec:** `docs/superpowers/specs/2026-06-27-refactor-gui-forja-calida-design.md`
**Mockup aprobado:** https://claude.ai/code/artifact/59810e58-2717-4218-9279-5f606a0eab62
**Demo ciclo día/noche:** https://claude.ai/code/artifact/608fe968-3a2a-431c-accb-e9868c3e7ed6

## Global Constraints

- Node 18+, trabajar siempre dentro de `habitat/client/`.
- **No CDNs externos** (Hábitat se sirve por HTTP/LAN): fuentes self-hosted en `public/fonts/`, referenciadas por `@font-face`. Nada de `<link>` a Google Fonts.
- **No tocar:** backend, protocolo WS, hooks, lógica de combate/telemetría, ni la lógica de `useUsage`/`useDayNight` (salvo las **constantes de color** `STOPS`).
- **No romper tests.** `npm test` (vitest) del cliente debe quedar verde. (Las fallas pre-existentes de módulos del server por `pngjs`/`ws` no aplican al cliente; validar solo lo tocado.)
- `npm run typecheck` (vue-tsc) y `npm run build` deben pasar al cerrar cada tarea que toca código.
- **Convivencia:** no borrar `src/style.css` en esta fase; los componentes de Fase 2/3 siguen dependiendo de él. **Tailwind sin preflight** (importar `theme.css` + `utilities.css`, NO `@import "tailwindcss"` completo) para no resetear los componentes legacy.
- **Responsive:** preservar breakpoints master-detail (wide ≥900px / narrow) y portrait/landscape ya existentes (`HabitatLayout`/`style.css`).
- **A11y:** foco visible (ring latón), respetar `prefers-reduced-motion`.
- Tokens de color (hex exactos), tipografía (3 voces) y stops del ciclo: ver spec §2 y §3.4.

---

### Task 1: Setup Tailwind v4 + fuentes self-hosted + tokens

**Files:**
- Modify: `habitat/client/package.json` (deps)
- Modify: `habitat/client/vite.config.ts`
- Create: `habitat/client/src/styles/theme.css`
- Modify: `habitat/client/src/main.ts`
- Create: `habitat/client/public/fonts/Fraunces.woff2`, `HankenGrotesk.woff2`, `JetBrainsMono.woff2`
- Create: `docs/superpowers/assets/forja-mockup.html` (copia de referencia del mockup aprobado)

**Interfaces:**
- Produces: clases/utilities de Tailwind con tokens forja (`bg-surface`, `text-brass`, `font-lore/system/machine`, `shadow-sh1/sh2`, `rounded-card`, colores `bg-ember/amber/moss/crimson/mana`, etc.) disponibles para todas las tareas siguientes; familias de fuente `--font-lore/system/machine`.

- [ ] **Step 1: Instalar Tailwind v4**

Run:
```bash
cd habitat/client && npm i -D tailwindcss@^4 @tailwindcss/vite@^4
```
Expected: instala sin errores; `package.json` lista `tailwindcss` y `@tailwindcss/vite` en devDependencies.

- [ ] **Step 2: Conseguir las fuentes woff2 (latin) y guardarlas en public/fonts**

Run:
```bash
cd habitat/client/public/fonts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
getlatin(){ css=$(curl -s -A "$UA" "$2"); url=$(echo "$css" | awk '/\/\* latin \*\//{f=1} f&&/woff2/{match($0,/https:[^)]+woff2/);print substr($0,RSTART,RLENGTH);exit}'); curl -s -A "$UA" "$url" -o "$1"; }
getlatin Fraunces.woff2     "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,560&display=swap"
getlatin HankenGrotesk.woff2 "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
getlatin JetBrainsMono.woff2 "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
ls -la *.woff2
```
Expected: tres `.woff2` de ~30–70KB cada uno (no ~1KB; si salen de 1KB, el subset es incorrecto — revisar el bloque `/* latin */`).

- [ ] **Step 3: Copiar el mockup de referencia al repo**

Run (desde la raíz del repo):
```bash
mkdir -p docs/superpowers/assets
cp "/tmp/claude-1000/-home-mnonm-habitat-worktrees-RPG-Agents-eivor/cc890239-6638-4440-84a0-2ded285c5f42/scratchpad/habitat-mockup.html" docs/superpowers/assets/forja-mockup.html
```
Expected: existe `docs/superpowers/assets/forja-mockup.html` (referencia visual offline; los valores exactos de estilos salen de ahí). Si la ruta del scratchpad ya no existe, omitir este paso y usar las URLs de los artifacts.

- [ ] **Step 4: Crear `src/styles/theme.css` con Tailwind + tokens + @font-face**

Create `habitat/client/src/styles/theme.css`:
```css
/* Tailwind v4 SIN preflight: convivencia con style.css legacy (Fase 1–3).
   El preflight resetea botones/inputs/headings y rompería los componentes
   aún no migrados. Importamos solo theme (para @theme) + utilities. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

/* Fuentes self-hosted (variables: un solo woff2 por familia cubre los pesos del rango) */
@font-face{ font-family:"Fraunces"; font-style:normal; font-weight:400 560; font-display:swap; src:url("/fonts/Fraunces.woff2") format("woff2"); }
@font-face{ font-family:"Hanken Grotesk"; font-style:normal; font-weight:400 700; font-display:swap; src:url("/fonts/HankenGrotesk.woff2") format("woff2"); }
@font-face{ font-family:"JetBrains Mono"; font-style:normal; font-weight:400 500; font-display:swap; src:url("/fonts/JetBrainsMono.woff2") format("woff2"); }

@theme{
  /* color — ground/estructura/texto */
  --color-bg:#14100B; --color-surface:#1C160F; --color-surface-2:#251D14; --color-raise:#2C2217;
  --color-line:#0C0805; --color-edge:#3A2C1B; --color-edge-soft:#4A3722;
  --color-ink:#F3E9D6; --color-ink-2:#E4D4B4; --color-dim:#AE997A; --color-faint:#7E6E54;
  /* acento + semánticos + arcano */
  --color-brass:#E0A94B; --color-brass-2:#C98A33;
  --color-ember:#E8773A; --color-amber:#F2C94C; --color-moss:#8FB85C; --color-crimson:#D14B3C;
  --color-mana:#3FA8FF;
  /* tipografía (3 voces) */
  --font-lore:"Fraunces", Georgia, serif;
  --font-system:"Hanken Grotesk", system-ui, -apple-system, sans-serif;
  --font-machine:"JetBrains Mono", ui-monospace, monospace;
  /* radios */
  --radius-card:14px; --radius-medallion:18px;
  /* sombras */
  --shadow-sh1:0 1px 0 rgba(255,255,255,.03), 0 2px 8px rgba(0,0,0,.4);
  --shadow-sh2:0 2px 4px rgba(0,0,0,.35), 0 14px 40px rgba(0,0,0,.5);
  --shadow-glow-brass:0 0 0 1px rgba(224,169,75,.35), 0 0 22px -6px rgba(224,169,75,.5);
}

/* Defaults globales del nuevo tema (no pisan el style.css legacy salvo body font/color) */
@layer base{
  body{ font-family:var(--font-system); color:var(--color-ink); }
  .font-machine{ font-variant-numeric:tabular-nums; }
}
```

- [ ] **Step 5: Registrar el plugin de Tailwind en Vite**

Modify `habitat/client/vite.config.ts` — agregar import y plugin:
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: { outDir: '../web', emptyOutDir: true, assetsDir: 'build' },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8377', ws: true },
      '/term': { target: 'ws://127.0.0.1:8377', ws: true },
    },
  },
})
```

- [ ] **Step 6: Importar theme.css en main.ts (después del legacy)**

Modify `habitat/client/src/main.ts`:
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import './styles/theme.css'

createApp(App).use(createPinia()).mount('#app')
```

- [ ] **Step 7: Verificar build y typecheck**

Run:
```bash
cd habitat/client && npm run typecheck && npm run build
```
Expected: ambos pasan. El build genera `../web` sin errores de Tailwind ni de fuentes.

- [ ] **Step 8: Commit**

```bash
git add habitat/client/package.json habitat/client/package-lock.json habitat/client/vite.config.ts habitat/client/src/styles/theme.css habitat/client/src/main.ts habitat/client/public/fonts/*.woff2 docs/superpowers/assets/forja-mockup.html
git commit -m "feat(habitat): setup Tailwind v4 + tokens forja + fuentes self-hosted"
```

---

### Task 2: Ciclo día/noche cálido (re-grade de STOPS) — TDD

**Files:**
- Modify: `habitat/client/src/composables/useDayNight.ts:3-9`
- Test: `habitat/client/src/composables/useDayNight.test.ts`

**Interfaces:**
- Consumes: `skyGradient(cyclePos)`, `dialPositions(cyclePos)` (firmas intactas).
- Produces: mismas firmas; sólo cambian los colores que devuelve `skyGradient`.

- [ ] **Step 1: Escribir el test que falla (color de noche cálido)**

En `useDayNight.test.ts`, agregar dentro del `describe`:
```ts
it('skyGradient: noche usa negro cálido de fragua (no púrpura frío)', () => {
  // p=1.0 → STOP noche cálido top #191320 / bot #130d08
  expect(skyGradient(1)).toBe('linear-gradient(180deg, rgb(25, 19, 32), rgb(19, 13, 8))')
})
it('skyGradient: día tiende a ámbar tostado cálido', () => {
  // p=0.16 → STOP día top #473828 / bot #5d421f
  expect(skyGradient(0.16)).toBe('linear-gradient(180deg, rgb(71, 56, 40), rgb(93, 66, 31))')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run:
```bash
cd habitat/client && npx vitest run src/composables/useDayNight.test.ts
```
Expected: FAIL (los dos nuevos asserts fallan; los colores actuales son fríos).

- [ ] **Step 3: Re-gradar los STOPS a cálido (forja)**

Modify `habitat/client/src/composables/useDayNight.ts` — reemplazar el array `STOPS`:
```ts
const STOPS = [
  { p: 0.00, top: '#3b2a30', bot: '#5e3a22' }, // amanecer (plum cálido → brasa)
  { p: 0.16, top: '#473828', bot: '#5d421f' }, // día (ámbar tostado)
  { p: 0.52, top: '#3f3024', bot: '#52381d' }, // media tarde
  { p: 0.78, top: '#3a2130', bot: '#4d1e0f' }, // atardecer (carmesí cálido)
  { p: 1.00, top: '#191320', bot: '#130d08' }, // noche (negro cálido de fragua)
]
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run:
```bash
cd habitat/client && npx vitest run src/composables/useDayNight.test.ts
```
Expected: PASS (incluidos los tests viejos de `dialPositions`/estructura).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useDayNight.ts habitat/client/src/composables/useDayNight.test.ts
git commit -m "feat(habitat): ciclo día/noche re-gradado a paleta cálida (forja)"
```

---

### Task 3: App.vue — fondo (sky + viñeta forja) y top bar

**Files:**
- Modify: `habitat/client/src/App.vue`

**Interfaces:**
- Consumes: tokens de Task 1; `useUsage().cyclePos` + `skyGradient` (ya importados); componentes `AppMenu`, `SpawnMenu`, `UsageHud` (re-estilados en tareas siguientes; la estructura de top bar la define esta tarea).
- Produces: contenedor `.topbar` (la barra superior) que `AppMenu`/`UsageHud` poblarán; capa `.sky-ambient` de base + `.forge-veil` de glows encima.

Estructura objetivo (ver mockup `.topbar` y `body` background): la `.sky-ambient` queda de base (`z-index:-2`); encima una capa de viñeta/glows de forja (`z-index:-1`); el `hud-stack` y el menú se integran a una **top bar** fija superior.

- [ ] **Step 1: Reescribir App.vue (template + estilos de fondo y barra)**

Modify `habitat/client/src/App.vue` — `<template>`:
```vue
<template>
  <LoginView v-if="authed === false" />
  <template v-else-if="authed === true">
    <div class="sky-ambient" :style="skyBg ? { background: skyBg } : {}" aria-hidden="true"></div>
    <div class="forge-veil" aria-hidden="true"></div>
    <header class="topbar">
      <AppMenu v-model:view="view" />
      <div class="topbar-hud">
        <span class="hud-chip"><b>{{ store.list.length }}</b> sesiones</span>
        <span class="hud-chip need" v-if="store.needCount"><span class="need-pulse"></span> {{ store.needCount }} te necesitan</span>
        <UsageHud />
        <SpawnMenu />
      </div>
    </header>
    <HabitatLayout v-if="view === 'sessions'" />
    <SettingsView v-else />
  </template>
</template>
```
Notas: se elimina el `footer` (el crédito de sprites pasa a `SettingsView` en Fase 3; dejarlo fuera ahora). Mantener el `<script setup>` actual salvo que ya no se usa `footer`.

- [ ] **Step 2: Estilos de fondo y top bar en App.vue (`<style>` no-scoped, global)**

Agregar/reemplazar el `<style>` de App.vue (global, porque `.sky-ambient`/`.topbar` son del shell):
```vue
<style>
.sky-ambient{ position:fixed; inset:0; z-index:-2; pointer-events:none; opacity:.9; transition:background .6s linear; }
.forge-veil{ position:fixed; inset:0; z-index:-1; pointer-events:none;
  background:
    radial-gradient(820px 460px at 92% -6%, rgba(232,119,58,.18), transparent 60%),
    radial-gradient(680px 520px at 6% 110%, rgba(154,58,30,.14), transparent 55%); }
.topbar{ position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:18px;
  padding:13px clamp(16px,2.4vw,30px);
  background:linear-gradient(180deg, rgba(28,22,15,.92), rgba(20,16,11,.82));
  backdrop-filter:blur(10px); border-bottom:1px solid var(--color-edge); }
.topbar-hud{ display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap; }
.hud-chip{ display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:999px;
  background:var(--color-surface); border:1px solid var(--color-edge); color:var(--color-dim); font-size:13px; }
.hud-chip b{ color:var(--color-ink); font-variant-numeric:tabular-nums; }
.hud-chip.need{ background:linear-gradient(180deg, rgba(242,201,76,.16), rgba(242,201,76,.07));
  border-color:rgba(242,201,76,.4); color:var(--color-amber); font-weight:600; }
.need-pulse{ width:7px; height:7px; border-radius:50%; background:var(--color-amber);
  box-shadow:0 0 0 0 rgba(242,201,76,.6); animation:needpulse 1.6s infinite; }
@keyframes needpulse{ 0%{box-shadow:0 0 0 0 rgba(242,201,76,.55)} 70%{box-shadow:0 0 0 7px rgba(242,201,76,0)} 100%{box-shadow:0 0 0 0 rgba(242,201,76,0)} }
@media (prefers-reduced-motion:reduce){ .need-pulse{ animation:none } }
</style>
```

- [ ] **Step 3: Verificar typecheck + build**

Run:
```bash
cd habitat/client && npm run typecheck && npm run build
```
Expected: pasan.

- [ ] **Step 4: Verificación visual (dev)**

Run: `cd habitat/client && npm run dev` y abrir el dev server con `?token=...` (o usar el server real). Comprobar: top bar fija arriba; fondo con cielo cálido + glows; HUD a la derecha; el resto de la app sigue funcionando.
Expected: sin overlaps; el `AppMenu`/`UsageHud`/`SpawnMenu` aparecen dentro de la barra (aún con su estilo viejo hasta sus tareas).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/App.vue
git commit -m "feat(habitat): top bar + fondo día/noche con viñeta de forja"
```

---

### Task 4: AppMenu.vue — wordmark + menú en la top bar

**Files:**
- Modify: `habitat/client/src/components/AppMenu.vue`

**Interfaces:**
- Consumes: tokens de Task 1; vive dentro de `.topbar` (Task 3).
- Produces: el botón hamburguesa + el wordmark "Hábitat" (Lore) a la izquierda de la barra; el dropdown de menú re-estilado.

- [ ] **Step 1: Reescribir template (wordmark visible + hamburguesa + dropdown)**

Modify `AppMenu.vue` `<template>`:
```vue
<template>
  <div class="app-menu-root" ref="root">
    <button class="hamburger" @click="open = !open" :aria-expanded="open" aria-label="Menú">☰</button>
    <span class="wordmark">Hábita<span class="em">t</span></span>
    <div class="app-menu" v-if="open">
      <button class="mi" :class="{ active: view === 'sessions' }" @click="pickView('sessions')">Sesiones</button>
      <button class="mi" :class="{ active: view === 'settings' }" @click="pickView('settings')">⚙ Ajustes</button>
      <button class="mi" :class="{ active: compact }" @click="toggleCompact" title="Pods compactos">▭ Compacto</button>
      <button class="mi" @click="logout">Salir</button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Reemplazar `<style scoped>`**

```vue
<style scoped>
.app-menu-root{ position:relative; display:flex; align-items:center; gap:12px; }
.hamburger{ display:grid; place-items:center; width:38px; height:38px; font-size:16px; cursor:pointer;
  background:var(--color-surface-2); color:var(--color-ink-2); border:1px solid var(--color-edge); border-radius:9px; }
.hamburger:hover{ border-color:var(--color-brass-2); color:var(--color-brass); }
.hamburger:focus-visible{ outline:2px solid var(--color-brass); outline-offset:2px; }
.wordmark{ font-family:var(--font-lore); font-weight:560; font-size:22px; letter-spacing:-.01em; color:var(--color-ink); }
.wordmark .em{ color:var(--color-brass); text-shadow:0 0 18px rgba(224,169,75,.4); }
.app-menu{ position:absolute; top:calc(100% + 8px); left:0; z-index:10; min-width:200px;
  display:flex; flex-direction:column; gap:6px; padding:10px;
  background:linear-gradient(180deg,#2c2012,#190f07); border:1px solid var(--color-edge);
  border-radius:12px; box-shadow:var(--shadow-sh2); }
.mi{ text-align:left; padding:9px 11px; border-radius:8px; font-size:13px; cursor:pointer;
  background:var(--color-surface-2); color:var(--color-ink); border:1px solid var(--color-edge); }
.mi:hover{ border-color:var(--color-brass-2); color:var(--color-brass); }
.mi.active{ background:var(--color-brass); color:#2a1c0a; border-color:var(--color-brass); }
</style>
```

- [ ] **Step 3: Verificar typecheck + build + visual**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: pasan. Visual (dev): wordmark "Hábitat" con la `t` en latón junto a la hamburguesa; dropdown premium.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components/AppMenu.vue
git commit -m "feat(habitat): AppMenu como wordmark + menú premium en top bar"
```

---

### Task 5: UsageHud.vue — maná arcano + dial + reset

**Files:**
- Modify: `habitat/client/src/components/UsageHud.vue`

**Interfaces:**
- Consumes: tokens de Task 1; `useUsage()` (`usage`, `mana`, `resetLabel`, `cyclePos`) y `dialPositions` (sin cambios de lógica).
- Produces: la barra de maná (azul arcano) + dial ☀️/🌙 + countdown de reset, dentro de la top bar.

- [ ] **Step 1: Reemplazar el `<template>` (markup con nuevas clases)**

Mantener el `<script setup>` actual (lógica del dial y motes intacta). Reemplazar el `<template>`:
```vue
<template>
  <div class="usage-hud" v-if="usage">
    <div class="mana" title="Uso de Claude restante (ventana 5h)">
      <span class="mana-lbl">Maná</span>
      <span class="mana-track"><i class="mana-fill" :style="{ width: (mana ?? 0) + '%' }"></i></span>
      <img v-if="moteSrc" class="mana-mote" :src="moteSrc" alt="" />
    </div>
    <div class="reset" title="Tiempo hasta el reset · ciclo día/noche">
      <span class="dial"><span class="dn-sun" ref="sunEl">☀️</span><span class="dn-moon" ref="moonEl">🌙</span></span>
      <span class="reset-lbl">próxima</span>
      <span class="reset-val">{{ resetLabel }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Reemplazar `<style scoped>` (o agregarlo si no existe)**

```vue
<style scoped>
.usage-hud{ display:inline-flex; align-items:center; gap:10px; }
.mana{ display:inline-flex; align-items:center; gap:8px; padding:6px 11px; border-radius:999px;
  background:var(--color-surface); border:1px solid #214a63; color:#bfe2ff; font-size:12px; position:relative; }
.mana-lbl{ font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:#9cd0f2; }
.mana-track{ position:relative; width:70px; height:8px; border-radius:5px; background:#0c1016; overflow:hidden;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.5); }
.mana-fill{ position:absolute; inset:0 auto 0 0; height:100%; border-radius:5px;
  background:linear-gradient(90deg,#2f86d8,var(--color-mana)); box-shadow:0 0 9px rgba(63,168,255,.8);
  transition:width .5s linear; }
.mana-fill::before{ content:""; position:absolute; top:0; left:0; right:0; height:2px; background:#9fd6ff; }
.mana-mote{ position:absolute; right:6px; top:50%; margin-top:-10px; width:20px; height:20px; image-rendering:pixelated; }
.reset{ display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border-radius:999px;
  background:var(--color-surface); border:1px solid var(--color-edge); color:var(--color-dim); font-size:12px; }
.dial{ position:relative; width:20px; height:18px; overflow:hidden; flex:0 0 auto; }
.dial span{ position:absolute; left:0; right:0; text-align:center; font-size:14px; line-height:18px; transform:translateY(120%); }
.reset-lbl{ font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--color-faint); }
.reset-val{ font-family:var(--font-machine); color:var(--color-ink-2); font-variant-numeric:tabular-nums; }
</style>
```

- [ ] **Step 3: Verificar tests + typecheck + build**

Run:
```bash
cd habitat/client && npx vitest run src/composables/useUsage.test.ts && npm run typecheck && npm run build
```
Expected: tests de `useUsage` verdes (no se tocó lógica), typecheck y build pasan.

- [ ] **Step 4: Verificación visual (dev)**

Comprobar: barra de maná azul con fill según uso; dial ☀️/🌙 moviéndose con el ciclo; "próxima Xh Ym" en mono. El mote aparece cuando el uso es alto.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/UsageHud.vue
git commit -m "feat(habitat): UsageHud premium — maná arcano + dial + reset"
```

---

### Task 6: HabitatLayout.vue — shell master-detail re-estilado

**Files:**
- Modify: `habitat/client/src/components/HabitatLayout.vue` (sólo `<template>` clases + agregar `<style scoped>`)

**Interfaces:**
- Consumes: tokens de Task 1. La lógica de resize/narrow/overlay (script) **no cambia**.
- Produces: divisor, scrim y panel host re-estilados con tokens forja, preservando los breakpoints de `style.css`.

Nota: las reglas estructurales de `.hlayout` (grid wide/narrow, portrait) viven en `style.css` y se mantienen. Aquí sólo se re-estilan el **divisor** (`.hdiv`), el **scrim** y bordes, vía `<style scoped>` que pisa lo legacy por especificidad/orden.

- [ ] **Step 1: Agregar `<style scoped>` con el look forja del divisor y scrim**

Agregar al final de `HabitatLayout.vue`:
```vue
<style scoped>
.hdiv{ background:linear-gradient(90deg, transparent, rgba(224,169,75,.35)); }
.hdiv:hover{ background:linear-gradient(90deg, transparent, rgba(224,169,75,.6)); }
.scrim{ background:rgba(8,6,4,.6); }
.hpanelhost{ border-left:1px solid var(--color-edge); }
</style>
```
(No cambiar el `<template>` ni el `<script>` salvo que haga falta para que las clases existan; las clases `.hdiv/.scrim/.hpanelhost` ya están en el template actual.)

- [ ] **Step 2: Verificar typecheck + build + visual (wide y narrow)**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: pasan. Visual: probar wide (≥900px, divisor latón arrastrable) y narrow (<900px, overlay deslizante con scrim oscuro). Sin regresiones de resize.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/components/HabitatLayout.vue
git commit -m "feat(habitat): shell master-detail con divisor/scrim forja"
```

---

### Task 7: LoginView.vue — portada de la forja

**Files:**
- Modify: `habitat/client/src/components/LoginView.vue`

**Interfaces:**
- Consumes: tokens de Task 1; `useAuth().login` (sin cambios de lógica).
- Produces: pantalla de login re-vestida (wordmark Lore + card premium + inputs/botón forja).

- [ ] **Step 1: Reescribir template**

```vue
<template>
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <h1 class="wordmark">Hábita<span class="em">t</span></h1>
      <p class="sub">monitor de sesiones · Claude Code</p>
      <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus />
      <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password" />
      <button :disabled="busy" type="submit">{{ busy ? '…' : 'Entrar' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Reemplazar `<style scoped>`**

```vue
<style scoped>
.login{ display:flex; align-items:center; justify-content:center; min-height:100dvh; padding:24px; }
.card{ display:flex; flex-direction:column; gap:12px; padding:30px; min-width:300px; max-width:360px; width:100%;
  background:linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border:1px solid var(--color-edge); border-radius:18px; box-shadow:var(--shadow-sh2); }
.wordmark{ font-family:var(--font-lore); font-weight:560; font-size:34px; text-align:center; margin:0; letter-spacing:-.01em; color:var(--color-ink); }
.wordmark .em{ color:var(--color-brass); text-shadow:0 0 22px rgba(224,169,75,.45); }
.sub{ text-align:center; margin:-4px 0 8px; color:var(--color-faint); font-size:12px; letter-spacing:.02em; }
.card input{ padding:11px 13px; font:inherit; color:var(--color-ink); background:var(--color-bg);
  border:1px solid var(--color-edge); border-radius:10px; }
.card input:focus-visible{ outline:2px solid var(--color-brass); outline-offset:1px; border-color:var(--color-brass-2); }
.card button{ padding:11px; font:inherit; font-weight:600; cursor:pointer; color:#1B1308; border:1px solid #F2C97A; border-radius:10px;
  background:linear-gradient(180deg,#F0BE63,var(--color-brass-2)); box-shadow:0 1px 0 rgba(255,255,255,.3) inset; }
.card button:disabled{ opacity:.6; cursor:default; }
.card button:hover:not(:disabled){ filter:brightness(1.06); }
.err{ color:var(--color-crimson); margin:0; text-align:center; font-size:13px; }
</style>
```

- [ ] **Step 3: Verificar tests + typecheck + build**

Run:
```bash
cd habitat/client && npx vitest run src/composables/useAuth.test.ts && npm run typecheck && npm run build
```
Expected: tests de auth verdes, typecheck y build pasan.

- [ ] **Step 4: Verificación visual**

Cerrar sesión / abrir sin token → ver la portada forja (wordmark, card premium, foco latón en inputs).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/LoginView.vue
git commit -m "feat(habitat): LoginView con portada de la forja"
```

---

### Task 8: Gate de verificación de Fase 1

**Files:** ninguno (verificación + ajustes menores si algo falla).

- [ ] **Step 1: Suite completa del cliente verde**

Run:
```bash
cd habitat/client && npm test
```
Expected: todos los tests del cliente pasan (composables, stores, sprites). Si algo rojo, arreglar antes de cerrar.

- [ ] **Step 2: Typecheck + build limpios**

Run:
```bash
cd habitat/client && npm run typecheck && npm run build
```
Expected: ambos pasan; `../web` generado.

- [ ] **Step 3: Checklist visual contra el mockup**

Levantar la app (server real o `npm run dev`). Verificar, comparando con `docs/superpowers/assets/forja-mockup.html` y la demo del ciclo:
- [ ] Login forja (wordmark, card, foco latón).
- [ ] Top bar fija: wordmark + menú; HUD (sesiones / te necesitan pulsante / maná azul / reset+dial) a la derecha; "Nueva sesión".
- [ ] Fondo: cielo día/noche **cálido** de base + glows de forja; transiciona con `cyclePos`.
- [ ] Maná refleja el uso; dial ☀️/🌙 se mueve; "próxima Xh Ym" en mono.
- [ ] Shell wide (divisor latón arrastrable) y narrow (overlay + scrim).
- [ ] `prefers-reduced-motion`: sin animaciones de pulso/dial.
- [ ] El resto de la app (riel, pods, detalle) sigue funcionando con su estilo viejo (se migra en Fase 2/3).

- [ ] **Step 4: Commit de cierre (si hubo ajustes)**

```bash
git add -A && git commit -m "chore(habitat): cierre de Fase 1 — verificación fundación forja"
```

---

## Self-review (cobertura de la spec, Fase 1)

- Setup Tailwind v4 + tokens + fuentes self-hosted → Task 1. ✔
- `@layer` / tokens base → Task 1 (theme.css). ✔ (los elementos firma `<GameSprite>`/nicho/medallón se **difieren a Fase 2**, donde se consumen — evita código sin uso; nota explícita respecto a §3/§5 de la spec.)
- Top bar (AppMenu + HUD + spawn + UsageHud) → Tasks 3,4,5. ✔
- Reconciliación de fondo + re-grade STOPS cálidos → Tasks 2,3. ✔
- Shell `HabitatLayout` → Task 6. ✔
- LoginView → Task 7. ✔
- Criterio de salida Fase 1 (app levanta con shell/login/top bar, tema global, maná+reset+ciclo con data real, sin regresiones master-detail) → Task 8. ✔
- Sin placeholders; firmas de `useDayNight`/`useUsage` consistentes con el código real leído.
