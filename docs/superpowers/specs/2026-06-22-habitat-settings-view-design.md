# Vista Settings con permission-mode persistido

Fecha: 2026-06-22

## Objetivo

Agregar una vista de **Settings** a la GUI del hábitat y mover el `--permission-mode`
con el que se lanza Claude Code (hoy hardcodeado en `tmux.js`) a una setting global,
editable desde la GUI y persistida en disco.

## Contexto

- Cliente Vue sin router: `App.vue` muestra `SessionGrid` + `SessionDrawer` + `SpawnMenu`.
  El estado vive en stores/composables singleton (`useProjects`, `useSocket`).
- Servidor `node:http`: rutas `/projects`, `/spawn`, `/kill`, `/hooks`. Persistencia de
  sesiones en `state.js` → `.state.json` con escritura atómica (`.tmp` + `rename`).
- El "auto mode" se agregó hardcodeado en `tmux.js`: `newTmuxSession` envía
  `claude --permission-mode acceptEdits` al pane tmux.

## Decisiones de diseño

- **Presentación**: vista que reemplaza el grid (router casero con un `ref`), con toggle
  `[Sesiones] [⚙ Settings]` en el header. No drawer ni modal.
- **Forma de la setting**: selector de modo (`<select>`), no un toggle on/off. Mapea 1:1
  a `--permission-mode`.
- **Alcance**: una única setting **global** aplicada a toda sesión nueva.
- **Modos válidos**: `default`, `acceptEdits`, `plan`, `bypassPermissions`.
- **Default**: `acceptEdits` (preserva el comportamiento actual cuando no hay archivo).
- **Sólo afecta sesiones nuevas**: no se toca el permission-mode de un `claude` ya
  corriendo (no es posible cambiarlo desde afuera del proceso).

## Arquitectura

### Servidor

**`server/settings.js`** (nuevo)
- `createSettings({ persistPath })` con el mismo patrón atómico que `state.js`.
- Estado en memoria `{ permissionMode }`, respaldado en disco.
- `get()` → settings actuales.
- `set(patch)` → valida `permissionMode` contra el set permitido; si es inválido lo
  ignora (no rompe la setting previa) y devuelve indicación de éxito/fallo. Persiste si
  hubo cambio válido.
- Al construir: si el archivo no existe o está corrupto, arranca con default
  `{ permissionMode: 'acceptEdits' }`.

**`server/config.js`**
- Agregar `SETTINGS_PATH: process.env.HABITAT_SETTINGS || join(HERE, '..', '.settings.json')`.

**`server/index.js`**
- `createApp` recibe además `settingsStore`.
- `GET /settings` (autorizado) → `{ permissionMode }`.
- `POST /settings` (autorizado) → parsea body, `settingsStore.set(...)`; si el modo es
  inválido → `400`. Si ok → `200` con las settings y `hub.broadcast({ type:'settings', settings })`.
- En `/spawn`: leer `settingsStore.get().permissionMode` y pasarlo a `newTmuxSession`.
- En el arranque real: `createSettings({ persistPath: config.SETTINGS_PATH })`.

**`server/tmux.js`**
- `newTmuxSession(name, dir, exec, opts = {})` arma el comando según `opts.permissionMode`:
  - `'default'` o ausente → `claude`
  - otro modo válido → `claude --permission-mode <modo>`
- Deja de hardcodear `acceptEdits`.

### Cliente

**`client/src/App.vue`**
- `view = ref<'sessions' | 'settings'>('sessions')`.
- Header: botones `[Sesiones] [⚙ Settings]` que cambian `view`.
- `<main>` renderiza `SessionGrid` (sessions) o `SettingsView` (settings).

**`client/src/composables/useSettings.ts`** (nuevo, singleton)
- Patrón igual a `useProjects`: carga `GET /settings` una vez (con `authHeaders`).
- Expone `permissionMode` reactivo, `save(mode)` (POST), `error`.
- Se sincroniza con el broadcast `settings` por WS.

**`client/src/components/SettingsView.vue`** (nuevo)
- `<select>` con los 4 modos y una descripción corta de cada uno.
- Guarda al cambiar (llama `save`). Feedback de guardado/error.

**`client/src/composables/useSocket.ts`**
- Manejar el mensaje `{ type:'settings', settings }`: actualiza `permissionMode`.

## Flujo de datos

1. Usuario abre Settings → `useSettings` ya cargó `GET /settings`.
2. Cambia el modo en el `<select>` → `save(mode)` → `POST /settings`.
3. Server valida, persiste a `.settings.json`, broadcastea `settings`.
4. Otras pestañas reciben el broadcast y actualizan su `permissionMode`.
5. Al crear una sesión, `/spawn` lee la setting y lanza
   `claude [--permission-mode <modo>]` en la nueva sesión tmux.

## Manejo de errores

- Archivo de settings ausente/corrupto → default `acceptEdits` (no crash).
- `POST /settings` con modo inválido → `400`, setting previa intacta.
- Fallo de red en el cliente al guardar → `error` visible, no rompe la vista.

## Tests

- **`server/settings.test.js`**: default sin archivo; load desde archivo; persist atómico;
  rechazo de `permissionMode` inválido (mantiene el previo).
- **`server/tmux.test.js`**: actualizar el test de `newTmuxSession` para verificar el
  comando por modo, incluido `default`/ausente → `claude` pelado y un modo → flag correcto.
- **`server/index.test.js`**: `GET /settings` (ok); `POST /settings` ok + broadcast;
  `POST` con modo inválido → `400`; `/spawn` usa el modo guardado.
