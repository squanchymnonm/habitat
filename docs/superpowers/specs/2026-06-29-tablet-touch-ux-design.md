# Diseño: arreglos de UX táctil en tablet

Fecha: 2026-06-29
Branch: niko

## Contexto

La GUI de habitat (Vue + xterm) se usa también desde una tablet entrando por
LAN (HTTP plano, contexto inseguro). Tres problemas detectados en tablet,
con uso principalmente **touch** y teclado Bluetooth ocasional:

1. **Links no se abren al tocarlos.** El provider de links de xterm solo abre
   con `Ctrl/Cmd+click`; en touch no hay esa tecla, así que tocar un link no
   hace nada.
2. **No se puede copiar texto.** Copiar hoy depende de seleccionar con
   Shift/Alt+arrastre, el menú de click derecho, o atajos de teclado. En touch
   ninguno aplica: no hay Shift ni click derecho, y el arrastre táctil se lo
   come tmux (`mouse on`). El bloqueo real es no poder **seleccionar**.
3. **Layout vertical solo muestra pods.** `isNarrow` se decide por puro ancho
   (`max-width: 899px`). Una tablet en portrait (~810px) cae en modo narrow:
   solo el rail de pods, y el detalle se abre como overlay al tocar uno. Se
   quiere el layout desktop (rail + panel lado a lado) en tablets verticales.

## Objetivo

- Tap simple abre links en touch y desktop.
- Poder seleccionar y copiar texto en touch (con fallback robusto en HTTP/LAN).
- Tablets (incluido portrait) usan el layout desktop lado a lado; los celulares
  mantienen el modo pods + overlay.

## Diseño

### 1. Links: tap/click simple para abrir

**Archivo:** `habitat/client/src/composables/terminalLinks.ts` (`createLinkProvider`).

El callback `activate` abre el link siempre, sin exigir modificador:

```js
activate(_event, url) { openLink(url) }
```

- Funciona con tap (touch) y click (desktop).
- Sigue abriendo en pestaña nueva: `window.open(url, '_blank', 'noopener,noreferrer')`.
- **Efecto en desktop (aceptado):** clickear exactamente sobre la URL ahora la
  abre (antes no hacía nada). El arrastre para seleccionar no se afecta — un
  drag no dispara `activate`.

### 2. Copiar en touch: modo selección + botón "copiar visible"

**Archivos:** `habitat/client/src/composables/useTerminal.ts`,
`habitat/client/src/components/DetailPanel.vue`.

**a) Long-press abre el menú de contexto existente.** En touch, mantener
apretado (~500ms) sin desplazarse dispara el mismo `openMenu` (Copiar/Pegar)
que hoy usa el click derecho, posicionado donde está el dedo. Se cancela si el
dedo se mueve más que un umbral (es un scroll/drag, no un long-press).

**b) "Modo selección" (toggle en la barra del panel).** Mientras está activo,
el arrastre táctil marca texto en xterm en lugar de ir a tmux. Al soltar, el
`copy-on-select` ya existente copia la selección automáticamente (vía
`copyText`, que cae a `execCommand('copy')` en contexto inseguro). Se confirma
con un toast "copiado".

- **Riesgo técnico:** forzar la selección nativa de xterm en touch mientras
  tmux tiene `mouse on` requiere un spike. Si la selección por columnas no sale
  limpia, el **fallback garantizado** es selección por líneas
  (`term.selectLines(start, end)`): arrastrar verticalmente marca líneas
  completas. Se valida en implementación con TDD.

**c) Botón "copiar visible".** Copia toda la salida visible del buffer
(recorrer `term.buffer.active` y unir las líneas en texto) sin necesidad de
seleccionar. Atajo robusto para llevarse todo de una.

### 3. Layout desktop en tablets (portrait incluido)

**Archivo:** `habitat/client/src/composables/useViewport.ts`.

Cambiar el criterio de `isNarrow` de puro ancho a un test "¿es teléfono?":
narrow solo si el ancho **o** el alto es menor a 600px.

```js
useViewport('(max-width: 599px), (max-height: 599px)')
```

Resultado:

| Dispositivo            | Dimensiones | narrow? | Layout          |
|------------------------|-------------|---------|-----------------|
| Tablet portrait        | 810×1080    | no      | desktop (split) |
| Tablet landscape       | 1080×810    | no      | desktop (split) |
| Teléfono portrait      | 390×844     | sí      | pods + overlay  |
| Teléfono landscape     | 844×390     | sí      | pods + overlay  |

`HabitatLayout.vue` no necesita cambios estructurales: ya renderiza rail +
panel lado a lado cuando `isNarrow` es false.

## Testing

- `terminalLinks.test.ts`: `activate` abre el link sin modificador (y sigue
  abriendo con Ctrl/Cmd).
- `useTerminal.test.ts`: long-press dispara el menú; copiar visible arma el
  texto del buffer; la selección por líneas como fallback.
- `useViewport` / layout: verificar que el query separa teléfono (cualquier
  dimensión <600) de tablet (ambas ≥600).

## Fuera de alcance

- Refactors no relacionados.
- Cambiar la configuración de tmux (`mouse on`) en el server.
- Selección por columnas pixel-perfecta si el spike muestra que no es viable;
  en ese caso queda la selección por líneas.
