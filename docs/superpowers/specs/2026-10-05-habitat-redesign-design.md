# Habitat: rediseño general de la UI

Fecha: 2026-10-05
Estado: aprobado en brainstorming, pendiente de plan
Mockups de referencia: `.superpowers/brainstorm/2031495-1791228030/content/` (layout-v2, visual-style, board, tools, settings)

## Problema

La UI actual es difícil de usar y de mantener:

- En celular el header se rompe en tres filas.
- Hay gradientes pesados y una mezcla de tipografías sin jerarquía.
- En el panel de detalle, cinco botones del mismo peso compiten con la terminal.
- La animación de combate ocupa espacio y está mal implementada.
- El estilo está repartido entre un `style.css` legacy, CSS scoped y una migración a Tailwind v4 que quedó a medias.

El usuario usa la app en modo compacto, tanto en escritorio como en tablet (horizontal y vertical), y en el celular para consultas rápidas.

## Decisiones

| Tema | Decisión |
|---|---|
| Identidad | Se mantiene el RPG, pero subordinado a lo funcional: avatares pixel, luz de estado, maná, stamina como barra fina, estados con nombre y Quest Book. **Se elimina el combate**, en el cliente y en el server. |
| Dispositivos | Escritorio y tablet son de primera clase. El celular sirve para consulta rápida. |
| Uso | Dos modos: **foco** (una sesión) y **tablero** (monitorear varias). |
| Navegación de sesiones | En horizontal, una barra **a la izquierda**. En vertical, **pestañas arriba**. Las dos se colapsan a avatar con luz de estado. |
| Tablero | Columnas por estado (kanban automático). |
| Herramientas en foco | Pestañas que reemplazan el área (A), con la opción de **fijar al costado** de la terminal (B). |
| Temas | Varios temas intercambiables sobre tokens semánticos: **Forja refinada** (por defecto), **Pizarra pixel** y **Noche de taberna**. |
| Ajustes | Secciones con navegación lateral; cada proyecto tiene su página con pestañas. |
| Librería | **shadcn-vue** (Reka UI) sobre el Tailwind v4 existente. |
| Entrega | Cuatro PRs, cada uno desplegable. |

## 1. Base técnica

- **Stack:** Vue 3 + Pinia (sin cambios), **shadcn-vue** (los componentes se copian en `client/src/components/ui/`), Tailwind v4 completo y **vue-router** con `createWebHashHistory`. Se conservan `@xterm/xterm`, `@xterm/addon-fit` y `vuedraggable`.
- **Estilos:** todo se escribe con utilidades de Tailwind sobre los tokens del tema. El `style.css` legacy y los `<style scoped>` con colores desaparecen. Se permite CSS scoped solo para casos que Tailwind no cubre (por ejemplo `image-rendering: pixelated`), siempre usando tokens.
- **Preflight de Tailwind:** se activa en el PR 4, cuando ya no queden componentes legacy.
- **Fuentes:** self-hosted en `client/public/fonts/`, porque la app se usa por LAN o Tailscale sin depender de internet. Son Inter, Space Grotesk, IBM Plex Sans, IBM Plex Mono, JetBrains Mono y Press Start 2P, en woff2 con subset latin.

### Tokens semánticos

Los componentes solo usan roles, nunca colores literales. Los tokens se definen como variables CSS y se exponen a Tailwind con `@theme inline`, de modo que existan clases como `bg-surface` o `text-muted`.

| Token | Uso |
|---|---|
| `--background` | fondo de la app |
| `--surface`, `--surface-raised` | paneles, barra lateral, tarjetas; hover y seleccionado |
| `--border` | bordes y divisores |
| `--text`, `--text-muted` | texto principal y secundario |
| `--accent`, `--accent-foreground` | acción primaria, selección, foco |
| `--terminal-bg`, `--terminal-fg` | terminal y bloques de código |
| `--state-working`, `--state-waiting`, `--state-done`, `--state-idle`, `--state-error` | luz de estado, badges, columnas del tablero |
| `--mana`, `--stamina-ok`, `--stamina-low` | medidores |
| `--danger` | acciones destructivas |
| `--font-ui`, `--font-mono`, `--font-display` | tipografía de la interfaz, terminal y código, y acento (logo, nombre de la sesión en foco) |
| `--radius` | radio base (los controles usan `--radius`, las superficies `calc(var(--radius) + 4px)`) |

Cada tema es un bloque `[data-theme="<id>"]` sobre `<html>`. Agregar un tema consiste en agregar un bloque y una entrada en el registro de temas (`client/src/theme/themes.ts`: id, nombre y colores de muestra para el selector).

Valores iniciales (los valores finales se ajustan si no pasan el chequeo de contraste AA):

| Token | forja | pizarra | taberna |
|---|---|---|---|
| background | `#17140f` | `#101319` | `#1a1626` |
| surface | `#1d1912` | `#141821` | `#211c31` |
| surface-raised | `#2a2419` | `#1d2433` | `#2d2644` |
| border | `#2e281e` | `#222838` | `#2f2845` |
| text | `#ece3d3` | `#dde3ee` | `#e9e4f5` |
| text-muted | `#a89c86` | `#8f9ab0` | `#a89fc4` |
| accent | `#e8a94b` | `#7aa2ff` | `#c4a7ff` |
| accent-foreground | `#1a1408` | `#0b1020` | `#1a1030` |
| terminal-bg | `#0f0d09` | `#0a0c10` | `#110e1a` |
| terminal-fg | `#d9cdb5` | `#c8d3e6` | `#d8d0ee` |
| state-working | `#e8a94b` | `#ffb454` | `#ffc26b` |
| state-waiting | `#e5604f` | `#ff6b6b` | `#ff7a90` |
| state-done | `#7fb069` | `#5fd38d` | `#6ee7b7` |
| state-idle | `#6b6253` | `#5b6478` | `#6b6390` |
| state-error | `#d14b3c` | `#ff4d5e` | `#ff5c7a` |
| mana | `#6fa3e0` | `#7aa2ff` | `#7cc4ff` |
| font-ui | Inter | IBM Plex Sans | Inter |
| font-mono | JetBrains Mono | IBM Plex Mono | JetBrains Mono |
| font-display | Space Grotesk | Press Start 2P | Space Grotesk |
| radius | 8px | 4px | 999px en pills y pestañas, 10px en superficies (`--radius: 10px`, `--radius-pill: 999px`) |

### Composables nuevos

- **`useTheme`:** expone el tema activo y la lista de temas, y aplica `data-theme` en `<html>`. Persiste en `localStorage` (`habitat.theme`), toleran que no exista o que lance error. Default: `forja`.
- **`useLayoutMode`:**
  - **Modo:** `'landscape' | 'portrait' | 'phone'`, según ancho y orientación (phone si el ancho es menor a 600 px; landscape si `ancho > alto` y el ancho es de al menos 900 px; si no, portrait).
  - **Colapsado:** estado `collapsed` por modo, persistido en `localStorage` (`habitat.nav.collapsed.<modo>`).
  - **Reemplazo:** sustituye a `useCompactPods`, que se elimina.

## 2. Estructura y navegación

### Rutas

| Ruta | Vista |
|---|---|
| `#/` | foco en la sesión seleccionada (o estado vacío) |
| `#/s/:id` | foco en la sesión `:id` |
| `#/board` | tablero |
| `#/settings/general` · `appearance` · `projects` · `projects/:name/:tab` · `account` | ajustes |

La selección de sesión del store `sessions` y la ruta se sincronizan en las dos direcciones. Si un id no existe, la app redirige a `#/`.

### Barra superior (una fila en todos los tamaños)

De izquierda a derecha:
- **Logo** (`--font-display`).
- **Resumen de sesiones** ("4 · 2 trabajando · 1 te necesita"; en celular, solo los números con su color de estado).
- **`ManaMeter`**, con el tiempo hasta el próximo ciclo en el tooltip.
- **Botón tablero/foco.**
- **Botón primario "+ Nueva sesión"** (en celular, solo "+").
- **Menú de usuario:** ajustes y salir.

El hamburguesa desaparece.

### Navegación de sesiones (`SessionNav`)

| Modo | Expandida | Colapsada |
|---|---|---|
| landscape | barra izquierda de unos 220 px: avatar con luz, nombre, proyecto · rama, estado | riel de unos 56 px: avatar con luz y tooltip con nombre y estado |
| portrait | pestañas arriba: avatar, nombre y luz, con scroll horizontal | pestañas solo con avatar y luz |
| phone | la lista de sesiones es la pantalla principal (filas grandes); "te necesita" primero | — |

- **Reordenar:** se arrastra (vuedraggable) en landscape y portrait, y el orden se persiste con `POST /sessions/order` como hoy.
- **Colapsar:** un botón alterna entre expandida y colapsada, y el estado se recuerda por modo.
- **"Te necesita":** el aviso se descarta desde la luz de estado o la tarjeta (mensaje `dismiss` por WebSocket, como hoy).

### Modo foco (`FocusView`)

- **`SessionHeader`:**
  - avatar, nombre (`--font-display`), proyecto y rama, y badge de estado;
  - stamina como barra fina (`--stamina-ok`, o `--stamina-low` por debajo del 25%);
  - acciones: abrir en editor y cerrar sesión (con confirmación).
- **`ToolTabs`:** Terminal · Git · Archivos · Infra (solo si `session.infra?.dir`) · Quest. Cada pestaña ocupa toda el área. La pestaña activa se recuerda por sesión mientras dure la página.
- **Fijar al costado:** cada herramienta distinta de Terminal tiene un botón "fijar al costado" que la muestra en un `Resizable` junto a la terminal, con la terminal siempre visible a la izquierda. El ancho se persiste en `localStorage`. El botón solo aparece en modo landscape; si el modo cambia con un panel fijado, el panel se desfija y su herramienta pasa a la pestaña activa.
- **Celular:** foco a pantalla completa con las herramientas en una barra inferior y un botón para volver a la lista.

### Tablero (`BoardView`)

- **Columnas** en este orden, según el `Status` existente:
  - **Te necesita:** `waiting` y `error`;
  - **Trabajando:** `working`;
  - **Lista:** `done`;
  - **Quietas:** `idle` y `offline`. Las `offline` se muestran atenuadas con el badge "caída".
- **Tarjeta (`BoardCard`):** avatar con luz, nombre, proyecto y la última acción (`session.action`). Al tocarla se va a `#/s/:id`.
- **Columnas vacías:** se colapsan a su encabezado con el contador.
- **En portrait y phone:** las columnas se apilan en vertical.

### Nueva sesión (`NewSessionDialog`)

Es un Dialog (en celular, un Sheet inferior) con proyecto, personaje (respetando la allowlist del proyecto) y nombre opcional. Usa `useProjects.spawn()`, muestra su error y reemplaza a `SpawnMenu`.

### Ajustes (`SettingsLayout`)

Hay una navegación de secciones a la izquierda (arriba en portrait y phone):

- **General:** permission mode de las sesiones nuevas (Select con su descripción).
- **Apariencia:**
  - `ThemePicker`: tarjetas de los temas con vista previa; al hacer clic el tema se aplica en vivo;
  - zoom (`useZoom`);
  - teclas en pantalla (`useTermKeys`);
  - "barra de sesiones colapsada por defecto".
- **Proyectos:**
  - lista de proyectos (color, nombre, ruta), "+ Agregar proyecto" (navegador de carpetas) y "Clonar repo" (si `canClone`);
  - cada proyecto abre `ProjectDetail` (`#/settings/projects/:name/:tab`), con pestañas **General** (nombre, color, personajes, quitar), **Relacionados**, **Infra** y **Archivos .env**. Estas tres últimas tienen la misma funcionalidad que el `ProjectConfig` actual.
- **Cuenta:** usuario actual y salir.

Los créditos de los sprites van al pie de Apariencia.

### Login

`LoginView` se reestiliza con los tokens (usa el tema guardado o el default), sin cambios de comportamiento.

## 3. Componentes

**Base (shadcn-vue, en `components/ui/`):** Button, Badge, Tabs, Dialog, Sheet, DropdownMenu, Tooltip, Select, Switch, Input, Textarea, ScrollArea, Resizable, Separator, Card y Toast (Sonner o el toast de shadcn-vue).

**Dominio:**

| Nuevo | Reemplaza |
|---|---|
| `AppShell`, `TopBar`, `ManaMeter`, `SessionSummary` | `App.vue` (se simplifica), `HabitatLayout`, `AppMenu`, `UsageHud` |
| `SessionNav`, `SessionSidebar`, `SessionTabs`, `SessionList`, `SessionAvatar` | `SessionRail`, `SessionPod` |
| `FocusView`, `SessionHeader`, `ToolTabs`, `PinnedPanel`, `TerminalPane` | `DetailPanel` |
| `GitTool` (con subvistas Cambios, Ramas, Commits, Diff) | `GitPanel`, `GitWork`, `GitBranches`, `GitCommits`, `GitDiff`, `GitBranchDiff`, `GitIcon` |
| `FilesTool` (explorador del proyecto + subidas) | `FileBrowser`, `ProjectExplorer`, `ProjectFiles` |
| `InfraTool` | `InfraBlock` |
| `QuestTool` | `QuestBook` |
| `BoardView`, `BoardColumn`, `BoardCard` | — (nuevo) |
| `NewSessionDialog` | `SpawnMenu` |
| `SettingsLayout`, `GeneralSettings`, `AppearanceSettings`, `ThemePicker`, `ProjectsSettings`, `ProjectDetail`, `AccountSettings` | `SettingsView`, `ProjectsManager`, `ProjectConfig` |
| `LoginView` (reestilizado) | `LoginView` |
| — | se eliminan `MiniArena`, `GameSprite`, `Sprite` (si solo los usa el combate) |

- **`SessionAvatar`:** usa los sprites actuales (`faceFor` de `sprites.ts`) con `image-rendering: pixelated` y la luz de estado (punto con borde del color de la superficie).
- **`TerminalPane`:**
  - encapsula `useTerminal`, `TermKeys`, el menú contextual copiar/pegar, el modo selección y "copiar visible";
  - hace `fit()` con un `ResizeObserver` en cada cambio de tamaño (splitter, pestaña, rotación, colapso de la barra).
- **Sin cambios:** se conservan `stores/sessions`, `useProjects`, `useGit`, `useFiles`, `useTerminal`, `useSocket`, `useUsage`, `useTermKeys`, `useZoom` y `longPress`, junto con sus tests. Solo se les quitan los tipos y campos del combate.

## 4. Eliminación del combate

- **Server (`hooks-logic.js`, `state.js`, `index.js`):**
  - se eliminan `monster`, `combat`, `_touched`, `_lastTotal` (si solo sirve al combate), `randomMonster`, `monsterFromTodos`, `hashType` (si solo sirve al combate) y el broadcast `fightResult`;
  - se conservan `quest` (`questFromTodos`), el Quest Book (`_questbook`) y la stamina.
- **Compatibilidad:** las sesiones persistidas con campos de combate se cargan igual. `reviveSession` descarta esos campos y no se vuelven a escribir.
- **Cliente:** se eliminan los tipos `Monster`, `Combat`, `FightResult` y el mensaje `fightResult` de `ServerMessage` y de `useSocket`.
- **Tests:** se eliminan o ajustan los tests del combate en el server y en el cliente.

## 5. Accesibilidad y uso táctil

- **Foco y teclado:** foco visible (`ring` con `--accent`) y navegación completa con teclado. Atajos: `[` y `]` cambian de sesión, `g` `b` va al tablero, `g` `f` al foco, `Esc` cierra diálogos y desfija el panel. Los atajos se desactivan cuando el foco está en la terminal o en un input.
- **Tamaño táctil:** áreas de al menos 40×40 px en portrait y phone.
- **Contraste:** WCAG AA (4.5:1 para texto y 3:1 para elementos de UI y luces de estado) en los tres temas, verificado por test.
- **Movimiento:** se respeta `prefers-reduced-motion`.

## 6. Entrega

| PR | Contenido |
|---|---|
| 1 · Base y navegación | shadcn-vue, tokens y 3 temas, fuentes, `useTheme`, `useLayoutMode`, vue-router, `AppShell`, `TopBar`, `ManaMeter`, `SessionSummary`, `SessionNav` completa, `SessionAvatar`. Se elimina el combate en server y cliente. Mientras tanto, el foco muestra el `DetailPanel` actual dentro del shell. |
| 2 · Modo foco | `FocusView`, `SessionHeader`, `TerminalPane`, `ToolTabs`, `PinnedPanel` y las herramientas Git, Archivos, Infra y Quest. Se elimina `DetailPanel` y los componentes que reemplaza. |
| 3 · Tablero, celular y nueva sesión | `BoardView`, el modo phone (lista y foco a pantalla completa con barra inferior) y `NewSessionDialog`. Se elimina `SpawnMenu`. |
| 4 · Ajustes, login y cierre | `SettingsLayout` y sus secciones, `ThemePicker`, `ProjectDetail`, `LoginView`. Se elimina `style.css` legacy, se activa el preflight, se eliminan los componentes que queden sin uso y se hace el pulido final. |

Cada PR sigue el flujo de CLAUDE.md (sync con main, tests, typecheck, build, PR) y se puede desplegar.

## 7. Testing

- **Unit (vitest):**
  - `useTheme`: default, persistencia, `localStorage` que lanza error, aplicación de `data-theme`;
  - `useLayoutMode`: los tres modos según tamaño y colapsado por modo;
  - el ruteo: sincronización con la selección y redirección de un id inexistente.
- **Componentes:**
  - `SessionNav`: render por modo, colapso, selección, luz por estado y descarte de "te necesita";
  - `BoardView`: columna correcta por estado y columnas vacías colapsadas;
  - `ToolTabs`: Infra solo con infra; fijar al costado solo en landscape y desfijado al cambiar de modo;
  - `NewSessionDialog`: allowlist de personajes y error de spawn;
  - `ThemePicker`: aplica en vivo;
  - `ProjectDetail`: las pestañas reusan la lógica de `ProjectConfig`, migrando sus tests actuales.
- **Existentes:** los tests de composables y stores pasan sin cambios, salvo los del combate. Los tests de componentes reemplazados se migran a sus sucesores, sin perder casos.
- **Server:** se actualizan los tests de `hooks-logic`, `state` e `index` por la eliminación del combate.
- **Contraste:** un test recorre el registro de temas y verifica los pares críticos (text/background, text/surface, text-muted/surface, accent-foreground/accent y cada `state-*` contra surface) con la fórmula de luminancia relativa de WCAG.
- **Capturas:** un script (`habitat/scripts/screenshots.mjs`, con chrome-headless-shell por CDP según la memoria del proyecto) levanta una instancia de dev con sesiones de prueba (`POST /hooks`). Captura **3 temas × 3 tamaños** (1440×900, 820×1180 y 400×860) en foco, tablero y ajustes. Se corre en cada PR y las capturas se comparten en el PR o con el usuario.

## Fuera de alcance

- Tema claro (puede agregarse después como un tema más).
- Editor de temas desde la UI.
- Notificaciones push o sonoras.
- Cambios en el server más allá de eliminar el combate.
- Migración de la persistencia a base de datos (ya registrada como mejora futura en el spec de infra).
