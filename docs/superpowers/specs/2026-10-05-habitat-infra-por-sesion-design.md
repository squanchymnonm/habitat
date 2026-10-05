# Habitat: infra docker y repos relacionados por sesión

Fecha: 2026-10-05
Estado: aprobado en brainstorming, pendiente de plan

## Problema

Cada sesión de Habitat corre en un worktree nuevo, y ese worktree nace sin nada de lo
necesario para levantar la infra del proyecto:

- El `.env` está gitignoreado, así que el worktree no lo tiene.
- La infra puede vivir en el mismo repo (lo común) o en otro (Artisano: el back está
  en `ARTISANO-BackEnd` y su docker en `ArtisanoDockerEnv`, configurado por `.env` con
  `APP_CODE_PATH_HOST`, `COMPOSE_PROJECT_NAME` y puertos del host).
- Dos sesiones del mismo proyecto en paralelo chocarían en nombres de containers y en
  puertos.
- Desde una sesión no hay acceso a los repos hermanos (front, CEO) del proyecto.

Hoy Habitat sólo **baja** stacks (al cerrar una sesión, y en el barrido de huérfanos);
no sabe levantarlos ni dónde están.

Contexto: Artisano hoy es un "proyecto contenedor" (padre + repos hijos). El usuario lo
va a desarmar para que cada repo de Artisano sea un proyecto individual en Habitat; este
diseño es lo que hace posible ese desarme.

## Decisiones

| Tema | Decisión |
|---|---|
| Aislamiento | Un stack aislado por worktree: containers, red, DB y puertos propios. |
| Quién levanta | Habitat prepara la infra apagada; Claude la levanta cuando la tarea lo necesita. La UI también puede levantarla y bajarla. |
| Infra externa | Worktree del repo de infra por sesión, en la misma rama. |
| Repos relacionados | Generalización: un proyecto tiene N repos relacionados; la infra es uno de ellos (o el propio repo). Todos se materializan al crear la sesión. |
| Plantillas `.env` | Las guarda Habitat (fuera de los repos), con variables que se resuelven por sesión. Editables desde Settings, con importación desde el checkout. |
| Persistencia | JSON con escritura atómica, como el resto de los stores. Migrar a una base de datos queda como mejora futura. |
| Entrega | Un spec y un plan, en dos PRs: (1) configuración y spawn, (2) infra en vivo. |

## 1. Modelo de datos

### Registro de proyecto (`.projects.json`)

Se agregan tres campos opcionales. Los registros existentes siguen siendo válidos y se
comportan exactamente igual que hoy.

```js
{
  dir, label, color, chars,                 // existentes
  related: [                                // default []
    { dir: '/home/mnonm/dev/proyectos/ArtisanoDockerEnv', name: 'infra' },
    { dir: '/home/mnonm/dev/proyectos/Artisano-FrontEnd',  name: 'front' },
  ],
  infra: {                                  // default null (sin infra docker)
    repo: 'infra',                          // 'self' o el name de un relacionado
    path: '',                               // subcarpeta del compose dentro de ese repo; '' = raíz
    up: 'make up',                          // '' = default 'docker compose up -d'
    down: 'make down',                      // '' = default 'docker compose down'
  },
  envFiles: [                               // default []
    { repo: 'self',  path: '.env' },
    { repo: 'infra', path: '.env' },
  ],
}
```

Validaciones de `projects.js`:

- `related[].dir`: absoluto, existente, repo git y contenido en `PROJECTS_ROOT` (mismo
  guard con `realpath` que `dirWithinRoot`). No puede ser el propio `dir` del proyecto.
- `related[].name`: único dentro del proyecto, distinto de `self`, y con el formato
  `^[A-Za-z0-9][A-Za-z0-9_.-]*$` (es el nombre de la carpeta en la sesión).
- `infra.repo`: `self` o un `related[].name` existente.
- `infra.path` y `envFiles[].path`: relativos, sin segmentos `..` y sin ser absolutos.
  Los `path` de `envFiles` no pueden estar vacíos.
- `envFiles[].repo`: `self` o un `related[].name` existente. El par (`repo`, `path`)
  es único.
- Si se quita un relacionado que todavía está referenciado por `infra` o `envFiles`, se
  devuelve 400 con la lista de referencias colgantes.

### Plantillas `.env`

- El contenido se guarda aparte, en `<HABITAT_ENVS_DIR>/<proyecto>/<repo>__<path>.env`.
  `HABITAT_ENVS_DIR` tiene como default `habitat/.habitat-envs/`. `<proyecto>` es el
  `basename(dir)`, que ya es único porque los nombres de tmux dependen de él. En `<path>`
  las `/` se codifican como `%2F`.
- El directorio se crea con permisos `0700` y los archivos con `0600`. Se escriben de
  forma atómica (tmp + rename).
- El contenido **nunca** va en `.projects.json`, en `GET /projects` ni en el broadcast
  `projects` del WebSocket. Sólo se obtiene por un endpoint dedicado y autenticado.
- Quitar un `envFile` borra su plantilla. Quitar un proyecto borra su carpeta de
  plantillas.

### Variables de plantilla

Sintaxis: `{{nombre}}` o `{{nombre:arg}}`. Cualquier otra cosa entre `{{ }}` es una
variable desconocida.

| Variable | Valor |
|---|---|
| `{{stack}}` | `<proyecto>-<rama>` en minúsculas, con todo lo que no sea `[a-z0-9_-]` reemplazado por `-`, y empezando por letra o dígito (las reglas de nombre de proyecto de compose). |
| `{{port:NOMBRE}}` | Un puerto de host asignado a la sesión. Cada `NOMBRE` distinto (`[a-z0-9_]+`) recibe uno, y el mismo nombre da el mismo puerto en todos los archivos de la sesión. |
| `{{path:self}}`, `{{path:<name>}}` | La ruta absoluta del worktree de ese repo en la sesión. |
| `{{branch}}` | La rama de la sesión. |

El render es una función pura en el módulo nuevo `server/env-template.js`:
`render(template, ctx) -> { ok, text } | { ok: false, unknown: [...] }`. Hay además un
`scan(template) -> { ports: [...], unknown: [...] }` que usan tanto la validación al
guardar (con los `related` del proyecto) como el spawn (para saber qué puertos asignar).

### Puertos

- El módulo nuevo `server/ports.js` asigna puertos dentro de `HABITAT_PORT_RANGE`
  (default `20000-29999`).
- Un puerto es candidato si no está asignado a otra sesión viva (según el store de
  estado) y si un probe confirma que está libre en el host (intentar `listen` en
  `0.0.0.0`). El probe es inyectable para los tests.
- Si el rango se agota, devuelve error.
- Los puertos asignados se guardan en la sesión (`.state.json`) como
  `infra: { stack, ports: { app: 20003, db: 20004 }, dir }`. Sobreviven a un reinicio
  del server y se liberan al borrar la sesión.

## 2. Ciclo de vida de una sesión

### Spawn (`POST /spawn`) de un proyecto con configuración

1. **Worktree principal**: igual que hoy, en `WORKTREES_DIR/<proyecto>/<rama>`.
2. **Relacionados**: para cada `related`, en orden:
   - `git fetch origin` (best-effort, igual que en `containerWorktreeAdd`).
   - Rama base: `remoteDefaultBranch` de ese repo.
   - `worktreeAdd(related.dir, rama, base, <wt>/.habitat-related/<name>)`.
   - Se agrega `/.habitat-related/` a `.git/info/exclude` del repo principal, de forma
     idempotente. Es local (directorio común de git) y no se commitea.
3. **Puertos**: `scan` de todas las plantillas del proyecto, y asignación de un puerto
   por cada nombre distinto.
4. **`.env`**: se hace el `render` de cada plantilla con el contexto
   `{ stack, ports, paths, branch }` y se escribe en `<worktree del repo>/<path>`, con
   permisos `0600` y creando las carpetas intermedias. Si el archivo ya existe en el
   worktree, se sobrescribe. Cada ruta escrita se agrega a `.git/info/exclude` de su
   repo (`/<path>`), para que no aparezca en `git status` y no impida el
   `worktree remove` del cierre.
5. **`CLAUDE.local.md`**: se genera en la raíz del worktree principal (Claude Code lo
   carga automáticamente) y se agrega `/CLAUDE.local.md` a `.git/info/exclude`. Si el
   proyecto no tiene `infra` ni `related`, no se genera. Contenido:
   - Una aclaración de que el archivo lo genera Habitat para esta sesión.
   - Si hay infra: la carpeta (relativa al worktree), los comandos para levantar y bajar,
     el nombre del stack, la tabla de puertos (`nombre → localhost:puerto`), y que la
     infra arranca apagada y se levanta sólo si la tarea lo necesita.
   - Si hay relacionados: la lista con su ruta relativa, y que cada uno está en su propia
     rama `<rama>`, por lo que los cambios ahí se commitean y se pushean desde ese repo.
6. **Sesión**: los datos de `infra` (`{ stack, ports, dir, branch }`, con `dir` = carpeta
   absoluta de infra o `null`, y `branch` = la rama con la que se crearon los
   worktrees) se pasan a `announcePending`. La adopción en `SessionStart` crea un objeto
   de sesión nuevo, así que `hooks-logic` copia `infra` de la sesión provisional a la
   real.

**Todo o nada.** Si falla cualquier paso del 2 al 5, se remueven con `--force` los
worktrees ya creados (los relacionados en orden inverso y después el principal), no se
persisten los puertos y se responde `500` con `{ error: "<motivo>" }`. Por ejemplo:
`falló el worktree de front` (`worktreeAdd` sólo devuelve un booleano), `el repo
relacionado front no existe`,
`no hay puertos libres en 20000-29999`, `plantilla infra/.env: variables desconocidas:
{{path:x}}`. El cliente (`useProjects.spawn`) muestra `error` si viene en el cuerpo.

Los proyectos sin `related`, sin `infra` y sin `envFiles` siguen exactamente el flujo
actual. Los proyectos contenedor (con repos anidados) también siguen igual; combinar
"contenedor" con "relacionados" no está soportado y se rechaza al guardar la
configuración.

### Cierre (`POST /kill`)

1. **Stack**: lo baja la limpieza existente (`dockerDown(wtPath)` con
   `DOCKER_CLEANUP`). Como la infra vive dentro del worktree de la sesión, su
   `working_dir` de compose cae adentro y `downForDir` la encuentra por labels. No se
   ejecuta el `down` del proyecto.
2. **Relacionados**: para cada uno, `worktreeRemove` sin forzar (si tiene cambios sin
   commitear, git lo rechaza y queda en disco). Si se removió, se ejecuta
   `git -C <related.dir> branch -d <rama>`, que sólo borra si la rama no tiene commits
   sin mergear. La rama se busca en `session.infra.branch` (no en `session.branch`,
   que cambia si la sesión hace checkout). Los fallos se ignoran (best-effort).
3. **Worktree principal**: igual que hoy, salvo que si dentro de `.habitat-related/`
   quedó algún worktree relacionado (sucio, o quitado de la configuración) el principal
   **no se remueve**: como `.habitat-related/` está en `info/exclude`, git lo vería limpio
   y lo borraría recursivamente junto con el trabajo anidado.
4. **Puertos**: se liberan al eliminar la sesión del store.

La lista de relacionados a limpiar se toma de la **configuración actual** del proyecto.
Si un relacionado se quitó de la configuración mientras había una sesión viva, su
worktree queda en disco y, con él, el worktree principal (ver paso 3). Ese caso se acepta.

## 3. UI

### Settings → Proyectos (PR 1)

Cada proyecto suma un botón **"configurar"** que despliega un panel con tres bloques:

1. **Repos relacionados**: la lista con nombre editable y ruta. "+ agregar" abre el
   navegador de carpetas existente, donde sólo se pueden elegir carpetas con `isRepo`.
   Cada uno tiene "quitar". Un relacionado cuyo `dir` ya no existe se marca en rojo.
2. **Infra**: un selector de repo (`ninguna` / `este repo` / cada relacionado), un campo
   de subcarpeta y dos campos para los comandos de levantar y bajar, con el default como
   placeholder.
3. **Archivos `.env`**: la lista de archivos (selector de repo + ruta), "+ agregar" y
   "quitar". Cada archivo tiene:
   - un editor de texto con fuente monoespaciada,
   - **"importar del checkout"**, que carga en el editor el contenido de
     `<dir del repo>/<path>` del checkout principal (si existe), sin guardar,
   - **"guardar"**: el server valida, y si hay variables desconocidas se muestran debajo
     del editor,
   - una ayuda plegable con las variables disponibles.

El contenido de las plantillas se pide al abrir el panel y no se cachea en el estado
global del cliente.

### Card de la sesión (`SessionPod`, PR 2)

Si la sesión tiene `infra`, la card muestra un indicador con tres estados:

- **arriba**: todos los containers del stack están `running`.
- **parcial**: hay containers, pero no todos están `running`.
- **apagado**: no hay containers.

Respeta los modos compacto y fino existentes: en el fino, sólo un punto de color.

### Panel de detalle (`DetailPanel`, PR 2)

El bloque **"Infra"** reemplaza al botón actual "bajar containers" cuando la sesión
tiene `infra`. Las sesiones sin `infra` conservan el botón actual. El bloque muestra:

- El estado y el nombre del stack.
- Los puertos, como links a `http://<location.hostname>:<puerto>`, que se abren en una
  pestaña nueva.
- **"levantar"**: llama a `POST /infra/up?id=`. Mientras corre, el botón queda ocupado.
  Si falla, se muestra el mensaje recortado.
- **"bajar"**: llama al `POST /docker/down?id=` existente.

## 4. Server: endpoints

PR 1:

- `PATCH /projects`: acepta además `related`, `infra` y `envFiles`, con las
  validaciones de la sección 1. 400 lleva `{ error }` con el motivo.
- `GET /projects/env?dir=&repo=&path=`: devuelve `{ content }` de la plantilla (vacío si
  no existe).
- `PUT /projects/env`: el cuerpo es `{ dir, repo, path, content }`. Hace el `scan`
  contra los `related` del proyecto: si hay variables desconocidas, 400 con
  `{ unknown }`; si no, guarda.
- `GET /projects/env/import?dir=&repo=&path=`: devuelve `{ content }` leído del checkout
  principal (`<dir del repo>/<path>`), con el guard de que el archivo resuelto quede
  dentro de ese repo. 404 si no existe.
- `GET /projects` no expone las plantillas. Sí expone `related`, `infra` y `envFiles`
  (sólo metadatos).

PR 2:

- `POST /infra/up?id=`: ejecuta `infra.up` (o el default) con `sh -c`, con
  `cwd = infra.dir` de la sesión y timeout de 15 minutos, dentro de
  `locks.run('infra:<id>')`. Responde `{ ok, message? }`; 409 si está ocupado.
- Polling: cada 15 segundos, una sola llamada a `docker ps -a` que trae el
  `working_dir` de compose y el estado de cada container. Para cada sesión con
  `infra.dir`, el estado sale de los containers cuyo `working_dir` cae dentro de esa
  carpeta (mismo criterio que la limpieza existente; no depende de que la plantilla
  use `{{stack}}` como `COMPOSE_PROJECT_NAME`). Si cambió, se actualiza
  `session.infra.state` (`up` | `partial` | `off`) y se hace broadcast de la sesión.
  Sin docker, el estado es `off`.
- Todo bajo el mismo cerco que spawn y kill: `ALLOW_SPAWN` y `authorize()`.

## 5. Errores

| Situación | Comportamiento |
|---|---|
| Falla un worktree relacionado en el spawn | Rollback completo + `{ error }` con el motivo. |
| El repo relacionado no existe | Igual que el anterior; Settings lo marca en rojo. |
| Rango de puertos agotado | Spawn rechazado con el motivo. |
| Variable desconocida | 400 al guardar; si igual llega al spawn, el spawn falla con el motivo. |
| `up` falla o vence el timeout | `{ ok: false, message }`. No se baja nada automáticamente. |
| `up` concurrente en la misma sesión | 409, que se muestra como "ocupado". |
| Docker ausente o daemon caído | Polling en `apagado` sin errores; "levantar" muestra el error. |
| Relacionado con cambios al cerrar | Queda en disco y su rama no se borra. |

## 6. Seguridad

- Las plantillas viajan sólo por endpoints autenticados, nunca por broadcast, y se
  guardan con permisos `0600` en un directorio `0700`.
- Los relacionados tienen que estar dentro de `PROJECTS_ROOT`, verificado con
  `realpath`.
- `infra.path` y `envFiles[].path` no pueden salirse de su repo, ni al guardar ni al
  escribir en el spawn (se verifica de nuevo la ruta resuelta).
- `infra.up` e `infra.down` son comandos de shell libres que define el usuario
  autenticado y que corren con su usuario. Es el mismo modelo de confianza y el mismo
  cerco (`ALLOW_SPAWN` + auth) que el spawn, que ya lanza procesos con ese usuario.

## 7. Testing

Servidor (`node:test`, tests junto al código, `exec` inyectable):

- `env-template.test.js`: render de cada variable, mismo `{{port:X}}` con el mismo
  puerto en varios archivos, `unknown` (nombres desconocidos, `path` de relacionado
  inexistente, sintaxis inválida), normalización de `stack`.
- `ports.test.js`: asignación dentro del rango, sin repetir con sesiones vivas, salto de
  puertos ocupados (probe stub), error con el rango agotado.
- `projects.test.js`: validación de `related`, `infra` y `envFiles` (incluye rutas que
  intentan escaparse y referencias colgantes), plantillas guardadas aparte con `0600`,
  borrado de plantillas al quitar.
- `git.test.js`: worktrees de relacionados con rollback; `branch -d` en el cierre sólo
  sin commits sin mergear.
- `index.test.js`, con repos git reales en tmp:
  - spawn con relacionados e infra: estructura de carpetas, `.env` renderizados con
    `0600`, `CLAUDE.local.md`, `info/exclude`, `infra` en la sesión,
  - rollback ante un fallo en un relacionado,
  - kill que limpia los relacionados y conserva el que tiene cambios,
  - endpoints de plantillas (validación, import, que no aparezcan en `GET /projects`),
  - PR 2: `infra/up` (exec stub, lock, timeout) y el polling con cambio de estado y
    broadcast.

Cliente (vitest + `@vue/test-utils`):

- Panel de configuración: relacionados, infra, editor de `.env` con importar, guardar y
  errores de validación.
- PR 2: indicador en `SessionPod` y bloque Infra en `DetailPanel` (estados, puertos,
  levantar/bajar).

E2E manual antes de cada PR, en una instancia aparte (no en producción): configurar
`ARTISANO-BackEnd` con `ArtisanoDockerEnv` como infra, lanzar dos sesiones en paralelo,
levantar ambos stacks, verificar que no choquen en puertos ni en nombres, cerrar y
verificar la limpieza.

## Fuera de alcance

- Desarmar el proyecto contenedor Artisano. Lo hace el usuario desde la UI una vez que
  esto esté disponible.
- Combinar proyectos contenedor con repos relacionados.
- Levantar la infra automáticamente al crear la sesión.
- Datos semilla o snapshot de la DB para los stacks nuevos.

## Mejoras futuras

- **Migrar la persistencia a una base de datos (SQLite).** Hoy hay cuatro stores JSON
  con escritura atómica (`state`, `projects`, `sessions`, `settings`), más las
  plantillas `.env`. El único que lo justificaría es `state.js`, que reescribe el
  archivo entero en cada hook y crece con el questbook. Se haría como un proyecto propio
  que migre todos los stores juntos, idealmente después de subir a Node 22+ para usar
  `node:sqlite` sin dependencias nativas (en Node 20 haría falta `better-sqlite3`). Las
  interfaces de los stores ya están encapsuladas, así que el cambio no tocaría
  `index.js`.
- Importar la definición de infra desde un `habitat.yml` versionado en el repo.
