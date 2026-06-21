# Hábitat — Terminal real + UX del drawer

Fecha: 2026-06-20
Estado: aprobado (diseño), pendiente plan de implementación

## Problema

Cinco issues reportados sobre el panel del Hábitat:

1. **Tipografía ilegible** — `NinjaAdventure` (pixel font) se usa en toda la app; a tamaños normales no se lee.
2. **Sin colores en la consola** — `capturePane` usa `tmux capture-pane -p`, que descarta ANSI; el `.term` muestra texto plano.
3. **Drawer no redimensionable** — ancho fijo `clamp(460px,48vw,960px)`, sin handle.
4. **Monstruo invisible al trabajar** — `monsterFromTodos` devuelve `null` salvo que haya un todo `in_progress`; trabajando con tool-use suelto no se asigna monstruo.
5. **No se puede interactuar con la terminal** — `sendKeys` sólo manda texto literal + Enter; no hay flechas/números/Esc para navegar los menús de Claude en la TUI.

## Decisiones tomadas (brainstorming)

- **#5 Interactividad:** terminal real con **xterm.js** (no botones ni captura sobre el preview).
- **#1 Tipografía:** **todo limpio** — una familia legible en toda la app, sin pixel font.
- **#4 Monstruo:** **genérico estable** derivado del nombre de la sesión cuando trabaja sin todos.
- La terminal real resuelve #2 (colores ANSI nativos) y #5 a la vez.
- **ChatPanel se elimina:** con terminal interactiva, el input de chat por `send-keys` queda redundante.

## Arquitectura

### Terminal real (resuelve #2 + #5)

**Server**
- Nueva dependencia: `node-pty` (binding nativo; requiere build tools — ver Riesgos).
- Nuevo endpoint WebSocket `/term?id=<id>&token=<t>`, token-gated igual que `/ws` hoy (los WS validan token, no loopback — `/ws` se dejó así a propósito para acceso remoto por VPN; el bind default es `127.0.0.1`).
- Por cada conexión `/term`:
  - Resolver la sesión (`store.get(id)`) y su nombre tmux (`s.tmux || s.name`).
  - Spawn de un PTY que corre `tmux attach-session -t <name>` (o variante agrupada, ver Sizing).
  - `pty.onData(d => ws.send(d))` — salida del PTY al cliente.
  - `ws.on('message')` — distinguir dos tipos:
    - bytes/texto de input → `pty.write(data)`.
    - mensaje JSON `{type:'resize', cols, rows}` → `pty.resize(cols, rows)`.
  - Al cerrar el WS: `pty.kill()` (mata el cliente attach, no la sesión).
- `/preview` y `capturePane` se mantienen sólo si algo más los usa; si no, se eliminan junto con `usePreview.ts`.

**Sizing de tmux (riesgo principal).** Attachear un segundo cliente tmux reajusta la ventana al cliente más chico. Para no encoger la terminal real del usuario:
- Setear `window-size latest` (la ventana toma el tamaño del último cliente activo) en el server al attachear, o
- attachear a una **sesión agrupada** (`tmux new-session -t <name>`) para aislar el tamaño.
- Se elige en el plan de implementación; `window-size latest` es el camino pragmático (acepta reflow al alternar foco).

**Cliente**
- Dependencias nuevas en `client/`: `@xterm/xterm` + `@xterm/addon-fit`.
- El `<pre class="term">` del drawer pasa a ser el contenedor de una instancia xterm.
- Nuevo composable `useTerminal(id)` (reemplaza `usePreview`):
  - Crea `Terminal` + `FitAddon`, lo monta en el div, abre WS `/term?id=&token=`.
  - `term.onData(d => ws.send(d))` — teclado del usuario al PTY (flechas, Enter, números, Esc, etc. nativo).
  - `ws.onmessage` → `term.write(data)`.
  - `fit()` al montar y en resize del drawer; enviar `{type:'resize',cols,rows}` al server.
  - Cleanup al cerrar el drawer / cambiar de sesión: cerrar WS y `term.dispose()`.
- `ChatPanel.vue` y su uso en `SessionDrawer.vue` se eliminan.

### #1 Tipografía — todo limpio

En `client/src/style.css`:
- Quitar `@font-face` de `NinjaAdventure` y las referencias en `--f-logo`/`--f-ui`/`--f-body`.
- `--f-ui` y `--f-body` → stack sans del sistema legible (p. ej. `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`).
- Terminal: stack monospace (xterm usa su propio `fontFamily`, p. ej. `ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace`).
- Quitar `word-spacing:5px` (parche del pixel font) y reajustar tamaños/letter-spacing que estaban inflados para compensar el pixel font.
- Mantener la estética RPG por color/bordes/sombras; sólo cambia la familia tipográfica.

### #3 Resize lateral del drawer

- Handle de drag en el borde izquierdo de `.drawer` (`SessionDrawer.vue`).
- Ancho del drawer en estado reactivo (ref), inicializado desde `localStorage` (clave p. ej. `habitat.drawerWidth`), con min/max.
- `mousedown` en el handle → listeners `mousemove`/`mouseup` que actualizan el ancho; al soltar, persistir en `localStorage`.
- Tras cada cambio de ancho: `fitAddon.fit()` y enviar `resize` al PTY para que la terminal reajuste cols/rows.

### #4 Monstruo siempre que trabaja

En `server/hooks-logic.js`:
- Tras `setStatus(... 'working' ...)`, si `s.monster == null`, asignar un monstruo genérico estable:
  - `s.monster = { type: hashType(s.name), isBoss: false, label: <acción o nombre> }`.
  - Estable mientras dure ese tramo de trabajo (no recalcular en cada hit si ya existe).
- Limpiar `s.monster = null` al volver a `idle`/`done`/`offline` (hoy ya se limpia en `SessionStart`; agregar en `Stop`/`SessionEnd` según corresponda para que no quede colgado).
- Los todos siguen teniendo prioridad: si `monsterFromTodos` devuelve un monstruo, ese manda (lógica actual intacta).

## Componentes afectados

| Archivo | Cambio |
|---|---|
| `habitat/package.json` | + `node-pty` |
| `habitat/server/ws.js` o nuevo `server/term.js` | endpoint WS `/term`, spawn PTY, bridge bidireccional + resize |
| `habitat/server/index.js` | wirear `/term`; (opcional) quitar `/preview` |
| `habitat/server/hooks-logic.js` | monstruo genérico al trabajar (#4) |
| `habitat/server/tmux.js` | (posible) helper de attach / window-size; `sendKeys` y `capturePane` quedan obsoletos |
| `habitat/client/package.json` | + `@xterm/xterm`, `@xterm/addon-fit` |
| `habitat/client/src/composables/useTerminal.ts` | nuevo; reemplaza `usePreview.ts` |
| `habitat/client/src/components/SessionDrawer.vue` | xterm en `.term`, handle de resize, sin ChatPanel |
| `habitat/client/src/components/ChatPanel.vue` | eliminado |
| `habitat/client/src/style.css` | tipografía limpia (#1), estilos de xterm, handle de resize |

## Flujo de datos (terminal)

```
Usuario teclea en xterm ──onData──> WS /term ──> pty.write ──> tmux attach ──> sesión claude
sesión claude (stdout) ──> tmux ──> pty.onData ──> WS /term ──> term.write ──> pantalla
resize drawer/ventana ──> fit() ──> {resize,cols,rows} ──> pty.resize
```

## Seguridad

El PTY da control total de la sesión vía WS. Mismo modelo de confianza que el chat→`send-keys` de `/ws` hoy (que ya da control de escritura): gated por `TOKEN`. Los WS NO restringen a loopback a propósito — el caso de uso incluye acceso remoto por VPN con token; el bind default es `127.0.0.1`. Si se bindea a una interfaz pública, setear `HABITAT_TOKEN` es obligatorio en la práctica. Sin cambios en el modelo respecto de `/ws`.

## Riesgos

- **`node-pty` nativo:** requiere toolchain de compilación al instalar. Si falla en la máquina objetivo, la terminal no levanta. Mitigación: documentar prerequisitos; fallback no contemplado (se asume entorno de dev local).
- **Sizing tmux multi-cliente:** la ventana puede reflowear al alternar foco entre la terminal real y la web. Aceptable; se ajusta con `window-size latest` o sesión agrupada.

## Fuera de alcance

- Bundlear un font propio (se usan stacks del sistema).
- Scrollback persistente / grabación de la terminal.
- Múltiples terminales simultáneas por sesión.
