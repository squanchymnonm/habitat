# Refactor de copy/paste en la terminal de Habitat

Fecha: 2026-06-27
Branch: `ellie`

## Problema

La mecánica de copiar/pegar en la terminal web de Habitat (xterm sobre un PTY
que attachea a tmux con `mouse on`) funciona mal:

1. **`Ctrl+V` no pega.** El handler solo intercepta `Ctrl+Shift+V` (o `Cmd+V` en
   Mac). `Ctrl+V` pelado se ignora a propósito y se manda al pty como carácter de
   control `^V` (quoted-insert), que no hace nada útil.
2. **`Ctrl+Shift+V` funciona "a veces".** En contexto seguro (https/localhost) se
   lee el portapapeles con `navigator.clipboard.readText()` y anda. En contexto
   inseguro (HTTP por LAN, p. ej. la tablet) `readText` no existe; el código no
   hace `preventDefault` esperando que el navegador dispare el evento `paste`
   nativo — pero los navegadores **no** disparan `paste` con `Ctrl+Shift+V` (sí con
   `Ctrl+V` o `Shift+Insert`). De ahí el "a veces" = depende de https vs HTTP.
3. **Copiar es poco claro.** tmux corre con `mouse on` (para que la rueda scrollee
   el historial), así que arrastrar va a tmux; para seleccionar en xterm hay que
   forzar la selección nativa con `Shift+arrastrar`, y no hay un gesto de copiado
   familiar.

Además, hoy copy-on-select y el botón "Copiar" del menú usan
`navigator.clipboard.writeText`, que **no existe en contexto inseguro**: copiar
está roto por completo en HTTP/LAN.

## Decisiones de alcance

- **Tienen que andar ambos entornos**: HTTP/LAN (contexto inseguro) y
  https/localhost (contexto seguro). El contexto inseguro es la restricción dura.
- **Pegar con semántica web**: `Ctrl+V` pega. Se acepta perder `^V` literal
  (quoted-insert), que en una terminal de Claude casi no se usa.
- **`Ctrl+C` copia solo si hay selección**; sin selección manda SIGINT (convención
  estándar de gnome-terminal/Konsole). No se rompe el interrumpir.
- **La rueda del mouse se mantiene**: tmux sigue con `mouse on`. No se toca el
  servidor. Seleccionar sigue siendo `Shift+arrastrar` (Alt+arrastrar en Mac).
- **Tablet por HTTP va con teclado** (BT/USB): `Ctrl+V` / `Shift+Insert` / `Ctrl+C`
  alcanzan. No se resuelve el caso táctil puro (sin teclado).

## Arquitectura

Decisión clave: **el evento `paste` nativo del navegador es la única fuente de
verdad para pegar.** xterm ya pega solo a partir de `clipboardData` del evento
nativo, y eso funciona **idéntico** en https y en HTTP. Se descarta el enfoque
actual de dos caminos (`readText` en seguro / nativo en inseguro), que es la causa
del comportamiento intermitente.

### Pegar

- **Teclas que disparan pegar**: `Ctrl+V`, `Shift+Insert`, `Cmd+V` (Mac) y
  `Ctrl+Shift+V` (alias por compatibilidad).
- **Mecanismo**: en `attachCustomKeyEventHandler`, al detectar una tecla de pegado
  se devuelve `false` para que xterm **no** emita el `^V` literal al pty — pero
  **sin** llamar a `preventDefault`. Así el navegador dispara su evento `paste`
  nativo y el textarea oculto de xterm lo pega con `clipboardData`.
- **Sin lectura de portapapeles por API**: se elimina el uso de
  `navigator.clipboard.readText()` y el branching `canReadClipboard` para pegar.
- **Riesgo a verificar primero (antes de avanzar con el resto)**: confirmar que
  `return false` desde `attachCustomKeyEventHandler` no provoca `preventDefault`
  del keydown (en xterm.js no lo hace, pero se valida empíricamente). Si lo
  hiciera y suprimiera el evento `paste`, el **plan B** es registrar un listener
  `paste` propio sobre el textarea/contenedor que llame
  `term.paste(e.clipboardData.getData('text/plain'))` y `e.preventDefault()`.

### Copiar

- **`Ctrl+C` / `Cmd+C`**:
  - Con selección no vacía → `e.preventDefault()`, copiar con `copyText(...)`,
    limpiar la selección (`term.clearSelection()` y resetear `lastSelection`), y
    `return false` (xterm **no** manda `^C`/SIGINT).
  - Sin selección → `return true`: el evento pasa al pty (SIGINT con `Ctrl+C`).
- **copy-on-select**: al cambiar la selección a un valor no vacío, se copia sola,
  *best-effort* vía `navigator.clipboard.writeText` (solo contexto seguro). En
  contexto inseguro queda como no-op silencioso: no se hace el truco de
  `execCommand` en cada selección para no robar el foco del textarea de xterm.
- **Helper `copyText(text)`**: intenta `navigator.clipboard.writeText(text)`; si
  no está disponible (HTTP) o falla, cae a `document.execCommand('copy')` usando un
  `<textarea>` temporal (crear, setear value, seleccionar, copiar, remover, y
  restaurar el foco a la terminal). Lo usan `Ctrl+C` y el menú. Como son **gestos
  de usuario**, `execCommand('copy')` funciona también en contexto inseguro: copiar
  pasa a andar en HTTP/LAN.

### Selección y rueda

Sin cambios en el servidor (`habitat/server/term.js`): tmux sigue con `mouse on`.
La rueda scrollea el historial (intacto) y se selecciona con `Shift+arrastrar`
(Alt+arrastrar en Mac, vía `macOptionClickForcesSelection`). Se conserva el
snapshot de `lastSelection` en click derecho (tmux redibuja y borra la selección
de xterm antes de leerla).

### Menú contextual (DetailPanel) — descubribilidad

- Etiquetas con el atajo visible: **"Copiar  ⌃C"** y **"Pegar  ⌃V"**, para enseñar
  la mecánica de teclado.
- "Copiar" usa `copyText(getSelection())` → funciona también en HTTP.
- "Pegar": un click **no** genera un evento `paste` nativo, así que sigue
  necesitando leer el portapapeles. En contexto seguro usa `readText()` →
  `term.paste`. En contexto inseguro se **deshabilita** el botón con un hint
  ("usá Ctrl+V"), porque no hay forma de leer el portapapeles sin la API. Como la
  tablet va con teclado, esto alcanza.

## Detección de intents (lógica pura, testeable)

Reemplaza/extiende la función actual `copyPasteIntent`. Una función pura que
recibe el `KeyboardEvent` (o un subset) y devuelve `'copy' | 'paste' | null`:

- `paste` cuando, en `keydown`:
  - `(ctrlKey && code === 'KeyV')` (cubre `Ctrl+V` y `Ctrl+Shift+V`), o
  - `(metaKey && code === 'KeyV')` (`Cmd+V`), o
  - `(shiftKey && code === 'Insert')` (`Shift+Insert`).
- `copy` cuando, en `keydown`:
  - `(ctrlKey && !shiftKey && code === 'KeyC')` (`Ctrl+C`), o
  - `(metaKey && code === 'KeyC')` (`Cmd+C`).
  - Nota: el detector devuelve `'copy'`; la decisión SIGINT-vs-copiar (según haya o
    no selección) se resuelve en el handler, no en el detector.
- `null` en cualquier otro caso (incluye eventos que no son `keydown`).

La decisión de copiar-o-SIGINT vive en el handler porque depende del estado de
selección, no del evento de teclado.

## Archivos afectados

- `habitat/client/src/composables/useTerminal.ts` — lógica principal: nuevo
  detector de intent, `copyText` con fallback `execCommand`, handler de teclado,
  eliminación del branching `readText`/`canReadClipboard` para pegar.
- `habitat/client/src/composables/useTerminal.test.ts` — tests del detector
  (teclas de pegado, `Ctrl+C`/`Cmd+C`, `Shift+Insert`, que no-keydown da `null`,
  que `Ctrl+C` con shift no dispara copia, etc.).
- `habitat/client/src/components/DetailPanel.vue` — etiquetas del menú con atajos y
  deshabilitar "Pegar" en contexto inseguro con hint.
- Servidor: **sin cambios**.

## Criterios de aceptación

1. En https/localhost: `Ctrl+V`, `Shift+Insert`, `Cmd+V` y `Ctrl+Shift+V` pegan el
   contenido del portapapeles en la terminal, sin emitir `^V` al pty.
2. En HTTP/LAN: `Ctrl+V` y `Shift+Insert` pegan igual (vía evento `paste` nativo).
3. `Ctrl+C` con texto seleccionado copia y limpia la selección; sin selección
   interrumpe el proceso (SIGINT) como antes.
4. En HTTP/LAN: seleccionar con `Shift+arrastrar` + `Ctrl+C` copia al portapapeles
   del sistema (vía `execCommand`). El botón "Copiar" del menú también copia.
5. La rueda del mouse sigue scrolleando el historial de tmux (sin regresión).
6. El menú de click derecho muestra los atajos; "Pegar" está deshabilitado con
   hint en contexto inseguro.
7. Tests del detector de intents en verde.
