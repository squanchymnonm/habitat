# Retrabajo de UI del Hábitat: layout master-detail + refinamiento estético

**Fecha:** 2026-06-22
**Estado:** Diseño aprobado (estructura + estética). Pendiente plan de implementación.

## Contexto

Hoy el dashboard del hábitat (`habitat/client`) tiene:

- `App.vue`: `<header>` + `<main><SessionGrid/></main>` + `<footer>` + `<SessionDrawer/>`.
- `SessionGrid`: grid fluida `repeat(auto-fill, minmax(340px,1fr))` → de 1 a 4+ columnas.
- `SessionPod`: tarjeta rica con arena de combate de 180px (sprites héroe/monstruo, daño, loot), meta, stamina.
- `SessionDrawer`: panel **overlay** `position:fixed` que entra deslizándose desde la derecha (con scrim), redimensionable (drag + persistencia en `localStorage`), que contiene cabecera (cara 140px + info), barras de HP, arena de batalla (`.bstage`) y la **terminal** xterm (`flex:1`).
- Estética: pixel-art medieval a la luz de antorcha. Scanlines CRT globales (`body::after`), biseles duros (`--bevel`), halos cálidos, `image-rendering:pixelated`. Stack: Vue 3 + Pinia + Vite + TS, CSS vanilla scopeado + `style.css` monolítico.

**Objetivo:** convertir el drawer en un panel **permanente** y la grid en una **lista de 1 columna**, con un layout **responsive** optimizado para monitor vertical y horizontal, refinando (sin reemplazar) la identidad pixel-medieval.

## Decisiones de diseño

### Estructura

**Modelo: master-detail permanente, adaptativo por orientación, con fallback overlay en anchos chicos.**

1. **Shell de 2 zonas.** `App.vue` deja de montar `SessionDrawer` como overlay y `SessionGrid` como `<main>` suelto. Pasa a un shell con **lista** (rail/tira) + **panel de detalle**, ambos siempre visibles en monitores. El `<header>` (brand + contador + `SpawnMenu`) se mantiene full-width arriba; el `<footer>` se conserva.

2. **Adaptativo por orientación (ancho ≥ ~900px):**
   - **Horizontal (landscape):** rail de pods de **1 columna** a la izquierda + panel de detalle a la derecha.
   - **Vertical (portrait):** pods en **tira horizontal con scroll** arriba + panel de detalle grande abajo (terminal a todo el ancho — saca provecho de la altura del monitor vertical).
   - Detección por `@media (orientation: portrait|landscape)` combinada con `min-width: 900px`.

3. **Fallback overlay (ancho < ~900px):** la lista ocupa toda la pantalla y el detalle se abre como **overlay deslizante** (se reutiliza la lógica actual del `SessionDrawer`: transform + scrim + cierre por scrim/Esc). Aplica sin importar la orientación.

4. **Pod en la lista → compacto + mini-arena, densidad cómoda.**
   - Fila con aire: mini-arena (~56-64px) con los sprites animados héroe/monstruo a escala chica, nombre, chip de estado, línea de acción y stamina.
   - Se reutiliza el componente `Sprite` y la animación actual a menor escala. La arena de 180px **sale** del pod.
   - El pod **seleccionado** se resalta de forma persistente (borde/halo dorado — se reutiliza el lenguaje visual de `:hover`).

5. **Panel de detalle → terminal dominante.**
   - **Franja-cabecera compacta:** mini-arena (sprites + barras de HP + cara reducida) + nombre + chip + línea de acción + botón kill.
   - **Terminal (xterm)** ocupa el grueso del panel: la superficie de trabajo real. Se conserva `useTerminal` y el bridge tmux/`/term` sin cambios funcionales.
   - **Selección por defecto:** el **primer pod** del rail al cargar. Si el pod seleccionado desaparece (sesión cerrada/offline), reseleccionar el primero disponible.
   - **Empty state** solo para el caso de **cero sesiones** (se adapta el estilo `.empty` actual).

6. **Divisor redimensionable.** Se conserva el drag para ajustar el ancho del rail / panel en layouts anchos, con persistencia en `localStorage` (se reaprovecha la lógica de `dragx` del drawer, reorientada a redimensionar el rail).

### Estética (refinar pixel-medieval, no reemplazar)

7. **Identidad conservada:** paleta torch-lit (piedra/madera oscura, dorado latón, brasa naranja), halos cálidos, biseles, `pixelated`. Misma familia tipográfica y variables `:root`.

8. **Efectos retro selectivos por zona:**
   - **Rail / cabecera / arena:** mantienen scanlines + biseles + halos (máximo encanto).
   - **Panel de terminal:** **sin** scanlines, borde sobrio, texto nítido para máxima legibilidad.
   - Implica refactor: las scanlines dejan de ser un `body::after` global y pasan a aplicarse por zona (overlay scopeado a rail/cabecera/arena), de modo que la terminal quede excluida.

9. **Densidad del rail: cómoda.** Más respiro entre filas, mini-arena algo más grande, tipografía media. Se ajusta a la baja el type-scale actual (cuerpo 15 / acción 19 / repo 17) para que las filas compactas respiren sin amontonarse. Cifras/contadores con figuras tabulares.

## Arquitectura de componentes

- **`App.vue`**: header + nuevo componente de layout + footer. Deja de montar el overlay directamente.
- **`HabitatLayout`** (nuevo): orquesta rail + detalle. Contiene las media queries de orientación y el cambio a fallback overlay en `< 900px`. Maneja el divisor redimensionable.
- **`SessionList` / `SessionRail`** (evolución de `SessionGrid`): renderiza los pods en 1 columna (landscape) o tira horizontal (portrait); empty state de cero sesiones.
- **`SessionPod`** (refactor): variante compacta + mini-arena, estado seleccionado.
- **`DetailPanel`** (extraído de `SessionDrawer`): contenido reutilizable (cabecera-batalla + terminal). Se usa **embebido** en monitores y **dentro del overlay** en anchos chicos.
- **`DetailOverlay`** (resto de `SessionDrawer`): wrapper overlay (transform + scrim + Esc) que envuelve a `DetailPanel`, activo solo en el fallback `< 900px`.
- **Store `sessions`**: se conserva `selected`. Se agrega lógica de auto-selección del primer pod al cargar / cuando no hay seleccionado, y reselección si el seleccionado desaparece.
- **`useTerminal`** y lógica de batalla/sprites: sin cambios funcionales; cambian contenedores y tamaños (mini-arena en pod y en cabecera del detalle).

## Responsive — resumen de breakpoints

| Ancho | Orientación | Layout |
|-------|-------------|--------|
| ≥ 900px | landscape | rail 1-col izquierda + detalle derecha |
| ≥ 900px | portrait | tira horizontal de pods arriba + detalle abajo (terminal full-width) |
| < 900px | cualquiera | lista full-screen + detalle como overlay deslizante |

## Reutilización y riesgos

- **Reutilización alta:** `DetailPanel` sirve embebido y en overlay → el fallback `< 900px` reaprovecha casi toda la lógica actual del drawer (transform/scrim/drag).
- **Riesgo terminal/fit:** xterm + `FitAddon` debe re-fitear al cambiar de embebido↔overlay y al redimensionar el divisor. Hay que disparar `.fit()` en esos cambios de tamaño/contenedor.
- **Riesgo scanlines:** mover el overlay de scanlines de `body::after` global a por-zona sin romper el z-index/efecto en las zonas que sí lo mantienen.
- **YAGNI:** no se diseña experiencia de celular dedicada más allá del fallback overlay; sin nuevos estilos ni features fuera del alcance del relayout + refinamiento.

## Criterios de éxito

- El detalle (cabecera-batalla + terminal) está **siempre visible** en monitor vertical y horizontal, sin overlay.
- La lista es de **1 columna** (landscape) / tira (portrait), con pods compactos + mini-arena, densidad cómoda.
- Al cargar se auto-selecciona el primer pod; al cerrarse el activo se reselecciona otro; empty state solo con cero sesiones.
- En `< 900px` el detalle vuelve al overlay deslizante y la lista ocupa la pantalla.
- La terminal se lee nítida (sin scanlines), mientras rail/cabecera/arena conservan el sabor pixel-CRT.
- La terminal re-fitea correctamente al cambiar de layout y al redimensionar.
