# Refactor GUI "Forja cálida" — Fase 2 (Núcleo) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-vestir el núcleo visible de Hábitat (tarjeta de sesión + arena de combate + panel de detalle con terminal y loot) en la dirección "Forja cálida", con los sprites pixel integrados a la escena.

**Architecture:** Se crea `<GameSprite>`, un wrapper de `<Sprite>` que aplica la integración por **filtros CSS** (grade cálido + sombra de contacto + glow de antorcha) — animation-safe, a diferencia del rim/grade enmascarado del mockup que no sigue los frames animados. Los componentes del núcleo migran a estilos **scoped** con tokens forja; se overridean las reglas legacy de `style.css` subiendo especificidad con el selector raíz (`.pod`, `.dpanel`), sin tocar `style.css` (su limpieza es Fase 3).

**Tech Stack:** Vue 3, Tailwind v4 (tokens de Fase 1), Vitest. Depende de Fase 1 (branch `eivor`; esta fase va en `forja-fase2`).

**Spec:** `docs/superpowers/specs/2026-06-27-refactor-gui-forja-calida-design.md` (§3.1–3.3)
**Mockup aprobado (referencia visual exacta):** `docs/superpowers/assets/forja-mockup.html` · https://claude.ai/code/artifact/59810e58-2717-4218-9279-5f606a0eab62

## Global Constraints

- Trabajar en `habitat/client/`. Branch `forja-fase2`. No tocar backend/WS/hooks/lógica de combate/telemetría.
- **No romper tests** (81/81 cliente verdes). `npm run typecheck` + `npm run build` pasan por tarea.
- **No editar `style.css`** (limpieza de reglas legacy = Fase 3). Override por especificidad scoped (selector raíz `.pod`/`.dpanel` + data-v).
- Tokens de Fase 1: `var(--color-*)` (bg, surface, surface-2, raise, line, edge, edge-soft, ink, ink-2, dim, faint, brass, brass-2, ember, amber, moss, crimson, mana), `var(--font-lore|system|machine)`, `var(--radius-card|medallion)`, `var(--shadow-sh1|sh2|glow-brass)`.
- **Preservar TODA la lógica** de los componentes: combate (attacking/flinch/floats/celebrating), emote+dismiss, stamina, selección, drag, compact, terminal (xterm, copy/paste, ctx menu, canPaste), quest book / file browser, loot.
- **Sprites:** se conservan; integración por filtros (NO assets nuevos). Recorte de frames de `Sprite.vue` intacto.
- A11y: foco visible (ring latón), `prefers-reduced-motion`, contraste sobre superficies oscuras.
- Estado de sesión codificado redundante: color semántico + chip + stripe + pose del héroe. Semánticos: working=ember, waiting=amber, done=moss, error=crimson, idle/offline=faint.

---

### Task 1: `<GameSprite>` — wrapper de integración por filtros

**Files:**
- Create: `habitat/client/src/components/GameSprite.vue`
- Test: `habitat/client/src/components/GameSprite.test.ts`

**Interfaces:**
- Consumes: `Sprite.vue` (props `src`, `height`, `mode:'static'|'grid'|'strip'`, `frame?`, `dir?`, `duration?`).
- Produces: `<GameSprite>` con las MISMAS props que `<Sprite>` + `contact?: boolean` (default true). Renderiza el sprite con grade cálido + glow de antorcha (filtro) y una sombra de contacto elíptica. Forwardea `class`/`style` al elemento raíz (Vue lo hace por defecto al haber un único root con `inheritAttrs`).

- [ ] **Step 1: Escribir el test que falla**

Create `habitat/client/src/components/GameSprite.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GameSprite from './GameSprite.vue'

describe('GameSprite', () => {
  it('renderiza el Sprite base y la sombra de contacto por defecto', () => {
    const w = mount(GameSprite, { props: { src: 'x.png', height: 48, mode: 'static' } })
    expect(w.find('.gbase').exists()).toBe(true)
    expect(w.find('.gcontact').exists()).toBe(true)
  })
  it('omite la sombra de contacto con contact=false', () => {
    const w = mount(GameSprite, { props: { src: 'x.png', height: 48, mode: 'static', contact: false } })
    expect(w.find('.gcontact').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que `@vue/test-utils` está disponible; si no, instalarlo**

Run:
```bash
cd habitat/client && node -e "require.resolve('@vue/test-utils')" 2>/dev/null && echo PRESENT || npm i -D @vue/test-utils
```
Expected: imprime PRESENT, o instala `@vue/test-utils` en devDependencies. (Es la lib estándar de testeo de componentes Vue; necesaria para montar `GameSprite`.)

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/GameSprite.test.ts`
Expected: FAIL ("Cannot find module './GameSprite.vue'" o similar).

- [ ] **Step 4: Crear `GameSprite.vue`**

Create `habitat/client/src/components/GameSprite.vue`:
```vue
<script setup lang="ts">
import Sprite from './Sprite.vue'

withDefaults(defineProps<{
  src: string
  height: number
  mode: 'static' | 'grid' | 'strip'
  frame?: number
  dir?: number
  duration?: number
  contact?: boolean
}>(), { contact: true })
</script>

<template>
  <span class="gsprite">
    <Sprite
      class="gbase"
      :src="src"
      :height="height"
      :mode="mode"
      :frame="frame"
      :dir="dir"
      :duration="duration"
    />
    <span v-if="contact" class="gcontact" aria-hidden="true"></span>
  </span>
</template>

<style scoped>
.gsprite { position: relative; display: inline-block; line-height: 0; }
/* grade cálido (comparte paleta con la forja) + sombra de apoyo dura + glow de antorcha.
   Se aplica por filtro para ser animation-safe sobre el background-cropping de Sprite. */
.gbase {
  filter:
    saturate(0.82) brightness(0.96) sepia(0.2) hue-rotate(-8deg) contrast(1.04)
    drop-shadow(0 2px 0 rgba(0, 0, 0, 0.5))
    drop-shadow(0 0 5px rgba(232, 140, 70, 0.4));
}
/* sombra de contacto: apoya el sprite en el piso (lo que más quita el efecto "pegado") */
.gcontact {
  position: absolute; left: 50%; bottom: -3px; width: 84%; height: 8px; transform: translateX(-50%);
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0 42%, rgba(0,0,0,0.25) 58%, transparent 72%);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) { .gbase { filter: saturate(0.82) brightness(0.96) sepia(0.2) hue-rotate(-8deg) contrast(1.04) drop-shadow(0 2px 0 rgba(0,0,0,0.5)); } }
</style>
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd habitat/client && npx vitest run src/components/GameSprite.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: pasan.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src/components/GameSprite.vue habitat/client/src/components/GameSprite.test.ts habitat/client/package.json habitat/client/package-lock.json
git commit -m "feat(habitat): GameSprite — integración de sprites por luz y color"
```

---

### Task 2: MiniArena — usar GameSprite + re-estilo de arena

**Files:**
- Modify: `habitat/client/src/components/MiniArena.vue`

**Interfaces:**
- Consumes: `<GameSprite>` (Task 1). Toda la lógica de `MiniArena` (pose, attacking, flinch, floats, emote, dismiss, stamina) se conserva tal cual.
- Produces: la escena de combate (héroe vs monstruo) integrada, barra de vitalidad y daño flotante con look forja.

Cambios: reemplazar los dos `<Sprite>` (héroe y monstruo) por `<GameSprite>` con las mismas props, y re-estilar `.stamina-*`, `.pdmg`, `.pemote` con tokens. La integración de luz/color la aporta `<GameSprite>` (no usar `image-rendering:pixelated` en `.fighter` porque ahora es el Sprite interno quien lo maneja).

- [ ] **Step 1: Reemplazar los `<Sprite>` por `<GameSprite>` en el template**

En `MiniArena.vue`, importar `GameSprite` y reemplazar el héroe y el monstruo. El héroe conserva sus clases/estado (`fighter phero`, `flinch`); pásalas a `GameSprite` (se forwardean al root). El monstruo NO lleva sombra de contacto duplicada con el héroe — ambos `contact` por defecto está bien.

Reemplazar:
```vue
    <Sprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroSrc"
      :height="height"
      :mode="render.mode"
      :frame="heroFrame"
      :duration="render.duration ?? 900"
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
```
por:
```vue
    <GameSprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroSrc"
      :height="height"
      :mode="render.mode"
      :frame="heroFrame"
      :duration="render.duration ?? 900"
    />
    <GameSprite
      v-if="monster"
      :key="monsterUrl"
      class="fighter pmon"
      :class="{ boss: monster.isBoss }"
      :src="monsterUrl"
      :height="monH"
      :mode="monster.isBoss ? 'strip' : 'grid'"
      :dir="2"
    />
```
Y en `<script setup>` agregar el import: `import GameSprite from './GameSprite.vue'` (junto al import de `Sprite`; `Sprite` ya no se usa directamente acá, quitarlo del import si queda sin uso para no romper el lint/typecheck).

- [ ] **Step 2: Re-estilar la arena (scoped)**

En el `<style scoped>` de `MiniArena.vue`, ajustar: `.fighter` ya no necesita `image-rendering` (lo maneja el Sprite interno) — mantenerlo no rompe. Re-estilar la barra de vitalidad y el daño con tokens (reemplazar los `var(--green|gold|red|line)` viejos por `var(--color-moss|brass|crimson|line)` y la fuente por `var(--font-machine)`). Reemplazar el bloque de estilos de `.stamina-*`, `.pdmg`, `.pemote` por:
```css
.stamina-bar { position:absolute; left:4px; right:4px; bottom:1px; height:9px; display:flex; align-items:center; gap:4px; z-index:3; pointer-events:none; }
.stamina-track { flex:1; height:6px; border:1px solid var(--color-line); background:#0b0805; border-radius:3px; overflow:hidden; box-shadow:inset 0 0 0 1px rgba(0,0,0,.5); }
.stamina-fill { height:100%; transition:width .4s steps(8); }
.stamina-fill.green { background:linear-gradient(90deg,#6f9e44,var(--color-moss)); }
.stamina-fill.yellow { background:linear-gradient(90deg,#b8902a,var(--color-brass)); }
.stamina-fill.red { background:linear-gradient(90deg,#8a2f24,var(--color-crimson)); }
.stamina-pct { flex:0 0 auto; font-family:var(--font-machine); font-size:9px; line-height:1; color:var(--color-dim); }
.pdmg { position:absolute; right:18%; top:0; font-family:var(--font-machine); font-weight:600; font-size:12px; color:var(--color-amber); text-shadow:0 1px 3px #000; pointer-events:none; white-space:nowrap; animation:bdmgfloat .85s ease-out forwards; }
.pdmg.big { font-size:15px; color:#fff; }
```
Mantener el resto (`.mini`, `.pmon`, `.pemote`, `.pemote.alert`, `emoteBounce`, `.phero.flinch`) igual. (Las keyframes `bdmgfloat`/`bflinch` viven en `style.css`; no se tocan.)

- [ ] **Step 3: typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: pasan (sin "Sprite is declared but never used").

- [ ] **Step 4: Verificación visual (dev)**

Levantar la app. Con una sesión en combate: héroe vs monstruo integrados (grade cálido, sombra de contacto, glow), daño flotante ámbar, barra de vitalidad forja. Verificar que las animaciones de golpe/flinch/celebración siguen funcionando.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/MiniArena.vue
git commit -m "feat(habitat): MiniArena con GameSprite + vitalidad/daño forja"
```

---

### Task 3: SessionPod — tarjeta premium + nicho de duelo

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`

**Interfaces:**
- Consumes: `MiniArena` (Task 2), tokens. Toda la lógica (select, tint por proyecto, stamina, dismiss, compact) se conserva.
- Produces: la card de sesión con stripe de estado, nicho de duelo (la MiniArena va dentro del nicho), nombre Lore, chip, repo/branch mono, acción, "activa hace"; y la variante compact.

Estrategia de estilos: el `<style scoped>` define el look nuevo con selectores que ganan a los legacy de `style.css` por especificidad (raíz `.pod` + data-v). Valores exactos: ver `docs/superpowers/assets/forja-mockup.html` (clases `.card`, `.niche`, `.stripe`, `.vit`, `.chip`, `.nm`, `.repo`, `.act`, `.since`).

- [ ] **Step 1: Envolver la MiniArena en un nicho + estructura de card (template)**

En el template (rama `v-else`, modo normal), envolver `<MiniArena>` en un `.niche` y agregar el `.stripe`. La rama `compact` conserva su markup. Mantener todas las clases de estado (`session.status`) en el `.pod` raíz (las usan los selectores de estado). Cambiar `<div class="ring"></div>` por el stripe (el ring legacy se reemplaza). Markup objetivo del modo normal:
```vue
    <div class="stripe" aria-hidden="true"></div>
    <template v-else>
      <div class="niche" :class="{ boss: session.monster?.isBoss }">
        <MiniArena :session="session" :height="56" />
      </div>
      <div class="meta">
        <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
        <div class="action">{{ session.action }}</div>
        <div class="since">activa hace {{ ago(session.since) }}</div>
      </div>
    </template>
```
(Quitar el `<div class="ring"></div>` y el texto en mayúsculas "ACTIVA HACE" → "activa hace". El `.stripe` va una vez, fuera de los `<template v-if/v-else>`, como primer hijo del `.pod`.)

- [ ] **Step 2: Estilos scoped de la card + nicho (ganan a legacy)**

Agregar `<style scoped>` a `SessionPod.vue` con el look forja (lift del mockup, tokens). Incluir al menos: `.pod` (card: radius, gradiente surface, borde edge, sombra sh1, hover, selected con glow-brass), `.pod .stripe` + variantes por estado (`.pod.working .stripe` ember, waiting amber, done moss, error crimson, idle/offline faint), `.pod .niche` (fondo recesado con glow de antorcha inferior + `--shadow` interior; variante `.boss` carmesí), `.pod .meta/.name/.repo/.action/.since`, `.pod .chip` + variantes de estado, y la variante `.pod.compact` (face-mini enmarcada, stam-dot). Usar `var(--font-lore)` para `.name`, `var(--font-machine)` para `.repo`/`.since`, `var(--font-system)` para `.action`/`.chip`. Sombras/colores exactos: mockup. Para ganar a `style.css` (`.pod.working .ring` etc. = 0-3-0) los selectores scoped equivalentes (`.pod.working .stripe` = 0-3-0 + data-v = 0-4-0) ya ganan; el `.ring` legacy queda sin elemento (eliminado del template) → inerte.

- [ ] **Step 3: typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: pasan.

- [ ] **Step 4: Verificación visual (dev)**

Riel de sesiones: cards premium con stripe de estado, nicho con sprites integrados, nombre serif, chip, repo mono, acción. Probar estados working/waiting/done/idle/offline y boss; modo compact (toggle ▭). Drag & drop sigue andando; selección marca con glow latón.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue
git commit -m "feat(habitat): SessionPod — card premium + nicho de duelo"
```

---

### Task 4: DetailPanel — medallón + terminal + loot toast

**Files:**
- Modify: `habitat/client/src/components/DetailPanel.vue`

**Interfaces:**
- Consumes: tokens, `QuestBook`, `FileBrowser`. Toda la lógica (terminal/xterm, copy/paste, ctx menu, canPaste, loot, kill, tints) se conserva.
- Produces: header con medallón de latón (retrato), nombre Lore, chip, repo/branch mono, acción, since, tools (Quest Book con book.png, **Archivos con `Bag.png`**, Cerrar); terminal con barra de título; loot como toast premium; ctx menu re-estilado.

Notas: el retrato es la cara (`faceFor`), no un spritesheet — va en un medallón (marco latón + remaches + pozo recortado redondeado que suaviza las esquinas del sprite). Quitar la clase `crt` del `.dhead` (sin scanlines en forja). Valores exactos del medallón/terminal/loot/tools: `docs/superpowers/assets/forja-mockup.html` (clases `.portrait/.well/.rivet`, `.dhead/.dname/.dmeta/.dact/.dsince`, `.tool`, `.term/.term-bar/.term-body`, `.loot`).

- [ ] **Step 1: Reestructurar el header (template): medallón + tools**

Reemplazar el `<div class="dhead crt" ...>` por la versión forja: medallón con la cara, info (nombre + chip + repo/branch + acción + since), y los tools como botones `.tool`. El botón de Archivos usa `Bag.png` (`/assets/items/...`? — usar el asset ya disponible: ver paso siguiente). Mantener los handlers (`filesOpen`, `bookOpen`, `closeSession`) y `v-if="canSpawn"` en Cerrar. Markup objetivo:
```vue
      <div class="dhead" :style="headTint">
        <div class="portrait">
          <i class="rivet tl"></i><i class="rivet tr"></i><i class="rivet bl"></i><i class="rivet br"></i>
          <div class="well"><img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" /></div>
        </div>
        <div class="dinfo">
          <div class="dname">{{ store.selected.name }} <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span></div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
          <div class="action">{{ store.selected.action }}</div>
          <div class="since">activa hace {{ ago(store.selected.since) }}</div>
        </div>
        <div class="dtools">
          <button class="tool" @click="bookOpen = !bookOpen" title="Quest Book"><img src="/assets/ui/book.png" alt="" />Quest Book</button>
          <button class="tool" @click="filesOpen = !filesOpen" title="Archivos"><img :src="bagSrc" alt="" />Archivos</button>
          <button v-if="canSpawn" class="tool danger" @click="closeSession">✕ Cerrar</button>
        </div>
      </div>
```

- [ ] **Step 2: Asegurar el asset del bolso para Archivos**

`Bag.png` (16×16) está en el pack pero no en `public/assets`. Copiarlo a `public/assets/ui/bag.png` y referenciarlo. Run:
```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/eivor
cp "Ninja Adventure - Asset Pack/Items/Object/Bag.png" habitat/client/public/assets/ui/bag.png
ls -la habitat/client/public/assets/ui/bag.png
```
Y en `<script setup>` definir: `const bagSrc = '/assets/ui/bag.png'` (o usar la ruta literal en el template). Expected: el archivo existe (~360 bytes).

- [ ] **Step 3: Terminal con barra de título + loot toast + ctx menu (template)**

Envolver `.term` en un contenedor con barra de título (proyecto · branch · "en vivo"). Reemplazar el `.dloot` viejo por el toast premium (cofre `chest.png` + título Lore + HP/golpes + loot). Mantener el `ref="termEl"` en el div de la terminal real (xterm se monta ahí) y el `@contextmenu.prevent="openMenu"`. Mantener el `ctxmenu`/`menu-backdrop` y sus handlers (`menuCopy`/`menuPaste`/`canPaste`). Estructura objetivo:
```vue
      <div class="term">
        <div class="term-bar">
          <span class="tt"><b>{{ store.selected.project }}</b><span v-if="store.selected.branch"> · {{ store.selected.branch }}</span> · tmux</span>
          <span class="live"><span class="d"></span> en vivo</span>
        </div>
        <div ref="termEl" class="term-body" aria-label="terminal de la sesión" @contextmenu.prevent="openMenu"></div>
      </div>
```
(El `ref="termEl"` se mueve al `.term-body` interior. `useTerminal` usa ese ref para montar xterm y `fit()`; sigue siendo el contenedor real de la terminal.)

Loot toast objetivo (reemplaza `.dloot`):
```vue
      <div class="loot" :class="{ show: lootShown }" v-if="loot">
        <img src="/assets/ui/chest.png" alt="" />
        <div><div class="lt">★ Vencido — {{ loot.monster }}</div><div class="ls">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div></div>
        <div class="lf"><span>loot:</span> {{ loot.loot.join(' · ') }}</div>
      </div>
```

- [ ] **Step 4: Estilos scoped forja (medallón, header, terminal, loot, tools, ctx menu)**

Reemplazar el `<style scoped>` actual por el look forja (lift del mockup, tokens). Cubrir: `.dpanel` (layout flex columna, padding), `.dhead` (card surface), `.portrait/.well/.rivet/.face` (medallón: marco latón gradiente + remaches + pozo `overflow:hidden` redondeado; `.face` con `border-radius` para suavizar esquinas; sin `crt`), `.dinfo/.dname/.repo/.action/.since` (Lore/mono/system), `.dtools/.tool/.tool.danger`, `.term/.term-bar/.term-body` (terminal como superficie protagonista; `.term-body` es donde monta xterm: fondo `#0E0A06`, padding, sin scanlines), `.loot` (toast: gradiente + borde latón, `.lt` Lore, `.ls`/`.lf` mono) con `.loot.show` animando `bfadein` (keyframe en style.css). Para ganar a legacy `.dpanel .face`/`.term`/`.dloot` (0-2-0) basta el scoped (0-2-0 + data-v = 0-3-0). El `.dpanel { position:relative }` y los estilos de `.ctxmenu`/`.killsession` viejos se reemplazan por las versiones con tokens.

- [ ] **Step 5: typecheck + build + tests de terminal**

Run:
```bash
cd habitat/client && npx vitest run src/composables/useTerminal.test.ts && npm run typecheck && npm run build
```
Expected: useTerminal verde (no se tocó lógica), typecheck + build pasan.

- [ ] **Step 6: Verificación visual (dev)**

Seleccionar una sesión: header con medallón (cara enmarcada, esquinas suaves), terminal con barra de título y contenido xterm real (tipear/scroll), copy/paste por click derecho, Quest Book y Archivos (ícono bolso) abren sus overlays, Cerrar pide confirmación. Provocar un loot → toast premium. Probar narrow (overlay) y wide.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src/components/DetailPanel.vue habitat/client/public/assets/ui/bag.png
git commit -m "feat(habitat): DetailPanel — medallón + terminal + loot toast forja"
```

---

### Task 5: Gate de verificación de Fase 2

**Files:** ninguno (verificación + ajustes menores si algo falla).

- [ ] **Step 1: Suite completa del cliente verde**

Run: `cd habitat/client && npm test`
Expected: todos los tests verdes (incluye el nuevo `GameSprite.test.ts`). Si algo rojo, arreglar antes de cerrar.

- [ ] **Step 2: typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build`
Expected: ambos pasan.

- [ ] **Step 3: Checklist visual contra el mockup**

Levantar la app y comparar con `docs/superpowers/assets/forja-mockup.html`:
- [ ] Cards de sesión: stripe de estado, nicho con sprites integrados (grade/contacto/glow), nombre Lore, chip, repo mono, acción, "activa hace". Estados working/waiting/done/idle/offline + boss.
- [ ] Modo compact: face-mini enmarcada + stam-dot.
- [ ] Combate: daño flotante, vitalidad, emote+dismiss, animaciones (golpe/flinch/celebración).
- [ ] Detalle: medallón (esquinas suaves), terminal con barra de título funcionando (xterm, copy/paste, ctx menu), Quest Book / Archivos (bolso) / Cerrar, loot toast.
- [ ] `prefers-reduced-motion`: sin animaciones; foco latón visible; narrow/wide OK.

- [ ] **Step 4: Commit de cierre (si hubo ajustes)**

```bash
git add -A && git commit -m "chore(habitat): cierre de Fase 2 — verificación núcleo forja"
```

---

## Self-review (cobertura de la spec, Fase 2)

- §3.1 Integración de sprites (`<GameSprite>`) → Task 1, aplicado en Tasks 2/3. ✔ (nota: integración por filtros, animation-safe, en vez del rim/grade enmascarado del mockup — mismo look.)
- §3.2 Nicho de duelo → Task 3. ✔
- §3.3 Medallón de retrato → Task 4. ✔
- §4 Componentes núcleo (SessionPod, MiniArena, Sprite/GameSprite, DetailPanel) → Tasks 1–4. ✔
- §5 Fase 2 criterio de salida (pantalla principal con data real: combate, estados, loot, terminal, copy/paste) → Task 5. ✔
- Sin placeholders; firmas de `Sprite`/`MiniArena`/`useTerminal` consistentes con el código real leído. No edita `style.css` (Fase 3).
