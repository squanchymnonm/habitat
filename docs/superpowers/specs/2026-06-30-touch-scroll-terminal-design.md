# Scroll táctil en la terminal (tablet)

Fecha: 2026-06-30
Branch: sora

## Problema

La terminal de Habitat es xterm.js mostrando una sesión de **tmux con `mouse on`**
(`habitat/server/term.js:15`). En desktop, la **rueda del mouse** entra a copy-mode
de tmux y scrollea el historial.

En la **tablet en modo touch no hay rueda**: un swipe con el dedo no genera eventos
que xterm reenvíe a tmux, y `.term-body` tiene `overflow: hidden`. Además los gestos
táctiles hoy se usan para long-press (menú copiar/pegar) y, si está activo,
`selectMode` (seleccionar líneas). Ningún gesto scrollea.

**Resultado:** en la tablet no se puede ver el historial de tmux hacia arriba.

## Objetivo

Que un **swipe vertical de un dedo** scrollee el historial, tanto en la terminal
principal de la sesión (`DetailPanel.vue`) como en el editor (`EditorTerminal.vue`).

## Arquitectura

Toda la lógica vive en el composable `habitat/client/src/composables/useTerminal.ts`.
Como ambos componentes consumen `useTerminal`, los dos heredan el scroll sin duplicar
código de gestos. No deberían hacer falta cambios en los `.vue` (salvo, si el navegador
interfiere, un ajuste menor de `touch-action` en el CSS de `.term-body`).

## Mecanismo de scroll

El historial vive en tmux (copy-mode), no en el buffer de xterm, así que
`term.scrollLines()` **no sirve** (solo movería el buffer local). Hay que mandarle a
tmux/nvim lo mismo que les manda la rueda del mouse. Dos caminos:

- **A (primario) — `WheelEvent` sintético sobre el elemento de xterm.** Convertimos el
  arrastre en eventos `wheel` y se los despachamos a xterm; como el modo mouse está
  activo, **xterm los codifica solo** con el protocolo correcto (SGR/etc.) y se los
  manda a tmux. Ventaja: no necesitamos saber qué codificación negoció tmux. Riesgo:
  depende de que xterm procese eventos no "trusted"; se verifica en la tablet real.

- **B (fallback) — secuencias de escape de rueda (SGR) por el WebSocket.** Enviamos
  `\x1b[<64;col;row M` (arriba) / `\x1b[<65;col;row M` (abajo), calculando la celda
  desde la posición del dedo. Determinístico y a prueba de balas para SGR (la
  codificación que usa tmux por defecto en terminales modernas), pero asume SGR.

**Decisión:** implementar A; si en la tablet no procesa el evento sintético, caer a B.

## Gestos y mecánica del swipe

Se extienden los listeners táctiles que ya tiene `useTerminal` para el caso
**no-`selectMode`** (el estado por defecto):

- **touchstart** (no selectMode): guardar `lastY`, resetear acumulador.
- **touchmove**: `dy = clientY - lastY`. Si el gesto supera un umbral (~8px) y es
  **mayormente vertical**, entrar en "scrolling": `preventDefault()` (evitar el scroll
  / pull-to-refresh del navegador) y traducir el desplazamiento a "notches" de rueda
  = `Math.round(acumulado / cellHeight)`. Arrastrar el dedo **hacia abajo** revela
  historial (scroll up), como en cualquier app móvil.
- **touchend/cancel**: resetear estado.

### Coexistencia con gestos existentes

- **Long-press** (menú copiar/pegar, en `DetailPanel`): al moverse el dedo, su propio
  `lp.move` lo cancela → "quedarse quieto = menú, moverse = scroll". Sin conflicto.
- **`selectMode` activo**: el arrastre sigue seleccionando (rama actual intacta).
- **`EditorTerminal`**: no tiene menú de long-press, así que el arrastre solo scrollea
  (va a nvim/tmux del editor). Mismo código del composable, gratis.
- No hay gestos horizontales en uso en la app, así que restringir el scroll a arrastres
  mayormente verticales no choca con nada.

Sin inercia/momentum (YAGNI): scroll que sigue al dedo directo.

## Testing

- **Unitarios** (patrón de `terminalLinks.test.ts` y de las funciones puras de
  `useTerminal` como `rowFromY`/`joinBufferLines`): extraer la lógica a funciones puras
  testeables, p. ej.:
  - `wheelNotchesFromDelta(dy, cellHeight)` → entero con signo. Cubrir umbral,
    redondeo, signo (abajo = scroll up), acumulación.
  - Si se usa B: `wheelSeq('up'|'down', col, row)` → la cadena `\x1b[<…M` esperada.
- **Verificación manual en la tablet**: confirmar que el `WheelEvent` sintético hace
  scrollear tmux; si no, activar fallback B. No se puede cubrir con unit tests.

## Alcance

- ✅ Scroll por swipe vertical en la terminal principal y en el editor.
- ❌ Sin inercia/momentum, sin barra de scroll visual, sin botones (posibles extras
  futuros).
- ❌ No se toca copy/paste ni `selectMode`.

## Archivos afectados

- `habitat/client/src/composables/useTerminal.ts` — toda la lógica.
- Test del composable (nuevo o ampliado).
- `DetailPanel.vue` / `EditorTerminal.vue` — sin cambios esperados (posible ajuste menor
  de `touch-action` en CSS si el navegador interfiere).
