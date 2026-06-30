# Explorador + editor de proyecto por sesión (Feature 2)

## Problema

Hábitat ya navega el working dir de una sesión, pero el FileBrowser está
orientado a **subir** assets: saltea dotfiles, no muestra contenido y no edita.
No hay forma de **ver todo el proyecto** (todos los archivos, incluidos los
ocultos) ni de **editar** un archivo desde el panel sin pasar por la terminal
del agente (donde corre Claude).

Al mismo tiempo, Hábitat ya tiene una pieza potente: una **terminal xterm sobre
WS `/term`** atachada a un **PTY de tmux**. Eso hace innecesario meter un editor
web pesado: se puede editar con **nvim** corriendo en una sesión tmux, reusando
toda esa infraestructura.

## Objetivo

Un **explorador de proyecto por sesión**, abrible desde el detalle del pod
(overlay, como ChangesPanel / FileBrowser), scopeado al worktree de la sesión
(`s.cwd`), que permite:

1. **Navegar** todo el árbol (todos los archivos, incluidos dotfiles y `.git/`),
   lazy por carpeta.
2. **Previsualizar** el contenido de un archivo (read-only, scrolleable) con un
   single-click.
3. **Editar** un archivo abriéndolo en **nvim** (doble-click o botón), en una
   **terminal de editor dedicada** por worktree, aislada de la del agente.

Es la **Feature 2**. Reutiliza el visor de diff y el patrón de overlays de la
Feature 1, y la infra de PTY/tmux existente.

## Decisiones de diseño (acordadas en brainstorming)

- **Edición = nvim en la terminal.** No se agrega editor web ni dependencias
  nuevas. Se reusa el xterm + PTY de tmux ya existente.
- **Terminal de editor dedicada por worktree.** Una sesión tmux aparte,
  `${s.tmux}-edit`, aislada de la del agente, corriendo nvim. Se **reusa entre
  archivos** (nvim queda abierto; archivo nuevo → `:e <path>`). Buffers
  persisten al cerrar el overlay; la sesión `-edit` se destruye recién al cerrar
  la sesión padre.
- **Alcance del árbol = literalmente todo.** Incluye dotfiles y `.git/`. Sin
  filtro por `.gitignore`. Navegación lazy por carpeta (carpetas grandes como
  `node_modules` aparecen pero solo se cargan al abrirlas).
- **Click = preview, doble-click / botón = nvim.** Single-click muestra el
  contenido read-only en el navegador; doble-click (o un botón "✎ editar en
  nvim" en el preview, más cómodo en tablet) abre nvim.
- **Sin gate nuevo.** Lectura (árbol/preview) y apertura del editor van con la
  **auth de terminal existente** (token + bind loopback). Abrir nvim es la misma
  capacidad PTY que ya se expone (terminal interactiva del agente), así que no
  amerita un flag aparte como `HABITAT_ALLOW_GIT_WRITE`.

## Arquitectura

Sigue el patrón de `/files`: `authorize(req,res)` (token) → `store.get(id)` →
root = `s.cwd`, con guardas anti-traversal (`resolveWithinRoot`) y anti-symlink
(`realpath`). Server dependency-light (http nativo, no Express).

### Backend (`habitat/server/`)

- **`GET /tree?id=&path=`** — lista el contenido de `path` dentro de `s.cwd`,
  **sin filtrar dotfiles ni `.git/`**. Entries `{ name, rel, isDir, size }`,
  carpetas primero, + breadcrumbs. Lazy: una carpeta por request. `409` sin
  `s.cwd`; `400` si el path escapa del root.
- **`GET /file?id=&path=`** — devuelve el contenido del archivo para preview:
  - binario (contiene byte NUL en el prefijo leído) → `{ binary: true }`,
  - tamaño > cap (1 MB, configurable `HABITAT_FILE_MAX_BYTES`) → `{ tooLarge:
    true, size }`,
  - si no → `{ text, size }`.
  Mismo scope + guardas que `/tree`.
- **`POST /editor/open?id=`** body `{ path }` — asegura la sesión tmux de editor
  y abre el archivo:
  - target = `${s.tmux}-edit` (derivado del store, nunca del cliente).
  - si la sesión `-edit` no existe: `newTmuxSession(editName, s.cwd, 'nvim --
    <abs>')` (o equivalente que lance nvim sobre el path).
  - si ya existe: `sendKeys(editName, ':e <path><CR>')` (con el path relativo,
    citado).
  - valida `resolveWithinRoot(s.cwd, path)`; rechaza paths con prefijo `-`; el
    path a nvim va tras `--`.
  - devuelve `{ ok: true, tmux: editName }` o `{ ok: false, message }`.
- **`/term` con `role=edit`** (en `term.js`): si la query trae `role=edit`, el
  target pasa a ser `${s.tmux || s.name}-edit` en vez de `s.tmux || s.name`. El
  base sigue derivándose del store; no hay nombres arbitrarios.
- **Limpieza:** en el path de cierre de sesión existente (`index.js`, donde ya
  se remueve el worktree), matar también `${tmux}-edit` con `killTmuxSession` si
  existe (best-effort).

### Frontend (`habitat/client/src/`)

- **`composables/useProjectTree.ts`** — `listing`/`loading`/`error`, más
  `loadTree(id, path)`, `loadFile(id, path)` → `{ binary?|tooLarge?|text }`, y
  `openInNvim(id, path)` → `POST /editor/open`. Auth por `?token=` (igual que
  `useFiles`/`useGitChanges`).
- **`components/ProjectExplorer.vue`** — overlay (botón en el header del detalle,
  como ChangesPanel/FileBrowser; cierra con `✕` y `Esc`). Breadcrumbs + listado
  lazy; panel de **preview read-only** scrolleable al hacer single-click;
  doble-click o botón "✎ editar en nvim" dispara `openInNvim` y abre la terminal
  de editor.
- **`components/EditorTerminal.vue`** — overlay con un xterm atachado vía el
  `useTerminal` existente, **extendido con un `role` opcional** que agrega
  `&role=edit` a la URL de `/term`. Muestra estado si la sesión `-edit` no está
  disponible todavía.
- **`useTerminal.ts`** — aceptar un parámetro/opción `role` (default vacío) que
  se anexa a la query de `/term`. Cambio mínimo, no rompe el uso actual.
- **`DetailPanel.vue`** — botón "🗂 Proyecto" en el header + render del overlay
  `ProjectExplorer`, con el mismo patrón de `changesOpen`/`filesOpen` (ref,
  cierre en `Esc`, cierre al cambiar de sesión).

## Seguridad

- Todo detrás de `authorize` (token) + bind loopback (Tailscale Serve adelante).
- Scope estricto a `s.cwd` vía `store.get(id)`; paths validados con
  `resolveWithinRoot` + guard `realpath` anti-symlink (idéntico a `/files`).
- Target de la terminal de editor **derivado** de `s.tmux` (`${s.tmux}-edit`),
  nunca de input del cliente; path a nvim tras `--`; rechazo de paths con
  prefijo `-`.
- `/file` capea a 1 MB y detecta binario para no volcar basura al navegador.
- Sin gate nuevo: misma auth que la terminal del agente (capacidad PTY ya
  expuesta).

## Testing

Estilo del repo (`node --test` server con deps inyectables; Vitest client;
`exec`/`tmux`/`spawnPty` fakes, sin procesos reales):

- **`/tree`** — incluye dotfiles y `.git/`; guard de path (`400`); `409` sin
  `s.cwd`; orden carpetas-primero.
- **`/file`** — texto (`{text,size}`), binario (NUL → `{binary:true}`),
  `tooLarge` (supera el cap), guard de path.
- **`/editor/open`** — deriva `${s.tmux}-edit`; crea con `newTmuxSession` si
  falta vs `sendKeys :e` si existe (con `tmux` fake, verificando argv); valida
  path dentro del root; `--` antes del path de nvim; `409` sin sesión.
- **`term.js`** — derivación del target con `role=edit` (helper testeable
  separado del WS).
- **Cleanup** — cerrar sesión dispara `killTmuxSession(${tmux}-edit)` (tmux
  fake).
- **Client** — composable es fetch I/O (typecheck); helpers puros (detección de
  binario / formato de tamaño) con Vitest; `ProjectExplorer`/`EditorTerminal`
  verificados por `npm run build` (vue-tsc + vite).

## Fuera de alcance

- Editor web (Monaco/CodeMirror) y syntax highlight en el navegador: descartado
  a favor de nvim.
- Resolución asistida de conflictos de merge: se hace editando en nvim, sin UI
  especial.
- Operaciones de archivo desde el árbol (crear/renombrar/borrar): no en esta
  feature; se hacen en nvim o la terminal.
- Multi-cursor / colaboración / búsqueda global en el árbol.
