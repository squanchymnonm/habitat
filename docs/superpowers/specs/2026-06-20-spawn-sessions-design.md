# Abrir sesiones tmux desde el panel — Design

**Fecha:** 2026-06-20
**Componente:** `habitat/`
**Estado:** aprobado

## Objetivo

Permitir crear una sesión de Claude Code desde la GUI del Hábitat: el usuario elige un
proyecto de una lista configurada y el server lanza `claude` dentro de una sesión tmux nueva.
El pod correspondiente aparece solo en el panel cuando `claude` dispara `SessionStart`.

## Contexto

Hoy el Hábitat **observa** sesiones (hooks → store → WS) y permite enviar texto a una sesión
existente (`tmux send-keys`, vía endpoint WS `chat`). Toda la superficie está detrás de Bearer
token + bind a loopback (Ley 1). Helpers de tmux ya existentes en `habitat/server/tmux.js`:
`capturePane`, `listSessions`, `sendKeys`, `gitBranch`.

Crear sesiones es una **escalación de capacidad**: el panel pasa a spawnear procesos en la
máquina. Por eso se gatea con un flag explícito y una whitelist de directorios.

## Arquitectura

Dos endpoints HTTP nuevos (mismo patrón `authorize()` = token + loopback que `/hooks` y
`/preview`), una función nueva en `tmux.js`, y un control en el header del front Vue. No se
pre-registra la sesión en el store: el hook `SessionStart` de `claude` la reporta al arrancar.

### Config (`habitat/server/config.js`)

Dos variables nuevas, leídas de `process.env` con defaults:

- `HABITAT_ALLOW_SPAWN` → `ALLOW_SPAWN: boolean` (default `false`). `'1'`/`'true'` lo habilitan.
- `HABITAT_PROJECTS` → `PROJECTS: string[]` (default `[]`). Rutas absolutas separadas por `:`
  (estilo `PATH`). Se filtran vacíos. No se normalizan ni resuelven symlinks: la comparación
  de whitelist es por igualdad exacta de string contra lo que mande el cliente.

### Endpoints (`habitat/server/index.js`)

Ambos exigen `authorize(req, res)` (token + loopback) antes de cualquier otra cosa.

**`GET /projects`** → `200 { canSpawn, projects }`
- `canSpawn` = `config.ALLOW_SPAWN && config.PROJECTS.length > 0`.
- `projects` = `config.PROJECTS.map(dir => ({ name: basename(dir), dir }))`.
- El front usa `canSpawn` para mostrar u ocultar el botón.

**`POST /spawn { dir }`** → `200 { name }` | error. Orden de validación (importa):
1. Si `!config.ALLOW_SPAWN` → `403`.
2. Parsear body; si no es JSON válido o no trae `dir` string → `400`.
3. Si `dir` no está en `config.PROJECTS` (igualdad exacta) → `403`.
4. `name = basename(dir)`. Si `listSessions()` ya incluye `name` → `409`.
5. OK: `await newTmuxSession(name, dir)`; si devuelve `false` → `500`; si `true` → `200 { name }`.
- No hace `broadcast`: el pod llega por el hook `SessionStart`.

### Inyección de dependencias (testabilidad)

`createApp` ya recibe `{ config, store }`. Se amplía a `createApp({ config, store, tmux })` donde
`tmux` (opcional) provee `{ listSessions, newTmuxSession }` y por default son las
implementaciones reales de `tmux.js`. Los tests de `/spawn` inyectan fakes para cubrir
colisión→409 y OK→200 sin tmux instalado. (Mismo patrón que `deps` en `applyEvent`.)

### tmux (`habitat/server/tmux.js`)

Función nueva `newTmuxSession(name, dir, exec = defaultExec)` → `Promise<boolean>`:
1. `await exec('tmux', ['new-session', '-d', '-s', name, '-c', dir])` — shell de login en el dir.
2. `await sendKeys(name, 'claude', exec)` — lanza Claude Code; hereda PATH/rc del shell y los
   hooks de `~/.claude/settings.json` reportan la sesión.
3. Devuelve `true`; ante error de `exec` devuelve `false` (y el endpoint responde `500`).

`name = basename(dir)` es deliberado: `preview` y `chat` ya usan `session.name` como target de
tmux, así que la sesión creada queda direccionable sin cambios.

### Front (`habitat/client/`)

- Composable/acción que hace `GET /projects` al iniciar (con el token de la query, igual que
  `usePreview`).
- Si `canSpawn`, el header muestra un botón **`+ NUEVA SESIÓN`** (reusa `button.ctl`, estilo
  pixel medieval).
- Click → panel/dropdown con la lista de `projects` (un `button.ctl` por proyecto, mostrando
  `name`). Click en un proyecto → `POST /spawn { dir }`.
- Éxito: feedback breve; el pod aparece en ~1-2s vía hook. Error: muestra el motivo
  (`409` = "ya existe una sesión", `403` = "no permitido").

## Flujo de datos

```
[GUI header "+"] --GET /projects--> server (token) --> {canSpawn, projects}
[GUI elige proyecto] --POST /spawn {dir}--> server
    server: valida flag + whitelist + colisión
    server: tmux new-session -d -s <name> -c <dir>; send-keys 'claude' Enter
claude arranca --SessionStart hook--> POST /hooks --> store.upsert --> WS broadcast --> pod nuevo
```

## Manejo de errores

| Situación | Respuesta | UI |
|---|---|---|
| spawn deshabilitado | `403` | botón oculto (canSpawn=false); si igual llega, "no permitido" |
| `dir` fuera de whitelist | `403` | "proyecto no permitido" |
| sesión tmux ya existe | `409` | "ya hay una sesión para ese proyecto" |
| body inválido | `400` | "pedido inválido" |
| tmux falla | `500` | "no se pudo crear la sesión" |

## Testing

- **`tmux.test.js`**: `newTmuxSession` arma los args correctos (`new-session -d -s name -c dir`
  + `send-keys` literal `claude` + `Enter`); ante error de exec devuelve `false`.
- **`config.test.js`**: `ALLOW_SPAWN` y `PROJECTS` parsean con defaults sensatos.
- **`index.test.js`**: `/projects` refleja `canSpawn` (on/off); `/spawn` deshabilitado→403,
  dir fuera de whitelist→403, colisión→409, body inválido→400, OK→200 con `name`
  (inyectando un exec/listSessions fake para no tocar tmux real).
- **e2e in-process**: `GET /projects` con flag on devuelve la whitelist; con flag off
  `canSpawn=false`.

## Fuera de alcance (YAGNI)

- Matar/cerrar/attachar sesiones desde el panel.
- Rutas libres por input de texto.
- Comandos arbitrarios (solo `claude`).
- Escaneo automático de un directorio padre.
