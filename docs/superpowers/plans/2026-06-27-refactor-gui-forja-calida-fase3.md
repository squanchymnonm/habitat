# Refactor GUI "Forja cálida" — Fase 3 (Secundarias + limpieza) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar el refactor: re-vestir las superficies secundarias (Settings, Proyectos, Nueva sesión, Quest Book, Archivos) en "Forja cálida" y limpiar el `style.css` legacy ya huérfano (más el ajuste de padding del riel y el quite de scanlines CRT).

**Architecture:** Cada componente ya tiene estilos `scoped`; se migran sus colores/fuentes/sombras de los tokens legacy a los tokens forja de Fase 1, adoptando los patrones premium ya establecidos (cards, chips, botones tipo `.tool`/`.mi`). Una vez migrado todo, una tarea final **elimina** del `style.css` los bloques que ya nadie usa y corrige el padding del riel.

**Tech Stack:** Vue 3, Tailwind v4 (tokens de Fase 1), Vitest. Va en `forja-fase3` (stack sobre `forja-fase2`/#56).

**Spec:** `docs/superpowers/specs/2026-06-27-refactor-gui-forja-calida-design.md` (§4 tabla, §5 Fase 3)
**Referencia visual del lenguaje:** `docs/superpowers/assets/forja-mockup.html` (botones `.tool`, chips, superficies).

## Global Constraints

- Trabajar en `habitat/client/`. Branch `forja-fase3`. No tocar backend/WS/hooks/lógica.
- **No romper tests** (83/83). `npm run typecheck` + `npm run build` pasan por tarea.
- Mantener TODA la lógica de cada componente (handlers, props, emits, watchers, estado).
- A11y: foco visible (`:focus-visible` ring `var(--color-brass)`), `prefers-reduced-motion`.
- **Tabla de mapeo de tokens legacy → forja** (usar en TODAS las tareas de componente):

  | legacy | forja |
  |---|---|
  | `--surface` (card) | `--color-surface-2` |
  | `--surface2` | `--color-raise` |
  | `--gold` | `--color-brass` |
  | `--coral` | `--color-amber` |
  | `--teal` | `--color-ember` |
  | `--green` | `--color-moss` |
  | `--red` | `--color-crimson` |
  | `--ink` | `--color-ink` |
  | `--dim` | `--color-dim` |
  | `--soft` / `--line` (bordes) | `--color-edge` |
  | `--f-logo` (títulos) | `--font-lore` |
  | `--f-ui` / `--f-body` (UI/texto) | `--font-system` |
  | rutas / números / código | `--font-machine` |
  | `--bevel` / sombras pixel `Npx Npx 0` | `--shadow-sh1` / `--shadow-sh2` |
  | glows `--glow-*` | `--shadow-glow-brass` |

- **Patrón de botón premium** (reutilizar el de Fase 1/2): fondo `var(--color-surface-2)`, borde `1px solid var(--color-edge)`, `border-radius: 9px`, hover → `border-color: var(--color-brass-2); color: var(--color-brass)`. Botón primario: gradiente latón (`linear-gradient(180deg,#F0BE63,var(--color-brass-2))`, texto `#1B1308`). Overlay/dialog: fondo `var(--color-surface)`/`surface-2`, borde `var(--color-edge)`, `border-radius: 14px`, `box-shadow: var(--shadow-sh2)`.
- **NO eliminar `style.css` en las tareas 1–5** (la limpieza es la Task 6, después de migrar todo). Hasta entonces conviven.

---

### Task 1: SettingsView — forja + crédito de sprites

**Files:** Modify: `habitat/client/src/components/SettingsView.vue`

- [ ] **Step 1: Migrar el `<style scoped>` a tokens forja**

Reemplazar los tokens legacy del `<style scoped>` según la tabla: `h2` → `var(--font-lore)`; labels → `var(--font-system)` `var(--color-dim)`; `select` → fondo `var(--color-bg)`, borde `var(--color-edge)`, texto `var(--color-ink)`, foco `:focus-visible{outline:2px solid var(--color-brass)}`; `.desc` → `var(--color-dim)`; `.err` → `var(--color-crimson)`. Quitar el `padding-top: 52px` de `.settings` (ya no hay HUD flotante; usar `padding: clamp(18px,3.5vw,38px)`).

- [ ] **Step 2: Mover el crédito de sprites acá (se quitó el footer global en Fase 1)**

En el `<template>`, al final de la `<section class="settings">`, agregar:
```vue
    <p class="credit">Sprites: Ninja Adventure — Pixel-Boy / AAA · CC0</p>
```
Y en scoped: `.credit { margin-top: 28px; color: var(--color-faint); font-family: var(--font-machine); font-size: 11px; }`

- [ ] **Step 3: typecheck + build**

Run: `cd habitat/client && npm run typecheck && npm run build` — Expected: pasan.

- [ ] **Step 4: Commit**
```bash
git add habitat/client/src/components/SettingsView.vue
git commit -m "feat(habitat): SettingsView forja + crédito de sprites"
```

---

### Task 2: ProjectsManager — forja + botones premium

**Files:** Modify: `habitat/client/src/components/ProjectsManager.vue`

- [ ] **Step 1: Quitar dependencia de `.ctl` y migrar estilos**

El template usa `class="ctl"` en varios botones (Agregar, quitar, Agregar/cancelar, cerrar). Cambiar esas clases por una clase propia `.btn` (mantener clases adicionales como `del`/`close`) y definir `.btn` en el scoped con el patrón de botón premium (ver Global Constraints). Migrar el resto del `<style scoped>` a tokens forja según la tabla: `h3` → `var(--font-lore)`; `.plabel` → `var(--font-system)` bold; `.pdir` → `var(--font-machine)` `var(--color-dim)`; `.swatch.on` outline `var(--color-brass)`; `.browser`/`.crumb`/`.charbtn` bordes `var(--color-edge)`, fondos `var(--color-surface-2)`; `.charbtn.on` → fondo `var(--color-brass)` texto `#1B1308`; `.enter .repo` (git tag) → `var(--color-brass)` + `var(--font-machine)`; `.err` → `var(--color-crimson)`.

- [ ] **Step 2: typecheck + build** — `cd habitat/client && npm run typecheck && npm run build` (pasan).

- [ ] **Step 3: Commit**
```bash
git add habitat/client/src/components/ProjectsManager.vue
git commit -m "feat(habitat): ProjectsManager forja (botones premium, sin .ctl)"
```

---

### Task 3: SpawnMenu — forja + estilos propios (sin globals legacy)

**Files:** Modify: `habitat/client/src/components/SpawnMenu.vue`

SpawnMenu depende de reglas GLOBALES de `style.css` (`.spawn`, `.spawn-menu`, `.spawn-item`, `.spawn-input`) y de `.ctl`. Esta tarea las internaliza como scoped para que SpawnMenu sea autosuficiente (y la Task 6 pueda borrarlas del global).

- [ ] **Step 1: Internalizar los estilos del menú + botones en scoped**

Agregar al `<style scoped>` de SpawnMenu reglas propias para `.spawn` (`position:relative`), `.spawn-menu` (dropdown premium: `position:absolute; top:calc(100% + 8px); right:0; z-index:10; background:var(--color-surface); border:1px solid var(--color-edge); border-radius:14px; box-shadow:var(--shadow-sh2); padding:8px; display:flex; flex-direction:column; gap:6px; min-width:200px`), `.spawn-item`/`.spawn-back`/`.spawn-create`/`.spawn-auto` (clase de botón premium — definir `.spawn-menu button` o una clase `.sbtn` con el patrón premium, y reemplazar `ctl` por esa clase en el template), `.spawn-input` (`width:100%; box-sizing:border-box; padding:9px 11px; background:var(--color-bg); border:1px solid var(--color-edge); border-radius:8px; color:var(--color-ink)` + `:focus-visible` brass), `.spawn-err` → `var(--color-crimson)` `var(--font-system)`. Migrar también los hexes existentes de `.spawn-char`/`.spawn-add` a tokens (`.spawn-char` borde `var(--color-edge)`, hover/sel `var(--color-brass-2)`; `.spawn-add` mantener su rojo o pasar a `var(--color-crimson)`). Quitar `class="ctl"` de los botones del template (usar la clase premium propia).

- [ ] **Step 2: typecheck + build** — pasan.

- [ ] **Step 3: Commit**
```bash
git add habitat/client/src/components/SpawnMenu.vue
git commit -m "feat(habitat): SpawnMenu forja autosuficiente (estilos scoped propios)"
```

---

### Task 4: QuestBook — forja

**Files:** Modify: `habitat/client/src/components/QuestBook.vue`

- [ ] **Step 1: Migrar tokens del `<style scoped>`**

Reemplazar según la tabla, conservando estructura/animaciones: `--surface`→`--color-surface-2`; `--soft`/`--line`→`--color-edge`; `--gold`→`--color-brass` (kicker, label, bar-fill, focus rings, `.qb-ex-you-text` queda `--color-moss`); `--coral`→`--color-amber` (`.qb-loot`, `.in_progress`); `--green`→`--color-moss`; `--ink`→`--color-ink`; `--dim`→`--color-dim`; `--bevel`→`--shadow-sh1`; `--glow-gold`→`--shadow-glow-brass`; `--f-ui`→`--font-system`; `--f-body`→`--font-system`; `.qb-syn` (título) → `var(--font-lore)`. La barra de progreso `.qb-bar-fill`: `linear-gradient(90deg, var(--color-brass), var(--color-amber))`.

- [ ] **Step 2: typecheck + build** — pasan.

- [ ] **Step 3: Commit**
```bash
git add habitat/client/src/components/QuestBook.vue
git commit -m "feat(habitat): QuestBook forja"
```

---

### Task 5: FileBrowser — forja

**Files:** Modify: `habitat/client/src/components/FileBrowser.vue`

- [ ] **Step 1: Migrar el `<style scoped>` a tokens forja**

Reemplazar los hexes hardcodeados y `var(--surface,...)` por tokens: `.fb-panel` fondo `var(--color-surface-2)`, borde `var(--color-edge)`, `border-radius:14px`, `box-shadow:var(--shadow-sh2)`, texto `var(--color-ink-2)`; `.fb-head`/`.fb-foot` borde `var(--color-edge)`; `.fb-kicker` `var(--color-dim)`; `.fb-crumb` `var(--color-brass)` + `var(--font-machine)`; `.fb-item:hover` `rgba(255,255,255,.05)`; `.fb-name` `var(--font-machine)` (rutas); `.fb-size`/`.fb-empty`/`.fb-state` `var(--color-faint)`; `.fb-upload` botón premium (patrón); `.fb-uperr` `var(--color-crimson)`; `.fb-close` foco brass. Nombres de archivo/rutas en `var(--font-machine)`.

- [ ] **Step 2: typecheck + build** — pasan.

- [ ] **Step 3: Commit**
```bash
git add habitat/client/src/components/FileBrowser.vue
git commit -m "feat(habitat): FileBrowser forja"
```

---

### Task 6: Limpieza de `style.css` + padding del riel + sin CRT

**Files:**
- Modify: `habitat/client/src/style.css`
- Modify: `habitat/client/src/components/HabitatLayout.vue` (quitar la clase `crt` del rail)

Ahora que TODOS los componentes están migrados a scoped, estos bloques globales quedaron huérfanos y se eliminan. **Eliminar SOLO estos** (verificando antes con grep que ninguna `*.vue` los referencia):

- [ ] **Step 1: Verificar que están huérfanos**

Run (cada grep debe dar 0 usos en `src/components` y `App.vue`, salvo lo indicado):
```bash
cd habitat/client/src
for c in brand demo-badge hud-stack stats-hud usage-hud mana-box mana-lbl mana-track mana-fill usage-mote time-lbl time-val "\.dn" controls "\.ctl" "spawn-menu" "spawn-item" "spawn-input" "spawn-err" "\.spawn\b" app-menu-root hamburger "app-menu" "\.dpanel" "\.dloot" "\.face\b" footer; do
  n=$(grep -rl --include=*.vue "$c" . | grep -v 'style.css' | wc -l); echo "$c -> $n vue files";
done
```
Expected: 0 para todos. (`.crt` aparecerá 1 vez en HabitatLayout hasta el Step 3; `.rail`/`.empty`/`.pod-ghost`/`.term`/`.chip` NO se borran — ver abajo.)

- [ ] **Step 2: Eliminar de `style.css` los bloques huérfanos**

Borrar estos bloques (con sus comentarios): `.brand`/`.brand b`/`.brand .dot`/`.brand small` (41–44); `.demo-badge` (45); `.hud-stack` (47); `.stats-hud`+`.stats-hud b`+`.stats-hud .need` (48–54); todo el bloque "HUD de uso" `.usage-hud`…`.dn span`+`@keyframes emoteBounce` (56–72); `.controls` (74); `button.ctl` + estados (75–80); todo el bloque `.pod`…`.since` y compact y `.stam*` (87–137) — **incluye** `.meta/.name/.chip*/.repo/.action/.since/.pod.compact*/.face-mini/.pod.selected::after/.pod .ring/.pod.working…/.pod.offline`; `footer` (141); `.crt`+`.crt::after` (37–39); el bloque "MENÚ DE NUEVA SESIÓN" `.spawn`…`.spawn-input` (175–182); el bloque "Menú hamburguesa" `.app-menu-root`/`.hamburger`/`.app-menu`/`.app-menu > .ctl` (184–191); el bloque "PANEL DE DETALLE" `.dpanel`…`.dloot .lootline` (193–211).

  **CONSERVAR** (siguen en uso): `:root` (tokens legacy aún referenciados por reglas que quedan), `*`/`html,body`/`#app`/`body` (reset+fondo), `.sky-ambient` (App.vue lo usa de base — pero ver nota), `@keyframes needblink`? (era de `.pod.waiting .ring` → ahora huérfano: borrarlo con el bloque pod), `@media prefers-reduced-motion *` (global), `@keyframes bdmgfloat/bflinch/bfadein` (MiniArena/DetailPanel scoped los usan), TODO el bloque "SHELL MASTER-DETAIL" `.hlayout`…`.scrim.open` (HabitatLayout), `.rail`+`.rail > .pod` (SessionRail — ver Step 4), `.empty`+`.empty code` (SessionRail — migrar tokens, ver Step 4), `.pod-ghost` (vuedraggable ghost-class — conservar, cambiar `--gold`→`--color-brass`).

  Nota `.sky-ambient`: hay una definición global (z-index:-1) y otra en App.vue scoped (z-index:-2). App.vue gana. Dejar la global como está (no molesta) o borrarla; si se borra, confirmar que App.vue define todo lo necesario. Por seguridad, **dejarla**.

- [ ] **Step 3: Quitar las scanlines CRT del riel**

En `habitat/client/src/components/HabitatLayout.vue`, en el template, cambiar `<SessionRail class="hrail crt" />` por `<SessionRail class="hrail" />` (quitar `crt`). (El bloque `.crt` ya se borró en Step 2.)

- [ ] **Step 4: Corregir el padding del riel y los tokens de `.rail`/`.empty`/`.pod-ghost`**

En `style.css`: `.rail{...padding:52px 14px 14px...}` → `padding:14px 14px 18px` (el top bar ahora ocupa flujo; ya no hace falta el colchón de 52px). En `.empty`: `--soft`→`var(--color-edge)`, `--dim`→`var(--color-dim)`, `--gold`→`var(--color-brass)`, `--f-body`→`var(--font-system)`. En `.pod-ghost`: `--gold`→`var(--color-brass)`.

- [ ] **Step 5: typecheck + build + suite**

Run: `cd habitat/client && npm run typecheck && npm run build && npx vitest run` — Expected: todo pasa (83/83).

- [ ] **Step 6: Commit**
```bash
git add habitat/client/src/style.css habitat/client/src/components/HabitatLayout.vue
git commit -m "chore(habitat): limpieza de style.css legacy + padding riel + sin CRT"
```

---

### Task 7: Gate de verificación de Fase 3

**Files:** ninguno (verificación + ajustes si algo falla).

- [ ] **Step 1: Suite + typecheck + build**

Run: `cd habitat/client && npm test && npm run typecheck && npm run build` — Expected: 83/83 verde; typecheck + build OK.

- [ ] **Step 2: No quedan referencias rotas a tokens legacy borrados**

Run:
```bash
cd habitat/client/src
echo "componentes que aún usan tokens legacy (deberían ser 0 salvo style.css):"
grep -rl --include=*.vue -E "var\(--(gold|coral|teal|green|red|soft|f-ui|f-body|f-logo|bevel|glow-)" . || echo "  ninguno ✓"
```
Expected: ninguno (o solo usos intencionales documentados).

- [ ] **Step 3: Checklist visual (dev)**

Levantar la app y recorrer: Settings (forja + crédito), Proyectos (alta/colores/quitar), Nueva sesión (menú 2 pasos), Quest Book (abrir desde detalle, progreso/quests/diálogo), Archivos (navegar/subir). Riel sin scanlines y sin gap extra arriba. Estados, narrow/wide, foco latón, reduced-motion.

- [ ] **Step 4: Commit de cierre (si hubo ajustes)**
```bash
git add -A && git commit -m "chore(habitat): cierre de Fase 3 — verificación secundarias forja"
```

---

## Self-review (cobertura de la spec, Fase 3)

- §4: SettingsView (Task 1), ProjectsManager (Task 2), SpawnMenu (Task 3), QuestBook (Task 4), FileBrowser (Task 5). ✔
- §5 Fase 3 criterio de salida (todas las superficies re-vestidas; nada con estilo viejo) → Tasks 1–6. ✔
- Limpieza de `style.css` huérfano + padding riel + CRT (notas de Fase 1/2) → Task 6. ✔
- Verificación final → Task 7. ✔
- Sin placeholders; mapeo de tokens explícito; se conserva lógica y reglas aún en uso (shell, rail, empty, pod-ghost, keyframes de combate).
