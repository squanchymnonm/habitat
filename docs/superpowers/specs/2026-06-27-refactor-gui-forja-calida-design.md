# Refactor total de la GUI — dirección "Forja cálida"

**Fecha:** 2026-06-27
**Estado:** diseño aprobado (visual), pendiente revisión de spec
**Mockup de referencia:** https://claude.ai/code/artifact/59810e58-2717-4218-9279-5f606a0eab62

## 1. Objetivo

Refactor visual total del front de Hábitat: pasar de la estética pixel-art / CRT
actual a un **dark premium "forja cálida"** (negros cálidos, latón, brasa,
tipografía editorial), **conservando intacta la metáfora de juego** (arena,
monstruo = TODO en curso, daño = tokens del paso, loot = archivos tocados,
vitalidad = context restante) y **conservando los sprites pixel** del pack Ninja
Adventure, ahora integrados a la escena.

No cambia el backend, ni el protocolo WS, ni los hooks, ni la lógica de combate.
Es un refactor de **presentación**: estilos, tokens, estructura de componentes de
presentación. La data y los stores se tocan lo mínimo indispensable.

### Decisiones tomadas (brainstorming)

| Eje | Decisión |
|-----|----------|
| Dirección | Modernizar premium, familia **"Forja cálida"** (warm dark + latón/brasa, tipo editorial) |
| Metáfora RPG | **Se mantiene** el concepto (arena/monstruo/daño/loot/vitalidad); cambia el "vestido" |
| Sprites | **Se conservan** los del pack; se integran por **luz y color** (grade cálido + sombra de contacto + rim-light enmascarado) |
| Técnica | **Introducir Tailwind** (theme custom "forja cálida"); CSS custom para los elementos firma |
| Alcance | **Por fases** (fundación → núcleo → secundarias) |

## 2. Sistema de diseño (tokens)

Fuente de verdad: el theme de Tailwind. Tailwind v4 (config CSS-first con `@theme`)
o v3 (`tailwind.config.js`) — a definir en el plan; el set de tokens es el mismo.

### Color

```
ground      bg #14100B   surface #1C160F   surface-2 #251D14   raise #2C2217
estructura  line #0C0805   edge #3A2C1B   edge-soft #4A3722
texto       ink #F3E9D6   ink-2 #E4D4B4   dim #AE997A   faint #7E6E54
acento      brass #E0A94B   brass-2 #C98A33
semánticos  ember #E8773A (working)   amber #F2C94C (waiting)
            moss #8FB85C (done)   crimson #D14B3C (error)
            faint (idle/offline)
arcano      mana #3FA8FF (uso global de Claude) — acento FRÍO deliberado
```

El **maná** es lo único frío de la paleta: contrasta a propósito con la forja
("magia fría" sobre metal caliente) y distingue el recurso global del de sesión.

Los **semánticos de estado** son independientes del acento latón. El estado de una
sesión se codifica de forma redundante: color + chip de texto + stripe lateral +
(en arena) pose del héroe.

### Tipografía — tres voces

Fuentes **self-hosted** (woff2 latin), sin CDN. Ya descargadas para el mockup.

- **Lore** — `Fraunces` (serif, opsz alto, ~560): wordmark, nombres de sesión,
  títulos de loot. Uso con moderación.
- **Sistema** — `Hanken Grotesk` (sans): toda la UI funcional, chips, labels, body.
- **Máquina** — `JetBrains Mono`: repos, ramas, tokens, timers, terminal, números
  (con `font-variant-numeric: tabular-nums`).

### Otros tokens

```
radios   sm 9px   md 14px   (medallón 18px)
sombras  sh-1 (sutil)   sh-2 (elevada)   glow-brass   glow-ember
niche    inset shadow recesado (vitrina)
motion   transición 120-150ms; respeta prefers-reduced-motion
```

## 3. Elementos "firma" (CSS custom, no Tailwind)

Tailwind cubre layout/spacing/tipo/color del chrome. Estos elementos van en CSS
custom (componente o `@layer components`):

### 3.1 Integración de sprites ("por luz y color")

Componente reutilizable `<GameSprite>` que reemplaza el uso directo de `<img>`/
`<Sprite>` en superficies premium. Capas:

1. **base**: el sprite (frame recortado), `image-rendering: pixelated`, con
   filtro de **grade cálido**: `saturate(.8) brightness(.95) sepia(.24)
   hue-rotate(-8deg) contrast(1.04)` + drop-shadow dura de apoyo.
2. **grade** (capa enmascarada con la silueta del sprite, `mix-blend-mode: overlay`):
   funde la paleta del sprite con el ámbar de la escena.
3. **rim** (capa enmascarada, `mix-blend-mode: screen`): borde superior iluminado
   tipo antorcha.
4. **contact**: elipse de sombra dura bajo el sprite → lo apoya en el piso (esto es
   lo que más elimina el efecto "pegado").

El recorte de frame del spritesheet (hoy en `Sprite.vue`) se mantiene: monstruos
grilla 4×4 (`dir`), bosses strip, héroes `anim_combat`/`idle`. `<GameSprite>`
envuelve a `<Sprite>` o asume su rol.

### 3.2 Nicho de duelo

La escena de combate de cada card: fondo recesado (vitrina) con glow de antorcha
inferior, héroe vs monstruo integrados, daño flotante, barra de vitalidad. Variante
`boss` (tinte carmesí, sprite más grande).

### 3.3 Medallón de retrato

El retrato del héroe en el panel de detalle: marco de latón biselado + remaches en
las esquinas + pozo recortado redondeado que **suaviza las esquinas duras** del
sprite (la cara va con `border-radius` y el contenedor con `overflow:hidden` para
recortar base+rim+grade juntos).

### 3.4 Recursos globales: maná, ciclo día/noche y reset (uso de Claude)

Elementos ya existentes en `main` (composables `useUsage` / `useDayNight`,
componente `UsageHud`). **No cambia su lógica**; sólo su presentación, y se integran
a la top bar.

- **Maná** (`UsageHud .mana-box`): medidor del uso global de Claude restante
  (`mana = 100 − usage.pct`) en la ventana de 5h. Barra **arcana azul** (acento
  frío) con label "Maná" y un **mote** (emote pixel) que aparece cuando queda poco
  (≥75% usado → 21; ≥90% → 22). Vive en la top bar, separado visualmente de la
  vitalidad por sesión.
- **Ciclo día/noche** (`App.vue .sky-ambient` + `useDayNight.skyGradient`): fondo
  ambiental a pantalla completa cuyo gradiente avanza con `cyclePos`
  (amanecer→día→atardecer→noche) según cuán avanzada esté la ventana de 5h.
- **Dial ☀️/🌙 + reset** (`UsageHud .time-box`): dial vertical sol/luna que sigue
  `cyclePos`, "próxima" y `resetLabel` (countdown al reset). Tipo **Máquina** mono
  con `tabular-nums`.

**Reconciliación de fondo (clave):** hoy el refactor usa un fondo cálido fijo; debe
**convivir** con `.sky-ambient`. Modelo:
1. `.sky-ambient` (día/noche) es la **base** ambiental (`z-index:-1`).
2. La **calidez de forja** pasa a ser capa superior: viñeta + glows radiales de
   brasa/latón en los bordes (no un fondo opaco que tape el cielo).
3. Re-gradar los `STOPS` de `useDayNight` hacia **cálido/forja** (manteniendo el
   arco amanecer→noche) para que el ciclo no rompa la dirección. Cambio acotado a
   las constantes de color de `useDayNight.ts`.

## 4. Cambios por componente

Estructura actual: `App.vue`, `HabitatLayout`, `SessionRail`, `SessionPod`,
`MiniArena`, `Sprite`, `DetailPanel`, `QuestBook`, `FileBrowser`, `SpawnMenu`,
`AppMenu`, `ProjectsManager`, `SettingsView`, `LoginView`, `style.css`.

| Componente | Cambio |
|------------|--------|
| `style.css` | Se reemplaza por: entry de Tailwind + tokens + `@layer` para elementos firma. Se retiran scanlines CRT, bevels pixel, glows neón. |
| `App.vue` | `hud-stack` (stats + UsageHud) + footer → integrados a una **top bar** real. Mantiene `.sky-ambient` (día/noche) como base de fondo. |
| `AppMenu` | Pasa a ser la **top bar**: wordmark (Lore), HUD en vivo (sesiones / "te necesita" pulsante / **maná** / **reset + dial día-noche**), botón primario "Nueva sesión" (SpawnMenu), menú y ajustes. |
| `UsageHud` | Re-skin (lógica intacta): barra de **maná** arcana azul + mote, dial ☀️/🌙 y countdown de **reset**, integrados a la top bar. |
| `useDayNight` | Sólo se re-gradan los `STOPS` de color hacia cálido/forja; helpers intactos. |
| `useUsage` | Sin cambios (lógica). |
| `HabitatLayout` | Se mantiene master-detail + resize; se re-estilan divisor, scrim y overlay narrow. |
| `SessionRail` | Igual lógica (draggable, wheel-scroll); re-estilo del contenedor y `empty`. |
| `SessionPod` | Card premium: stripe de estado, nicho de duelo, nombre (Lore), chip, repo/branch (Máquina), acción, "activa hace". Variante `compact` re-estilada. |
| `MiniArena` | Misma lógica de combate; usa `<GameSprite>`; barra de vitalidad y daño flotante re-estilados. |
| `Sprite` | Se mantiene (recorte de frames). Posible wrap por `<GameSprite>`. |
| `DetailPanel` | Header con medallón, chips, tools (Quest Book, **Archivos con `Bag.png`**, Cerrar); terminal como superficie protagonista con barra de título; loot como toast premium; menú contextual copiar/pegar re-estilado. |
| `QuestBook` | Re-skin: panel premium, íconos de quest. |
| `FileBrowser` | Re-skin: lista premium. |
| `SpawnMenu` | Re-skin del menú de nueva sesión + inputs. |
| `ProjectsManager` | Re-skin de la gestión de proyectos. |
| `SettingsView` | Re-skin de ajustes. |
| `LoginView` | Re-skin: portada "forja" con el campo de token. |

## 5. Fases

### Fase 1 — Fundación
- Setup de Tailwind + theme "forja cálida" (tokens) + fuentes self-hosted.
- `@layer` con elementos firma base (`<GameSprite>`, utilidades de nicho/medallón).
- **Top bar** (AppMenu + HUD + spawn + **UsageHud**: maná, dial día/noche, reset) y
  shell (`HabitatLayout`).
- **Reconciliación de fondo**: `.sky-ambient` (día/noche) de base + viñeta/glows de
  forja encima; re-gradar `STOPS` de `useDayNight` a cálido.
- `LoginView`.
- Criterio de salida: la app levanta con el nuevo shell, login y top bar (incluido
  maná + reset + ciclo día/noche funcionando con data real); tema aplicado
  globalmente; sin regresiones de layout master-detail.

### Fase 2 — Núcleo (lo que más se ve)
- `SessionPod` (card + nicho) + variante compact.
- `MiniArena` + `<GameSprite>` (integración de sprites).
- `DetailPanel` (medallón, terminal, loot toast, menú contextual).
- Criterio de salida: pantalla principal completa funcionando con data real
  (combate, estados, loot, terminal, copy/paste).

### Fase 3 — Secundarias
- `QuestBook`, `FileBrowser`, `SpawnMenu`, `ProjectsManager`, `SettingsView`.
- Criterio de salida: todas las superficies re-vestidas; nada con estilo viejo.

Cada fase = su propio PR revisable contra `main`.

## 6. Testing y verificación

- **No romper tests existentes.** Los tests actuales son de lógica
  (composables/stores/sprites), no de estilos; deben seguir verdes. Ojo con
  fallas pre-existentes no relacionadas (pngjs/ws) — validar solo lo tocado.
- `npm run typecheck` (vue-tsc) y `npm run build` deben pasar por fase.
- Verificación visual por fase contra el mockup (levantar la app; comparar
  estados working/waiting/done/idle/offline, boss, loot, narrow/wide,
  portrait/landscape, compact/tablet).
- Accesibilidad: foco visible (ring latón), `prefers-reduced-motion`, contraste
  de texto sobre superficies oscuras.

## 7. Riesgos y mitigaciones

- **Tailwind en proyecto Vue existente**: migración grande y nueva toolchain.
  Mitigación: introducir Tailwind sin borrar `style.css` de golpe; convivencia
  temporal y migración componente por componente dentro de cada fase.
- **Elementos firma no expresables en utilities**: se aíslan en CSS custom desde
  el inicio (sección 3); Tailwind no se fuerza donde no aplica.
- **Sprites "pegados"**: resuelto con `<GameSprite>` (grade + contacto + rim);
  validado en el mockup.
- **Spritesheets**: el recorte de frame ya existe en `Sprite.vue`; no romperlo.
- **Responsive denso**: el riel horizontal (portrait wide) y el overlay (narrow)
  ya existen; re-estilar sin perder esos breakpoints.

## 8. Fuera de alcance

- Backend, protocolo WS, hooks, lógica de combate/telemetría.
- Generar nuevos assets de personajes/monstruos (se descartó).
- Cambiar la metáfora de juego.
