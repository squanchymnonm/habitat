# Scroll de la terminal del drawer — Design

**Fecha:** 2026-06-21
**Componente:** `habitat/`
**Estado:** aprobado

## Objetivo

Poder scrollear hacia arriba la terminal del drawer con la rueda del mouse, para leer el
historial (output viejo de claude/tmux que se fue para arriba).

## Contexto

La terminal del drawer es un `xterm.js` (cliente, `useTerminal.ts`) conectado por WS `/term` a un
PTY del server (`term.js`) que hace `tmux attach-session -t <target>`. tmux corre en **pantalla
alternativa**, así que el historial scrolleable vive dentro de tmux (su copy-mode), no en el buffer
propio de xterm. Hoy la rueda no scrollea: tmux no tiene el modo mouse activado, así que la rueda no
entra a copy-mode.

## Decisión (brainstorming)

Se eligió el **modo mouse de tmux** (Approach A): activar `mouse on` para la sesión al attachear.
Con eso, tmux activa el reporte de mouse en la terminal, xterm.js reenvía la rueda
automáticamente, y tmux entra a copy-mode y scrollea su historial real.

Descartado: scrollback propio de xterm (no sirve con pantalla alternativa de tmux) y barra de
scroll arrastrable custom (Approach C — caro para lo que aporta).

## Arquitectura

Único punto de cambio: **`habitat/server/term.js`**, en `defaultSpawnPty`.

Hoy spawnea `tmux attach-session -t <target>`. El cambio antepone un `set-option mouse on` para esa
sesión, encadenado en la misma invocación de tmux (el `;` se pasa como argumento literal y tmux lo
trata como separador de comandos):

```
tmux set-option -t <target> mouse on ';' attach-session -t <target>
```

Para testear el armado de argumentos sin spawnear tmux real, se extrae una función pura:

```js
// Args de tmux para attachear con mouse on (rueda -> copy-mode). Exportada para test.
export function attachArgs(target) {
  return ['set-option', '-t', target, 'mouse', 'on', ';', 'attach-session', '-t', target];
}
```

`defaultSpawnPty` pasa a usar `pty.spawn('tmux', attachArgs(target), { ... })`.

### Por qué en el attach y no en `newTmuxSession`

Hacerlo en el attach (`term.js`) cubre **toda** sesión que abra el drawer, sin importar cómo se
creó (spawneada por el panel o creada por fuera). No se toca `newTmuxSession`.

### Por qué `-t <target>` y no `-g`

`set-option -t <target>` aplica la opción a la sesión que estás mirando, no a todas. Más contenido.

## Cliente

Sin cambios. xterm.js, una vez que tmux activa el reporte de mouse, reenvía la rueda al PTY por su
cuenta (comportamiento por defecto: cuando la app pide modo mouse, la rueda va a la app).

## Manejo de errores

Sin cambios respecto de hoy: si el `spawn` de tmux falla (sesión inexistente, etc.), el `try/catch`
existente en `term.js` cierra el WS con `1011 'pty failed'`. El `set-option` encadenado no agrega un
modo de falla nuevo relevante: si la sesión no existe, el attach fallaba igual.

## Tradeoff aceptado

`set-option -t <target> mouse on` **persiste** en la sesión tmux. Si después te attacheás desde tu
propia terminal, queda con mouse on (cambia un poco la selección con el mouse). Es tu sesión y
mouse-on es un default razonable.

## Testing

- **`term.test.js`**: `attachArgs('api')` deep-equals
  `['set-option','-t','api','mouse','on',';','attach-session','-t','api']` — verifica que `mouse on`
  va antes del `attach-session` y con el target correcto.

## Fuera de alcance (YAGNI)

- Barra de scroll arrastrable (Approach C).
- Subir el `history-limit` de tmux (se usa el default).
- Scroll en sesiones que no sean tmux.
