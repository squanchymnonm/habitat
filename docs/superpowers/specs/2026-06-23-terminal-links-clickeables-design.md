# Links clickeables en la terminal

## Problema

La terminal de cada sesión (xterm, montada en `DetailPanel.vue` vía
`useTerminal.ts`) muestra URLs como texto plano. No se puede abrir un link
desde la terminal; hay que copiarlo y pegarlo en el browser a mano. El caso
más común es la URL de un dev server (`http://localhost:5173`).

## Objetivo

Que las URLs que aparecen en la terminal sean clickeables y se abran en una
pestaña nueva del browser, sin romper la interacción normal de la terminal
(que corre con `tmux mouse on`).

## Decisiones de UX

- **Disparo:** la apertura requiere **Ctrl/Cmd + click** sobre el link. El
  click simple sigue yendo a la terminal/tmux. Evita aperturas accidentales y
  es la convención de VS Code y la mayoría de las terminales.
- **Qué se linkifica:**
  - URLs con esquema: `http://…` y `https://…` (incluye
    `http://localhost:5173`).
  - Hosts sin esquema: `localhost:PORT`, `127.0.0.1:PORT`, `0.0.0.0:PORT`
    (con path opcional). Se les antepone `http://` al abrir.

## Diseño

### Componente nuevo: `habitat/client/src/composables/terminalLinks.ts`

Módulo chico y testeable con dos piezas de responsabilidad única.

**1. `findLinks(lineText: string): LinkMatch[]`** — función pura.

```ts
export interface LinkMatch {
  start: number // índice de inicio en lineText (0-based)
  end: number   // índice de fin EXCLUSIVO
  url: string   // URL ya normalizada (con esquema), lista para window.open
}
```

Recorre `lineText` con un regex combinado que matchea:
- `https?://` seguido de caracteres de URL (corta en espacios, comillas y
  `<>` `()`).
- Hosts pelados `(localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}` con path
  opcional.

Para cada match:
- Recorta puntuación final colgada (`.`, `,`, `;`, `:`, `)`, `]`, `}`) del
  rango y de la URL, para no incluir el cierre de una oración.
- Si la URL no tiene esquema (`http`/`https`), antepone `http://` en `url`
  (pero `start`/`end` siguen apuntando al texto original en la línea).
- Devuelve los matches en orden de aparición; soporta múltiples por línea.

**2. `createLinkProvider(term, openLink): ILinkProvider`**

Implementa la interfaz `ILinkProvider` de `@xterm/xterm` (v6). En
`provideLinks(bufferLineNumber, callback)`:
- Lee el texto de la línea del buffer (`term.buffer.active.getLine(...)?.translateToString()`).
- Corre `findLinks` sobre ese texto.
- Arma un `ILink[]` donde cada link tiene:
  - `range`: `{ start: { x: start+1, y: bufferLineNumber }, end: { x: end, y: bufferLineNumber } }`
    (coordenadas de xterm: 1-based, `y` = número de línea del buffer).
  - `text`: la URL normalizada.
  - `activate(event, text)`: si `event.ctrlKey || event.metaKey`, llama
    `openLink(text)`; si no, no hace nada.
- Llama `callback(links)` (o `callback(undefined)` si no hubo matches).

`openLink` se inyecta para poder testear/controlar; en producción es
`(url) => window.open(url, '_blank', 'noopener,noreferrer')`.

### Integración en `useTerminal.ts`

- Importar `createLinkProvider` desde `./terminalLinks`.
- En `setup()`, después de `term.open(el)`, registrar el provider:
  `linkDisposable = term.registerLinkProvider(createLinkProvider(term, (url) => window.open(url, '_blank', 'noopener,noreferrer')))`.
- Guardar el `IDisposable` devuelto en una variable de la clausura
  (junto a `term`, `ws`, `fitAddon`).
- En `teardown()`, llamar `linkDisposable?.dispose()` y ponerlo en `null`
  antes de `term.dispose()`.

### Tests

`habitat/client/src/composables/terminalLinks.test.ts` (vitest), sobre la
función pura `findLinks`:

- Detecta una URL `https://ejemplo.com` (rango correcto, url igual al texto).
- Detecta `http://localhost:5173` con esquema.
- Detecta `localhost:3000` sin esquema y normaliza a `http://localhost:3000`
  (rango apunta al texto original).
- Detecta `127.0.0.1:8080/path` con path.
- Una línea sin links devuelve `[]`.
- Recorta puntuación final: `Visitá https://ejemplo.com.` → url
  `https://ejemplo.com` sin el punto.
- Múltiples links en una misma línea → varios matches en orden.

## Fuera de alcance (no cambia)

- El contrato cliente/servidor ni los mensajes WS.
- El copy/paste existente (`Ctrl+Shift+C/V`) y el manejo de teclas.
- No se agrega la dependencia `@xterm/addon-web-links` (el provider custom
  cubre http(s) y hosts pelados, que el addon no maneja de fábrica).
