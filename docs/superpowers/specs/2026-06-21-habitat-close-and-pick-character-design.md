# Cerrar sesiones y elegir personaje desde la GUI — Design

**Fecha:** 2026-06-21
**Componente:** `habitat/`
**Estado:** aprobado

## Objetivo

Dos capacidades nuevas en el panel del Hábitat:

1. **Cerrar una sesión** desde la GUI: matar el proceso `tmux`+`claude` y quitar el pod del
   panel, con confirmación previa.
2. **Elegir el personaje** (sprite del héroe) al crear una sesión, en vez de derivarlo siempre
   por hash del nombre.

## Contexto

El Hábitat observa sesiones (hooks de Claude Code → `POST /hooks` → store → WS broadcast) y
permite spawnear nuevas (`POST /spawn`, gateado por `HABITAT_ALLOW_SPAWN` + whitelist
`HABITAT_PROJECTS`). Toda la superficie está detrás de Bearer token + bind a loopback (Ley 1).

Hechos relevantes del código actual:

- Las sesiones **nacen del hook `SessionStart`**, keyed por `session_id` (UUID que genera
  `claude`). El `/spawn` lanza tmux+claude pero **no conoce ese `session_id`**; el pod aparece
  1-2s después vía el hook.
- El sprite del héroe se deriva 100% en el cliente: `charFor(name)` hashea el nombre de la
  sesión a un índice de `CHARS` en `habitat/client/src/sprites.ts` (16 personajes).
- El canal `remove` por WS ya está definido (`types.ts`) y cableado en el cliente
  (`useSocket` → `store.remove`), pero **hoy nadie lo emite**.
- `createApp({ config, store, tmux })` ya inyecta `tmux` para testabilidad; el store
  (`createStore`) ya respalda a disco (`persist()` en `upsert`/`remove`).

Cerrar sesiones es, como spawnear, una **escalación de capacidad** (el panel mata procesos en
la máquina). Por eso se gatea con el mismo flag `ALLOW_SPAWN`.

## Decisiones (brainstorming)

- **Cerrar** = matar el proceso (best-effort `tmux kill-session`) **y** quitar el pod, en una
  sola acción. Si el proceso ya estaba muerto, igual limpia el pod.
- **Confirmar siempre** antes de matar (se pierde trabajo en curso).
- El botón de cerrar vive en **dos lugares**: una × en la esquina del pod (al hover) y un botón
  "✕ CERRAR SESIÓN" en el drawer de detalle.
- Elegir personaje es un **wizard**: primero el proyecto, después la grilla de personajes.

---

## Feature 1 — Cerrar sesión

### tmux (`habitat/server/tmux.js`)

Función nueva `killTmuxSession(name, exec = defaultExec)` → `Promise<boolean>`:

1. `await exec('tmux', ['kill-session', '-t', name])`.
2. Devuelve `true`; ante error de `exec` devuelve `false` (best-effort: el endpoint igual
   quita el pod, ver abajo).

### Endpoint (`habitat/server/index.js`)

`createApp` amplía las deps de tmux a `{ listSessions, newTmuxSession, killTmuxSession }`
(defaults a las implementaciones reales).

**`POST /kill { id }`** — orden de validación (importa):

1. `authorize(req, res)` (token + loopback).
2. Si `!config.ALLOW_SPAWN` → `403`.
3. Body no-JSON o `id` no-string → `400`.
4. `s = store.get(id)`; si no existe → `404`.
5. `await tmux.killTmuxSession(s.tmux || s.name)` — **se ignora el resultado** (el proceso puede
   estar muerto; igual limpiamos el pod).
6. `store.remove(id)` (ya persiste a disco).
7. `hub.broadcast({ type: 'remove', id })`.
8. `200`.

`s.tmux || s.name` replica el target que ya usan `preview` y `chat`.

### Anti-zombie (`habitat/server/hooks-logic.js`)

Al matar la sesión, `claude` recibe SIGHUP y puede emitir un `SessionEnd` tardío. Hoy `ensure()`
**recrea** la sesión para cualquier evento, así que ese `SessionEnd` resucitaría el pod como
"offline". Cambio: en `applyEvent`, si `ev === 'SessionEnd'` y `!store.get(session_id)`, es
**no-op** (no se crea ni se procesa). Crear una sesión nueva sólo para marcarla offline no aporta
nada de todos modos.

Edge residual aceptado: si `claude` alcanzara a emitir otro evento (p.ej. `PostToolUse`) entre el
`kill` y el broadcast, podría recrear el pod. Es improbable (SIGHUP no deja correr más hooks de
herramienta) y queda fuera de alcance un tombstone explícito.

### Front (`habitat/client/`)

- `useProjects` se convierte en **singleton de módulo** (estado `canSpawn`/`projects` a nivel de
  módulo, fetch una sola vez, como `useSocket`) y agrega `kill(id)`:
  `POST /kill { id }`. No remueve localmente: el broadcast `remove` por WS lo hace.
- `SessionPod.vue`: × roja en la esquina superior derecha, visible al hover, `v-if="canSpawn"`.
  `@click.stop` (no debe seleccionar el pod). Dispara confirmación → `kill(id)`.
- `SessionDrawer.vue`: botón rojo "✕ CERRAR SESIÓN" en el detalle, **separado** de la × que sólo
  cierra el drawer. Mismo flujo de confirmación.
- Confirmación: `confirm('¿Cerrar la sesión "<name>"? Se perderá el trabajo en curso.')`.

---

## Feature 2 — Elegir personaje al crear (wizard)

### El problema de asociación

El `/spawn` no conoce el `session_id` (lo genera `claude` al arrancar y llega por `SessionStart`).
La clave de unión disponible es el **nombre** = `basename(cwd)` = `basename(dir)`, único mientras
la sesión vive (el 409 de `/spawn` impide dos sesiones con el mismo nombre). Se usa un **pending
char** keyed por nombre, que `SessionStart` consume.

### Lista canónica de personajes

Módulo nuevo del server con `export const CHARACTERS = [...]` (los 16 de `sprites.ts`), con
comentario que lo liga al cliente (mismo patrón de contrato duplicado que `types.ts` ↔
`state.js`). Sirve para validar el `char` en `/spawn`.

### Store (`habitat/server/state.js`)

El store gana un `Map` en memoria (no persistido — la ventana es de ~1-2s):

- `setPendingChar(name, char)`
- `takePendingChar(name)` → devuelve el char y lo borra (one-shot).

### Endpoint (`habitat/server/index.js`)

`POST /spawn` acepta `{ dir, char? }`:

- Tras validar `dir` (igual que hoy), si `char` viene y **no** está en `CHARACTERS` → `400`.
- Si `char` es válido, `store.setPendingChar(name, char)` antes de `newTmuxSession`.
- El resto del flujo (colisión 409, `newTmuxSession`, `200 { name }`) no cambia.

### Hook (`habitat/server/hooks-logic.js`)

En `SessionStart`, tras setear `s.name = basename(cwd)`:

```js
const c = store.takePendingChar(s.name);
if (c) s.char = c;
```

`char` es un campo normal de la sesión: ya se serializa a disco (`persist`) y viaja por WS
(no empieza con `_`, sobrevive `stripInternal`/`snapOf`).

### Front (`habitat/client/`)

- `types.ts`: `Session` gana `char?: string`.
- `sprites.ts`: exporta `CHARACTERS`; `heroIdle(name, char?)` y `faceFor(name, char?)` usan
  `char` si es un personaje válido, si no caen al hash actual (`charFor`).
- `SpawnMenu.vue`: máquina de estados `cerrado → proyectos → personaje(dir) → spawning`.
  - Click "+ NUEVA SESIÓN" → lista de proyectos (como hoy).
  - Click en un proyecto → la lista se reemplaza por la **grilla de 16 caras** (`face.png`) +
    un tile **"Auto"** (spawnea sin char = comportamiento actual) + botón "← volver".
  - Click en una cara → `spawn(dir, char)`; éxito cierra el menú.
- `useProjects.spawn(dir, char?)` manda `{ dir, char }`.
- `SessionPod.vue` y `SessionDrawer.vue` pasan `session.char` a `heroIdle`/`faceFor`.

---

## Flujo de datos

```
# Cerrar
[× pod / botón drawer] --confirm--> POST /kill {id} --> server (token+loopback, ALLOW_SPAWN)
    server: killTmuxSession(name) [best-effort] ; store.remove(id) ; broadcast remove
WS remove --> store.remove(id) --> pod desaparece

# Crear con personaje
[+] --GET /projects--> {canSpawn, projects}
[elige proyecto] -> grilla de personajes
[elige personaje] --POST /spawn {dir, char}--> server: valida char, setPendingChar(name,char),
    tmux new-session + send-keys 'claude'
claude --SessionStart {cwd}--> POST /hooks --> takePendingChar(name) -> s.char --> broadcast session
pod nuevo con el sprite elegido
```

## Manejo de errores

| Situación | Server | UI |
|---|---|---|
| kill sin `ALLOW_SPAWN` | `403` | botón oculto (`canSpawn=false`) |
| kill body inválido / sin `id` | `400` | (no debería pasar) |
| kill de sesión inexistente | `404` | se ignora; el pod ya no está |
| `tmux kill-session` falla (proceso muerto) | igual `200` | el pod se quita igual |
| spawn con `char` fuera de `CHARACTERS` | `400` | "personaje no válido" |

## Testing

- **`tmux.test.js`**: `killTmuxSession` arma `['kill-session','-t',name]`; ante error de exec
  devuelve `false`.
- **`index.test.js`**: `/kill` deshabilitado→403, body inválido→400, id desconocido→404, OK→200
  (verifica que removió del store y que hizo `broadcast({type:'remove', id})`, con un hub fake).
  `/spawn` con `char` inválido→400; con `char` válido→`setPendingChar` invocado (store fake) y
  `200`.
- **`hooks-logic.test.js`**: `SessionStart` con pending char → `s.char` seteado; sin pending →
  `s.char` undefined (cae al hash); `takePendingChar` es one-shot (segundo `SessionStart` del
  mismo nombre no reusa). `SessionEnd` sobre `session_id` inexistente → no crea sesión.
- **`state.test.js`**: `setPendingChar`/`takePendingChar` (one-shot; `take` de inexistente →
  undefined).

## Fuera de alcance (YAGNI)

- Re-skinear el personaje de una sesión ya existente (la pedida es "al crear").
- Cerrar varias sesiones a la vez / "cerrar todas".
- Persistir los pending chars a disco.
- Tombstone explícito anti-resurrección más allá del no-op de `SessionEnd`.
