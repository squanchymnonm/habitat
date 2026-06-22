# Múltiples agentes por proyecto vía git worktrees

Fecha: 2026-06-21

## Problema

Hábitat no permite correr varios agentes Claude sobre el mismo proyecto a la vez.
La causa: `s.name = basename(cwd)` (`hooks-logic.js:48`) es simultáneamente el display,
la semilla del monstruo y **el nombre de la sesión tmux** que usan preview, chat y term.
Dos `claude` en el mismo directorio producen el mismo basename → mismo nombre tmux → colisión
(`/spawn` rechaza con 409 en `index.js:87`).

El store ya soporta N sesiones (se indexa por `session_id`), así que el problema es de
**aislamiento de directorio + naming**, no de estado.

## Objetivo

Correr varios agentes sobre un mismo repo, cada uno en su propia rama, orquestado por Hábitat
desde el panel. Cada agente vive en un **git worktree** dedicado (directorio propio → rama propia
→ sin conflictos de archivos).

## Decisiones de diseño

- **Hábitat orquesta todo**: crea worktree + rama + sesión tmux + lanza `claude` desde el panel.
- **Persistencia**: worktrees y ramas persisten. Limpieza manual con git afuera. Sin teardown
  automático (evita perder trabajo sin commitear). YAGNI: no se construye UI de cierre ahora.
- **Ubicación**: carpeta dedicada fuera del repo: `~/habitat-worktrees/<proyecto>/<rama-saneada>`.
- **Rama base configurable** al crear, default `main`.

## Identidad: cómo se desacopla tmux de basename

El código ya trae el gancho: preview (`index.js:64`) y chat (`index.js:108`) usan `s.tmux || s.name`,
pero **`s.tmux` nunca se setea**. El diseño consiste en poblar `s.tmux` con un nombre único.

**Nombre tmux** = `<proyecto>-<rama-saneada>`, donde `rama-saneada = rama.replace(/\//g, '-')`.
Se calcula **determinísticamente desde el cwd** tanto al spawnear como en `SessionStart`, por lo
que no se necesita ningún mapa en memoria ni en disco (sobrevive reinicios del server).

Derivación desde `cwd`:
- Si `cwd` cuelga de `WORKTREES_DIR` (ej. `~/habitat-worktrees/rpg/feature-x`):
  - `proyecto = basename(dirname(cwd))` → `rpg`
  - `tmux = <proyecto>-<basename(cwd)>` → `rpg-feature-x`
- Si no cuelga de `WORKTREES_DIR` (sesión legacy, `claude` corrido a mano en el dir del repo):
  - no se setea `s.tmux`; cae a `basename(cwd)` como hoy. **Cero regresión.**

`s.branch` sigue saliendo de `gitBranch(cwd)` (rama real de git, con slashes correctos para el chip),
independiente del nombre saneado del directorio.

Consistencia clave: el leaf del worktree y el sufijo tmux usan **la misma función de saneo**, así
la derivación en `SessionStart` reproduce exactamente el nombre que `/spawn` creó.

**Alternativa descartada**: mantener un mapa `cwd → tmuxName` en memoria o archivo. Agrega estado,
se pierde al reiniciar el server, y no aporta sobre la derivación determinística.

## Cambios por archivo

### 1. `server/git.js` (nuevo, espejo de `tmux.js`)
- `worktreeAdd(projectDir, branch, base, path, exec = defaultExec)`:
  - Valida `branch` contra `^[A-Za-z0-9._/-]+$` y rechaza si contiene `..`.
  - Si la rama ya existe (`git -C projectDir rev-parse --verify <branch>` ok):
    `git -C projectDir worktree add <path> <branch>`.
  - Si no existe: `git -C projectDir worktree add -b <branch> <path> <base>`.
  - Args por array vía `execFile` (sin shell → sin inyección). Devuelve bool ok/fallo.
- Patrón idéntico a `tmux.js`: `defaultExec` con `promisify(execFile)`, `exec` inyectable para tests.

### 2. `server/config.js`
- Agrega `WORKTREES_DIR: process.env.HABITAT_WORKTREES_DIR || join(homedir(), 'habitat-worktrees')`.

### 3. `server/index.js` — endpoint `/spawn`
- Body pasa de `{ dir }` a `{ dir, branch, base? }`.
- Validaciones: `dir` en `config.PROJECTS` (como hoy); `branch` string válido; `base` default `main`.
- Si `branch` viene vacío/ausente → comportamiento legacy actual (spawn en el dir del proyecto).
- Con `branch`:
  - `proyecto = basename(dir)`
  - `ramaSaneada = branch.replace(/\//g, '-')`
  - `path = join(config.WORKTREES_DIR, proyecto, ramaSaneada)`
  - `tmuxName = proyecto + '-' + ramaSaneada`
  - Si `tmuxName` ya está en `tmux.listSessions()` → 409.
  - `git.worktreeAdd(dir, branch, base, path)`; si falla → 500.
  - `tmux.newTmuxSession(tmuxName, path)`; si falla → 500.
  - Responde `{ name: tmuxName }`.
- Inyectar `git` en `createApp({ ..., git })` igual que `tmux`, para testear con fake.

### 4. `server/hooks-logic.js` — `SessionStart`
- Nuevo dep `worktreeName(cwd)` (inyectado desde `index.js`, cierra sobre `config.WORKTREES_DIR`):
  devuelve `{ project, tmux }` si `cwd` cuelga de `WORKTREES_DIR`, si no `null`.
- En `SessionStart`:
  ```
  const wt = deps.worktreeName && deps.worktreeName(payload.cwd);
  if (wt) { s.name = wt.project; s.tmux = wt.tmux; }
  else    { s.name = basename(payload.cwd); }
  s.project = s.name;
  if (deps.gitBranch) s.branch = deps.gitBranch(payload.cwd) || '';
  ```
- `s.tmux` se incluye en el snapshot (no empieza con `_`, ya pasa el filtro de `snapOf`/`stripInternal`).

### 5. `client` — `SpawnMenu.vue` + `useProjects.ts`
- Al elegir un proyecto, en vez de spawnear directo, abrir un mini-form:
  - input de rama (requerido)
  - input de base (default `main`)
  - botón crear
- `useProjects.spawn(dir, branch, base)`: agrega `branch` y `base` al body del POST.
- Manejo de errores: 409 → "ya hay un agente en esa rama"; resto como hoy.
- El pod ya muestra chip de rama, así que N pods del mismo proyecto se distinguen por rama.

### 6. Tests
- `server/git.test.js`: con fake exec, verifica el comando correcto para rama nueva vs existente,
  rechazo de branch inválido / con `..`.
- `server/index.test.js`: `/spawn` con `branch` arma path/tmuxName correctos; colisión → 409;
  body legacy sin branch sigue funcionando.
- `server/hooks-logic.test.js`: `SessionStart` con cwd bajo `WORKTREES_DIR` setea `s.tmux` y
  `s.project` derivados; cwd normal mantiene `basename` y `s.tmux` vacío.

## Flujo end-to-end

1. `+ NUEVO AGENTE` → elegís `rpg`, rama `feature-x`, base `main`.
2. Server: crea worktree en `~/habitat-worktrees/rpg/feature-x` en rama `feature-x`,
   levanta tmux `rpg-feature-x`, lanza `claude` dentro.
3. Claude dispara `SessionStart` con `cwd = ~/habitat-worktrees/rpg/feature-x`.
4. `hooks-logic` setea `s.tmux = rpg-feature-x`, `s.branch = feature-x`.
5. El pod aparece; preview, chat y term targetean `s.tmux` correctamente.
6. N agentes del mismo repo conviven, cada uno en su rama, sin colisión.

## Fuera de alcance (YAGNI)

- Teardown automático de worktrees / botón de cierre en la GUI.
- UI de merge / PR.
- Listado de worktrees existentes en el panel.
