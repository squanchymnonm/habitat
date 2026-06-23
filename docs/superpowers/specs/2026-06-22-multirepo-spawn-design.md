# Spawn multi-repo para proyectos contenedor — Design

**Fecha:** 2026-06-22
**Componente:** `habitat/`
**Estado:** propuesto

## Objetivo

Permitir spawnear una sesión sobre un proyecto que no es un solo repo git sino un
**contenedor**: una carpeta con varios repos git en sus subcarpetas (caso real: Artisano =
`back/`, `front/`, `ceo/`, `server/`). Al crear la sesión con una rama `B`, Habitat debe
materializar un worktree de `B` en **cada** repo del conjunto, dejando una carpeta de sesión con
la misma estructura que el original, de modo que una sola sesión de Claude Code pueda trabajar
across front+back (y levantar la infra de `server/`) sin explicar dónde vive cada cosa.

## Contexto

Hoy `POST /spawn` con rama toma el camino worktree (`server/index.js` → `git.worktreeAdd`), que
hace `git -C <projectDir> worktree add …`. Si `<projectDir>` no es un repo git, el comando falla,
`worktreeAdd` traga el error y devuelve `false`, y el endpoint responde **500** — sin importar la
rama ni la base. Es exactamente lo que ocurre con Artisano: `/home/mnonm/proyectos/Artisano` no
es un repo git, es una carpeta que contiene 4 repos independientes.

Piezas existentes que se reutilizan:
- `server/git.js`: `validBranch`, `branchExists`, `worktreeForBranch`, `worktreeAdd`, `worktreeRemove`.
- `server/worktree.js`: `sanitizeBranch`, `worktreeName`, `worktreePaths`.
- `server/index.js`: `/spawn` (rama → worktree; sin rama → tmux plano) y `/kill` (limpia worktree).
- Inyección de deps: `createApp({ config, store, tmux, git })` ya permite fakes en tests.

El modelo single-repo actual (ej. `RPG-Agents`) **no cambia**.

## Decisiones tomadas (brainstorming)

1. **Base por repo hijo:** `origin/HEAD` de cada repo (default remoto), con **fetch best-effort**
   previo. El repo padre es local (sin remoto): su base es su rama actual (`HEAD`).
2. **Alcance:** todos los repos detectados como hijos (escaneo de subcarpetas inmediatas con `.git`).
3. **Fallo parcial:** todo o nada con rollback.
4. **Raíz no-git (`.claude/`, `docs/`, `.sdd/`):** se versionan en un repo padre (parent-git) con
   `.gitignore` de los hijos, así el worktree del padre los trae y quedan aislados por rama.
5. **Auto-init:** si el contenedor aún no es repo git, Habitat lo inicializa solo (idempotente).

## Arquitectura

### Detección de contenedor (`server/git.js`)

`findNestedRepos(dir, fs)` → `string[]`: nombres de las subcarpetas **inmediatas** de `dir` que
contienen una entrada `.git` (dir o file). Orden estable (alfabético). Para Artisano devuelve
`['back', 'ceo', 'front', 'server']`; para RPG-Agents devuelve `[]`.

Un proyecto es **contenedor** sii `findNestedRepos(dir).length > 0`. La detección es independiente
de que el padre sea o no repo git (clave para soportar el auto-init).

### Auto-init del repo padre (`server/git.js`)

`ensureContainerRepo(dir, nested, exec, fs)` → `Promise<boolean>`. Idempotente:
1. Si `dir/.git` existe → no hace nada, devuelve `true`.
2. Si no:
   - `git -C dir init`.
   - Asegura un `.gitignore` en `dir` con una línea por cada repo hijo (`back/`, `front/`, …).
     Si ya existe `.gitignore`, **no lo pisa**: solo agrega las entradas faltantes.
   - `git -C dir add -A` (los hijos quedan fuera por el `.gitignore`).
   - `git -C dir commit -m "habitat: init container repo"` (con `--allow-empty` por si la raíz
     no tuviera archivos no-git).
3. Devuelve `false` ante cualquier error de `exec`.

### Orquestación del spawn contenedor (`server/git.js`)

`containerWorktreeAdd(projectDir, branch, wtPath, nested, exec)` → `Promise<boolean>`. Crea el
worktree del padre y de cada hijo, con rollback total. `wtPath` es la carpeta de sesión
(`WORKTREES_DIR/<project>/<rama-sanitizada>`), que es a la vez el worktree del padre.

1. `ensureContainerRepo(projectDir, nested, …)`; si falla → `false`.
2. **Padre primero:** `worktreeAdd(projectDir, branch, <ramaActualPadre>, wtPath)`. Trae
   `.claude/docs/.sdd`; los hijos quedan ausentes (gitignored). Si falla → `false`.
   La base del padre se resuelve con `currentBranch(projectDir)` (`rev-parse --abbrev-ref HEAD`).
3. **Cada hijo** (en orden estable) en `join(wtPath, repo)`:
   - `git -C projectDir/repo fetch origin` — **best-effort**, se ignora el resultado/errores.
   - base = `remoteDefaultBranch(projectDir/repo)`: `symbolic-ref --short refs/remotes/origin/HEAD`
     → `origin/<def>`. Si no resuelve, `git remote set-head origin -a` y reintenta. Último
     fallback: rama actual del hijo (`currentBranch`).
   - `worktreeAdd(projectDir/repo, branch, base, join(wtPath, repo))`. Si falla → rollback.
4. **Rollback (todo o nada):** ante cualquier fallo en (2)/(3), remover los worktrees ya creados en
   **orden inverso** (hijos antes que el padre) con `worktreeRemove(..., { force: true })` —seguro,
   son worktrees recién creados sin trabajo del usuario— y borrar `wtPath` si quedó. Devuelve `false`.
5. Éxito → `true`.

`remoteDefaultBranch(repoDir, exec)` y `currentBranch(repoDir, exec)` son helpers nuevos en
`git.js` (con `exec` inyectable, como el resto).

### `worktreeRemove` gana `force` (`server/git.js`)

`worktreeRemove(projectDir, path, { force = false } = {}, exec)`:
- `force: false` (default, usado en `/kill`): `git worktree remove <path>` sin `--force` → si hay
  cambios sin commitear, git rechaza y se deja en disco (no se destruye trabajo).
- `force: true` (usado solo en el rollback del spawn): agrega `--force`.

### `/spawn` contenedor (`server/index.js`)

En el bloque de rama (cuando `branch` viene y es válida), antes de `worktreeAdd`:
- `const nested = findNestedRepos(dir)`.
- Si `nested.length > 0` → modo contenedor:
  - `{ path: wtPath, tmux } = worktreePaths(config.WORKTREES_DIR, basename(dir), branch)`.
  - colisión de tmux → `409` (igual que hoy).
  - `if (char) store.setPendingChar(tmux, char)`.
  - `if (!(await git.containerWorktreeAdd(dir, branch, wtPath, nested))) → 500`.
  - `tmux.newTmuxSession(tmux, wtPath)`; si falla → `500`. La sesión abre en `wtPath`, que
    contiene `back/front/ceo/server` (worktrees) + `.claude/docs/.sdd` (del padre).
  - `announcePending(tmux, { name: basename(dir), project: basename(dir), branch, char })`.
- Si `nested.length === 0` → camino single-repo actual (sin cambios).
- El campo `base` del body se **ignora en modo contenedor** (las bases se resuelven por repo).
  Sigue valiendo para single-repo.

`createApp` amplía `git` para incluir `findNestedRepos` y `containerWorktreeAdd` además de
`worktreeAdd`/`worktreeRemove`, para poder inyectar fakes en tests.

### `/kill` contenedor (`server/index.js`)

Al cerrar una sesión de worktree (`s.project && s.branch && s.tmux !== s.project`):
- `wtPath = worktreePaths(config.WORKTREES_DIR, s.project, s.branch).path`.
- `nested = findNestedRepos(projectDir)`.
- Si es contenedor: remover **primero cada worktree hijo** en `join(wtPath, repo)`
  (`worktreeRemove(projectDir/repo, …)`, sin force), **luego el padre** (`worktreeRemove(projectDir,
  wtPath)`, sin force). Si un hijo tiene cambios sin commitear, git lo deja → el padre tampoco se
  borra (su carpeta no queda vacía) → el conjunto sobrevive coherente y un re-spawn lo reutiliza.
- Si no es contenedor: comportamiento actual (un solo `worktreeRemove`).
- Best-effort: se ignoran resultados, el pod se quita igual.

### Reutilización / idempotencia

`worktreeAdd` ya reutiliza un worktree existente si está en la ruta esperada (cubre re-spawn de
una rama cuya sesión se cerró pero dejó la carpeta). Aplica por igual a padre e hijos: un re-spawn
de la misma rama reutiliza `wtPath` y cada `wtPath/<repo>`. Si la rama vive en un worktree fuera de
la ruta esperada (p.ej. el checkout principal), `worktreeAdd` devuelve `false` → rollback → `500`.

### UI (`habitat/client/`)

Sin cambios obligatorios. El campo `base` del wizard se ignora para proyectos contenedor (mejora
opcional futura: ocultarlo cuando el proyecto es contenedor). El chip del pod muestra la rama `B`
(el `gitBranch` del cwd = `wtPath` devuelve la rama del padre, que es `B`).

## Flujo de datos

```
[GUI: proyecto Artisano + rama B + personaje] --POST /spawn {dir,branch,base,char}--> server
  server: valida flag + whitelist + validBranch
  server: nested = findNestedRepos(dir)  → ['back','ceo','front','server']  (contenedor)
  server: containerWorktreeAdd(dir, B, wtPath, nested)
    ensureContainerRepo(dir)            # git init + .gitignore + commit (si falta .git)
    worktreeAdd(dir, B, ramaPadre, wtPath)          # padre: trae .claude/docs/.sdd
    para cada hijo R: fetch (best-effort); base=origin/HEAD; worktreeAdd(dir/R, B, base, wtPath/R)
    (si algo falla → rollback --force en orden inverso + rm wtPath)
  server: tmux new-session -d -s Artisano-B -c wtPath; send-keys 'claude'
claude arranca --SessionStart hook--> /hooks --> store --> WS --> pod nuevo (project=Artisano, branch=B)
```

## Manejo de errores

| Situación | Respuesta | Notas |
|---|---|---|
| spawn deshabilitado / dir fuera de whitelist / body inválido / rama inválida | `403`/`400` | igual que hoy |
| colisión de tmux (`Artisano-B` ya existe) | `409` | igual que hoy |
| auto-init del padre falla | `500` (vía `containerWorktreeAdd`→`false`) | |
| worktree del padre o de un hijo falla | `500` + rollback total | estado siempre coherente |
| rama ya existe en un worktree fuera de la ruta esperada | `500` + rollback | no se secuestra |
| `tmux new-session` falla | `500` | worktrees ya creados quedan (re-spawn los reutiliza) |

## Testing

Todo con `exec`/`fs` inyectados (sin tocar git/tmux/disco reales), patrón ya usado en el repo.

- **`git.test.js`** (nuevo):
  - `findNestedRepos`: detecta subcarpetas con `.git`; `[]` para repo plano; ignora archivos sueltos.
  - `currentBranch` / `remoteDefaultBranch`: parsean salida; fallbacks (`set-head -a`, luego HEAD).
  - `ensureContainerRepo`: no toca un repo ya inicializado; en repo nuevo arma init+gitignore+commit;
    no pisa `.gitignore` existente (solo agrega faltantes); `false` ante error de exec.
  - `containerWorktreeAdd`: orden padre→hijos; base del padre = su rama, base de hijo = origin/HEAD;
    fetch es best-effort (un fetch que falla no aborta); **rollback** remueve en orden inverso con
    `--force` y devuelve `false` cuando un hijo falla.
  - `worktreeRemove`: arma args con y sin `--force` según la opción.
- **`index.test.js`**: `/spawn` con `findNestedRepos` fake no vacío → llama `containerWorktreeAdd`
  y, si OK, `newTmuxSession(tmux, wtPath)` → `200 {name: 'Artisano-B'}`; si `containerWorktreeAdd`
  → `false` ⇒ `500`. `/spawn` con `nested=[]` sigue el camino single-repo intacto. `/kill` de una
  sesión contenedor remueve hijos antes que el padre.

## Fuera de alcance (YAGNI)

- Override manual de base por repo (hoy: auto por `origin/HEAD`).
- Lista fija/configurable de repos hijos (hoy: auto-detección de todos).
- Ocultar el campo `base` en la UI para contenedores (cosmético).
- Worktrees anidados de más de un nivel (solo subcarpetas inmediatas).
- Symlinks de la raíz (se descartó a favor de parent-git).
