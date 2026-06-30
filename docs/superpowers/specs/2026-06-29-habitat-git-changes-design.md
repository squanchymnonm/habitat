# Vista de cambios Git por sesión (Feature 1)

## Problema

Hábitat ya mapea cada sesión a una rama/worktree, pero no hay forma de **ver
el estado git** de esa rama desde el panel. Hoy, para saber qué se modificó,
qué falta commitear, qué se pushó o cómo difiere de `main`, hay que ir a la
terminal y tipear comandos git. Falta una vista que, **por sesión**, muestre de
un vistazo:

1. Los archivos modificados y todavía no commiteados.
2. Qué commits ya están pusheados y cuáles faltan, con sus archivos.
3. Todos los cambios que la rama introdujo respecto de la rama default.
4. El diff **lado a lado** contra la rama default.

Y, estando ahí, poder **actuar** sobre git (stage, commit, push, discard, pull,
merge de la default en la rama) sin saltar a la terminal.

## Objetivo

Un **panel de cambios git por sesión**, abrible desde el pod/detalle (overlay,
como Quest Book y File Browser), scopeado al worktree de esa sesión, que ofrece
las tres vistas de lectura + el visor de diff lado a lado + un set acotado de
acciones git detrás de un gate de entorno.

Esta es la **Feature 1**. El explorador + editor de proyecto completo (¿neovim?)
es la **Feature 2**, con su propio spec posterior; F1 deja listos el visor de
diff y el gate de escritura que F2 reutilizará.

## Decisiones de diseño (acordadas en brainstorming)

- **Ámbito = por sesión.** El panel muestra el estado git del worktree del pod
  activo (`s.cwd`), igual que el File Browser. No hay vista global multi-rama en
  F1.
- **"Pushes" = split pushed/unpushed por commit.** Git no guarda un log de
  pushes nativo y fiable. En vez de aproximarlo con el reflog del
  remote-tracking ref (local, expira, contaminado por fetch), se listan los
  commits de la rama marcando cuáles ya están en `origin/<rama>` y cuáles
  faltan, con los archivos de cada commit. Robusto, nunca miente.
- **Diff "de un vistazo" = tres puntos contra la default.** Los cambios de la
  rama se calculan con `git diff origin/<default>...HEAD` (desde el merge-base),
  que muestra solo lo que la rama introdujo desde que divergió.
- **Default branch** se resuelve con el `remoteDefaultBranch(cwd)` ya existente
  en `server/git.js` (origin/HEAD, con fallback).
- **Diff lado a lado responsivo.** El server devuelve el patch unificado de
  `git diff`; el cliente lo parsea (parser propio, sin dependencia externa) y lo
  renderiza en dos columnas (viejo | nuevo). En pantalla angosta (celular) cae a
  inline. Binarios → "binario"; untracked → todo-agregado.
- **Acciones git = lectura + escritura.** Set acordado: **stage/unstage**,
  **commit**, **push**, **discard** (destructivo, confirma en UI), **pull**, y
  **merge de la default en la rama**.
- **Resolución de conflictos fuera de F1.** Si `pull`/`merge` chocan, el panel
  muestra los archivos en conflicto y ofrece **Abortar** (`merge --abort`). La
  resolución editando archivos se hace con Claude/terminal (eso es Feature 2).
- **Gate de escritura por env.** La lectura está siempre disponible; las
  acciones de escritura van detrás de `HABITAT_ALLOW_GIT_WRITE=1` (default off),
  igual que `HABITAT_ALLOW_SPAWN`.
- **Actualización live + manual.** El panel abierto refresca su estado
  (debounced ~800 ms) cuando llega un `PostToolUse` de esa sesión por WS, más un
  botón de refresh manual. Nunca se corre git por cada tool-use: solo se
  recalcula al vencer el debounce.

## Arquitectura

Sigue el patrón de `/files`: token-auth → `store.get(id)` → root = `s.cwd`, con
guardas anti-traversal y anti-symlink (`resolveWithinRoot` + `realpath`). Server
deliberadamente dependency-light (http nativo, no Express).

### Backend

**`server/git-read.js`** (nuevo, puro y testeable — recibe `(cwd, exec)` con
`exec` inyectable como ya hace `git.js` con `defaultExec`):

- `workingStatus(cwd, exec)` → parsea `git status --porcelain=v1 -z` en
  `{ staged[], unstaged[], untracked[], conflicted[] }`. Cada entrada
  `{ rel, status }` (M/A/D/R/?/etc.). El `-z` evita problemas con nombres con
  espacios/unicode.
- `branchOverview(cwd, exec)` → `{ branch, default, ahead, behind, files[] }`,
  donde `files[]` son los del diff `origin/<default>...HEAD`
  (`git diff --name-status`), y `ahead/behind` de `rev-list --left-right`.
- `commits(cwd, exec)` → commits de `origin/<default>..HEAD`, cada uno
  `{ sha, shortSha, subject, pushed, files[] }`. `pushed` = el commit es
  alcanzable desde `origin/<rama>` (`git merge-base --is-ancestor` o
  pertenencia a `rev-list origin/<rama>`).
- `filePatch(cwd, rel, base, exec)` → texto del `git diff` unificado de un
  archivo. `base` ∈ `working` (working tree vs index/HEAD), `staged`
  (index vs HEAD), `branch` (vs `origin/<default>`), o `commit:<sha>`. Untracked
  → diff contra `/dev/null` (todo-agregado). Binario → marcado, sin cuerpo.

**`server/git-write.js`** (nuevo): cada acción valida paths dentro de `cwd`
(reusa `resolveWithinRoot` + `realpath`) y construye argv seguro:

- `stage(cwd, rels)` / `unstage(cwd, rels)` → `git add -- <paths>` /
  `git restore --staged -- <paths>`.
- `discard(cwd, rels)` → `git restore -- <paths>` (y borrado para untracked,
  explícito). Destructivo.
- `commit(cwd, message)` → `git commit -m <message>` (sobre lo staged).
- `push(cwd)` → `git push` (con `-u origin <rama>` si no hay upstream).
- `pull(cwd)` → `git pull --no-edit`.
- `mergeDefault(cwd)` → `git fetch origin <default>` + `git merge --no-edit
  origin/<default>`.
- `abort(cwd)` → `git merge --abort`.

Reglas de seguridad de argv: paths siempre tras `--`; rechazar paths/refs que
empiecen con `-` (anti flag-smuggling); branches via `validBranch`. Las acciones
devuelven `{ ok, code, message }`; en conflicto `{ conflict: true, files[] }`;
en fallo se incluye el stderr de git recortado.

**Endpoints en `index.js`:**

- `GET /git/status?id=` → `{ working, overview, commits }` (las tres vistas en
  un solo fetch). `authorize` + `store.get(id)` + `409` si no hay `s.cwd`.
- `GET /git/diff?id=&file=&base=` → `{ binary, hunks?|patch }` del archivo.
- `POST /git/action?id=` con body `{ action, paths?, message? }`. Detrás de
  `HABITAT_ALLOW_GIT_WRITE` → `403` si el flag está off.

### Frontend (Vue 3 + TS, estilo forja, sin libs pesadas)

- **`composables/useGitChanges.ts`** — espejo de `useFiles.ts`: `status`,
  `loading`, `error`, `loadStatus(id)`, `loadDiff(id, file, base)`,
  `action(id, action, payload)`. Auth por `?token=` como el resto.
- **`composables/parseDiff.ts`** — parser de diff unificado → hunks
  (`{ oldStart, newStart, lines: [{type, oldNo, newNo, text}] }`), para el
  render lado-a-lado propio.
- **`components/ChangesPanel.vue`** — overlay por sesión (botón en el
  header del panel de detalle, como `📁`/Quest Book; cierra con `✕` y `Esc`).
  Tres secciones (**Trabajo / Rama / Commits**) + visor de diff. Acciones como
  botones (gated por la respuesta del server: si escritura off, no se muestran o
  quedan deshabilitadas). `discard` y `abort` piden confirmación.

### Actualización live

`PostToolUse` ya fluye por `hooks-logic.js` y se difunde por WS. Se marca la
sesión como "git-dirty" y se emite un evento liviano; el `ChangesPanel` abierto
para esa sesión hace **un** refresh debounced (~800 ms) de `/git/status` (no
recarga el diff abierto salvo pedido del usuario). Botón de refresh manual
siempre disponible.

## Seguridad

- Todo detrás de `authorize(req, res)` (token Bearer / `?token=`) + bind
  loopback (Tailscale Serve adelante).
- Scope estricto a `s.cwd` vía `store.get(id)`; paths validados con
  `resolveWithinRoot` + guard `realpath` anti-symlink (idéntico a `/files`).
- Argv git endurecido (`--`, rechazo de `-`, `validBranch`).
- Escritura detrás de `HABITAT_ALLOW_GIT_WRITE` (default off).

## Testing

Estilo del repo (`node --test` en server, Vitest en client; `exec` inyectable):

- **`git-read.test.js`** — parseo de `--porcelain=v1 -z`, cálculo
  pushed/unpushed, ahead/behind, y selección de base en `filePatch`, con `exec`
  fake (sin git real).
- **`git-write.test.js`** — construcción de argv de cada acción, guard de paths
  dentro de root, rechazo de flag-smuggling, detección de conflicto por exit
  code/stderr.
- **`parseDiff.test.ts`** — hunks, agregados/borrados, untracked, binario.
- **Endpoints** — `authorize`, `409` sin sesión, `400` por path fuera de root,
  y gate `HABITAT_ALLOW_GIT_WRITE` (`403` con flag off).

## Fuera de alcance (Feature 2)

- Explorador de **todo** el árbol del proyecto (hoy `/files` saltea dotfiles y
  apunta a uploads).
- **Edición** de archivos arbitrarios desde el panel / integración de un editor
  (¿neovim, editor web?).
- Resolución de conflictos editando archivos en el panel.

Estos van en un brainstorm y spec propios; F1 deja listos el visor de diff y el
gate de escritura para reutilizar.
