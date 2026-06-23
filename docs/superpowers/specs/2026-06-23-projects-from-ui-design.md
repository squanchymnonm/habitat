# Gestión de proyectos desde la UI

**Fecha:** 2026-06-23
**Estado:** aprobado, listo para plan

## Problema

Hoy la lista de proyectos spawneables sale exclusivamente de `HABITAT_PROJECTS`
(rutas absolutas separadas por `:`, leídas en `config.js`). Para sumar un proyecto
hay que tocar el entorno y reiniciar el server. Tampoco hay forma visual de
distinguir a qué proyecto pertenece cada pod más allá del texto del nombre/rama.

Queremos:
1. Gestionar la lista de proyectos **desde la UI** (no solo desde el `.env`), con
   persistencia en disco.
2. Un botón **"agregar proyecto"** que abra un navegador de carpetas del servidor,
   acotado a una raíz configurable por env.
3. Asignar un **color** por proyecto, que se usa como **tinte de fondo del pod**
   para diferenciarlos de un vistazo.

## Decisiones de diseño (resueltas en brainstorming)

- **La UI gestiona la lista completa y la persiste**; `HABITAT_PROJECTS` solo
  **siembra** la lista la primera vez (backwards-compat con setups actuales).
- Nuevo env `HABITAT_PROJECTS_ROOT` = carpeta raíz para navegar. La navegación es
  **recursiva** (entrar a subcarpetas, breadcrumbs), pero **no se puede salir del
  root** (guard contra path traversal).
- El color se elige de una **paleta fija** (~12 colores pixel-art, alto contraste
  sobre el fondo oscuro), no un color picker libre.
- El color se refleja como **tinte de fondo tenue** del pod (no pisa el borde/glow
  de estado).
- Operaciones de gestión: **agregar, eliminar, editar color, renombrar label, y
  allowlist de personajes** por proyecto.
- La gestión (alta con browser + editar/borrar) vive en **Settings**
  (`SettingsView`). El `SpawnMenu` solo consume la lista.

## Modelo de datos

Nuevo store persistido `server/projects.js`, mismo patrón que `server/settings.js`
(carga al iniciar, escritura atómica vía `.tmp` + `rename`).

Cada proyecto:

```js
{
  dir:   "/abs/path",      // identidad única; debe existir en disco
  label: "RPG-Agents",     // nombre mostrado; default = basename(dir); editable
  color: "#e7c14a",        // hex perteneciente a la paleta fija
  chars: []                // allowlist opcional de personajes; [] = todos disponibles
}
```

- **Identidad:** `dir` (absoluto, único). Alta duplicada sobre el mismo `dir` se
  rechaza.
- **Seed:** si el archivo persistido (`.projects.json`) no existe al iniciar, se
  inicializa una sola vez desde `config.PROJECTS` (lo que haya en
  `HABITAT_PROJECTS`): `{ dir, label: basename(dir), color: <determinístico por
  hash(dir) sobre la paleta>, chars: [] }`. Después del seed, manda siempre el
  store; `HABITAT_PROJECTS` deja de leerse para la lista.
- Un proyecto sembrado puede estar **fuera** de `PROJECTS_ROOT` (era confiable); eso
  está permitido. La restricción al root aplica solo al **navegar/agregar** nuevos.

## Paleta de colores

Lista fija de hex compartida entre server y cliente:
- `server/palette.js` → array de hex para **validación** (`PALETTE.includes(color)`).
- `client/src/palette.ts` → misma lista para **swatches** y para mapear color→render.

Son dos copias de una lista chica y estable; se mantienen en sync a mano. ~12
colores con buen contraste sobre el fondo `#1a1a24`.

## Configuración (`server/config.js`)

Nuevas claves:
- `PROJECTS_ROOT: process.env.HABITAT_PROJECTS_ROOT || ''` — raíz para navegar
  carpetas. Si está vacío, navegar/agregar queda deshabilitado.
- `PROJECTS_STATE: process.env.HABITAT_PROJECTS_STATE || join(HERE, '..', '.projects.json')`
  — ruta del store persistido.

`PROJECTS` (de `HABITAT_PROJECTS`) se conserva, pero pasa a usarse **solo como
semilla** del store.

## Endpoints (server `index.js`)

Todos requieren auth (token). Los de escritura y el browse requieren además
`ALLOW_SPAWN`.

- `GET /projects` → `{ canSpawn, projects: [{ dir, name, color, chars }] }`, leído
  del store. `name` = `label` (se mantiene la clave `name` por compat con el
  cliente actual). `canSpawn = ALLOW_SPAWN && projects.length > 0`.

- `GET /projects/browse?path=<rel>` → lista los hijos **inmediatos** del directorio
  `PROJECTS_ROOT/<rel>`: `{ entries: [{ name, rel, isRepo }], breadcrumbs: [...] }`.
  `isRepo` = la carpeta contiene `.git` (o es contenedor de repos), como pista
  visual. **Guard:** se resuelve el realpath y debe empezar con el realpath de
  `PROJECTS_ROOT`; cualquier intento de `..` o symlink que escape → 400. 403 si
  `!ALLOW_SPAWN` o `PROJECTS_ROOT` vacío.

- `POST /projects` → alta. Body `{ dir, label?, color, chars? }`. Validaciones:
  - `dir` resuelve dentro de `PROJECTS_ROOT` y existe como directorio.
  - `dir` no está ya en la lista.
  - `color` ∈ paleta.
  - `chars` (si viene) ⊂ `CHARACTERS`.
  - `label` default = `basename(dir)`.
  Persiste y hace broadcast WS `{ type: 'projects', projects }`. Devuelve el record.

- `PATCH /projects` → edición. Body `{ dir, label?, color?, chars? }`. Edita los
  campos provistos del proyecto identificado por `dir` (mismas validaciones de
  color/chars). Persiste + broadcast.

- `DELETE /projects` → baja. Body `{ dir }`. Quita el proyecto de la lista. **No
  toca el disco.** Las sesiones activas de ese proyecto siguen corriendo y se pueden
  cerrar normalmente; solo deja de aparecer para spawnear. Persiste + broadcast.

## Cambios en spawn / kill

- `POST /spawn`: la validación del `dir` pasa a consultar el **store** (en vez de
  `config.PROJECTS.includes(dir)`). Además, si el proyecto tiene `chars` no vacío y
  el body trae `char`, ese `char` debe pertenecer a la allowlist del proyecto
  (además de ser un `CHARACTERS` válido); si no, 400.
- `POST /kill`: el lookup del directorio del proyecto para limpiar el worktree
  (`config.PROJECTS.find(d => basename(d) === s.project)`) pasa a buscar en el
  store por `basename(dir) === s.project`.

## WebSocket

Nueva variante server→cliente: `{ type: 'projects'; projects: Project[] }`,
emitida tras cada alta/edición/baja. El cliente reacciona refrescando su lista
(igual criterio que el mensaje `settings`).

## Cliente

### Tipos (`types.ts`)
- `Project` (en `useProjects`) gana `color: string` y `chars?: string[]`.
- `ServerMessage` suma `{ type: 'projects'; projects: Project[] }`.

### `composables/useProjects.ts`
- `Project` extendido con `color`/`chars`.
- Nuevas acciones: `browse(path)`, `addProject({dir,label,color,chars})`,
  `updateProject({dir,...})`, `removeProject(dir)`.
- Al recibir el WS `projects` (o tras una mutación), refetch/actualiza la lista
  compartida (singleton a nivel módulo, como hoy).
- Helper `colorForProject(name)` → hex del proyecto cuyo `name`/label coincide con
  el `project` (basename) de la sesión; default neutro si no hay match.

### `components/ProjectsManager.vue` (nuevo, dentro de `SettingsView`)
- Lista de proyectos: swatch de color + label + resumen de chars permitidos.
- Por proyecto: editar color (selector de paleta), renombrar label, editar chars
  (multi-select sobre `CHARACTERS`), eliminar.
- Botón **"+ Agregar proyecto"**: abre un **navegador recursivo de carpetas**
  (breadcrumbs + entrar a subcarpetas dentro del root, marcando `isRepo`). Al
  elegir una carpeta, formulario de alta: label (default = basename), color
  (paleta), chars (opcional). Submit → `addProject`.
- Si `PROJECTS_ROOT` no está configurado / `!canSpawn`, el botón de agregar no
  aparece (o se muestra deshabilitado con explicación).

### `components/SettingsView.vue`
- Suma la sección `<ProjectsManager />` debajo del permission mode.

### `components/SpawnMenu.vue`
- Cada item de proyecto muestra su swatch de color.
- `pickProject` guarda los `chars` del proyecto elegido. En el paso de personaje,
  los botones se **filtran a esa allowlist** si está seteada; si está vacía, se
  muestran todos los `CHARACTERS` (comportamiento actual).

### `components/SessionPod.vue`
- Aplica un **tinte de fondo tenue** derivado de `colorForProject(session.project)`
  (p. ej. vía variable CSS `--proj` y `color-mix`/rgba de baja opacidad sobre el
  fondo del pod), sin tocar el borde/glow que ya usa el estado.

## Testing

### Server
- `projects.test.js` (nuevo): seed desde `PROJECTS` cuando no hay archivo; alta y
  dedupe por `dir`; edición de color/label/chars; baja; validaciones (color fuera
  de paleta, char fuera de `CHARACTERS`, dir inexistente, dir duplicado).
- Browse: test de **path traversal** (`..`, ruta absoluta, symlink que escapa) →
  rechazo; listado correcto de hijos con `isRepo`.
- Spawn: char fuera de la allowlist del proyecto → 400; dir no presente en el store
  → 403.

### Cliente
- `useProjects`: alta/edición/baja actualizan la lista; reacción al WS `projects`.
- Filtro de personajes en `SpawnMenu` según `chars` del proyecto.
- `colorForProject` mapea correctamente y tiene default neutro.

## Documentación

Actualizar `habitat/README.md`: documentar `HABITAT_PROJECTS_ROOT`, el nuevo flujo
de gestión desde la UI, y que `HABITAT_PROJECTS` ahora solo siembra la lista.

## Fuera de alcance (YAGNI)

- Color picker libre / colores arbitrarios fuera de la paleta.
- Borrar carpetas del disco desde la UI.
- Reordenar/agrupar proyectos.
- Permisos por usuario (sigue siendo single-token).
