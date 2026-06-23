# Links Clickeables en la Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que las URLs en la terminal xterm de cada sesión sean clickeables con Ctrl/Cmd+click y se abran en una pestaña nueva del browser.

**Architecture:** Un módulo nuevo `terminalLinks.ts` con una función pura `findLinks` (detección/normalización de URLs) y una factory `createLinkProvider` que implementa la interfaz `ILinkProvider` de xterm v6. `useTerminal.ts` registra el provider tras `term.open()` y lo limpia en `teardown()`. La detección de links se testea de forma aislada sobre `findLinks`.

**Tech Stack:** Vue 3 + TypeScript, `@xterm/xterm` v6.0.0 (API `registerLinkProvider`/`ILinkProvider`), tests con vitest (`vitest run`).

## Global Constraints

- Disparo de apertura: solo con `event.ctrlKey || event.metaKey` (Ctrl/Cmd+click). El click simple NO abre.
- URLs con esquema soportadas: `http://` y `https://`. Hosts sin esquema soportados: `localhost:PORT`, `127.0.0.1:PORT`, `0.0.0.0:PORT` (con path opcional), normalizados con `http://` antepuesto.
- Apertura siempre con `window.open(url, '_blank', 'noopener,noreferrer')`.
- NO agregar la dependencia `@xterm/addon-web-links`.
- No tocar el contrato cliente/servidor, los mensajes WS, ni el copy/paste existente (`Ctrl+Shift+C/V`).
- Comandos de cliente se corren desde `habitat/client/`. Tests: `npx vitest run <archivo>`.

---

### Task 1: Detección de links (`findLinks`)

**Files:**
- Create: `habitat/client/src/composables/terminalLinks.ts`
- Test: `habitat/client/src/composables/terminalLinks.test.ts`

**Interfaces:**
- Produces:
  - `interface LinkMatch { start: number; end: number; url: string }` — `start` índice 0-based inicial en el texto de la línea, `end` índice 0-based exclusivo final, `url` URL normalizada (con esquema) lista para `window.open`.
  - `function findLinks(lineText: string): LinkMatch[]` — devuelve los matches en orden de aparición. `start`/`end` apuntan al texto original; `url` lleva `http://` antepuesto si el match no tenía esquema. Recorta puntuación final colgada del rango y de la url.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `habitat/client/src/composables/terminalLinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findLinks } from './terminalLinks'

describe('findLinks', () => {
  it('detecta una URL https y conserva texto y rango', () => {
    const line = 'abrí https://ejemplo.com ya'
    const [m, ...rest] = findLinks(line)
    expect(rest).toHaveLength(0)
    expect(m.url).toBe('https://ejemplo.com')
    expect(line.slice(m.start, m.end)).toBe('https://ejemplo.com')
  })

  it('detecta http://localhost con esquema', () => {
    const [m] = findLinks('server en http://localhost:5173/')
    expect(m.url).toBe('http://localhost:5173/')
  })

  it('detecta localhost:PORT sin esquema y normaliza a http://', () => {
    const line = 'corriendo en localhost:3000'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://localhost:3000')
    expect(line.slice(m.start, m.end)).toBe('localhost:3000')
  })

  it('detecta 127.0.0.1 con path', () => {
    const [m] = findLinks('ping 127.0.0.1:8080/health')
    expect(m.url).toBe('http://127.0.0.1:8080/health')
  })

  it('detecta 0.0.0.0:PORT sin esquema', () => {
    const [m] = findLinks('listening on 0.0.0.0:4000')
    expect(m.url).toBe('http://0.0.0.0:4000')
  })

  it('una línea sin links devuelve []', () => {
    expect(findLinks('no hay nada acá, solo texto.')).toEqual([])
  })

  it('recorta puntuación final colgada', () => {
    const line = 'visitá https://ejemplo.com.'
    const [m] = findLinks(line)
    expect(m.url).toBe('https://ejemplo.com')
    expect(line.slice(m.start, m.end)).toBe('https://ejemplo.com')
  })

  it('detecta múltiples links en orden', () => {
    const ms = findLinks('a https://uno.com b localhost:3000 c')
    expect(ms.map((m) => m.url)).toEqual(['https://uno.com', 'http://localhost:3000'])
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/terminalLinks.test.ts`
Expected: FAIL — el módulo `./terminalLinks` aún no existe / `findLinks` no está definido.

- [ ] **Step 3: Implementar `findLinks`**

Crear `habitat/client/src/composables/terminalLinks.ts`:

```ts
export interface LinkMatch {
  start: number // índice 0-based de inicio en lineText
  end: number   // índice 0-based exclusivo de fin
  url: string   // URL normalizada (con esquema), lista para window.open
}

// http(s) con esquema, o host pelado localhost/127.0.0.1/0.0.0.0 con puerto y path opcional.
const LINK_RE =
  /(https?:\/\/[^\s"'<>()]+)|((?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}(?:\/[^\s"'<>()]*)?)/g

// Puntuación de cierre que no forma parte de la URL si queda colgada al final.
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'"])

export function findLinks(lineText: string): LinkMatch[] {
  const out: LinkMatch[] = []
  LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(lineText)) !== null) {
    const raw = match[0]
    let end = match.index + raw.length
    let text = raw
    while (text.length > 0 && TRAILING.has(text[text.length - 1])) {
      text = text.slice(0, -1)
      end -= 1
    }
    if (text.length === 0) continue
    const url = /^https?:\/\//i.test(text) ? text : `http://${text}`
    out.push({ start: match.index, end, url })
  }
  return out
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/composables/terminalLinks.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/terminalLinks.ts habitat/client/src/composables/terminalLinks.test.ts
git commit -m "feat(habitat): detección de links en texto de terminal (findLinks)"
```

---

### Task 2: Provider de links + integración en la terminal

**Files:**
- Modify: `habitat/client/src/composables/terminalLinks.ts` (agregar `createLinkProvider`)
- Modify: `habitat/client/src/composables/useTerminal.ts` (registrar/limpiar el provider)

**Interfaces:**
- Consumes: `findLinks(lineText)` y `LinkMatch` de Task 1; tipos `Terminal`, `ILinkProvider`, `ILink`, `IDisposable` de `@xterm/xterm`.
- Produces: `function createLinkProvider(term: Terminal, openLink: (url: string) => void): ILinkProvider`. Su `provideLinks(bufferLineNumber, callback)` lee la línea del buffer, corre `findLinks`, y entrega `ILink[]` (o `undefined` si no hay matches). Cada `ILink.activate(event, text)` llama `openLink(text)` solo si `event.ctrlKey || event.metaKey`.

- [ ] **Step 1: Agregar `createLinkProvider` a `terminalLinks.ts`**

Agregar al final de `habitat/client/src/composables/terminalLinks.ts`:

```ts
import type { Terminal, ILinkProvider, ILink } from '@xterm/xterm'

// Provider de links para xterm v6: por cada línea pedida, mapea findLinks() a ILink[].
// La activación abre el link solo con Ctrl/Cmd+click (el click simple va a la terminal).
export function createLinkProvider(term: Terminal, openLink: (url: string) => void): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      const text = line ? line.translateToString() : ''
      const matches = findLinks(text)
      if (matches.length === 0) { callback(undefined); return }
      const links: ILink[] = matches.map((m) => ({
        // xterm: coordenadas 1-based; range.end.x es inclusivo.
        range: {
          start: { x: m.start + 1, y: bufferLineNumber },
          end: { x: m.end, y: bufferLineNumber },
        },
        text: m.url,
        activate(event: MouseEvent, url: string) {
          if (event.ctrlKey || event.metaKey) openLink(url)
        },
      }))
      callback(links)
    },
  }
}
```

Nota sobre coordenadas: `m.start` es 0-based → `start.x = m.start + 1` (1-based). `m.end` es 0-based exclusivo; el `end.x` de xterm es 1-based inclusivo, que numéricamente coincide con `m.end`.

- [ ] **Step 2: Verificar que los tests de Task 1 siguen pasando (sin regresión)**

Run: `cd habitat/client && npx vitest run src/composables/terminalLinks.test.ts`
Expected: PASS (8 tests; agregar `createLinkProvider` no debe romper `findLinks`).

- [ ] **Step 3: Registrar el provider en `useTerminal.ts`**

En `habitat/client/src/composables/useTerminal.ts`:

1. Agregar el import de tipos/factory. Cambiar la línea 3 para sumar el tipo `IDisposable` y agregar el import del provider:

```ts
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createLinkProvider } from './terminalLinks'
```

(la línea `import { Terminal } from '@xterm/xterm'` existente se reemplaza por la de arriba; mantener el resto de imports y el `import '@xterm/xterm/css/xterm.css'`).

2. Declarar la variable de clausura junto a las otras (debajo de `let ws: WebSocket | null = null`):

```ts
  let linkProvider: IDisposable | null = null
```

3. En `teardown()`, limpiar el provider antes de disponer la terminal. Reemplazar el cuerpo actual de `teardown`:

```ts
  function teardown() {
    if (ws) { ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); ws = null }
    if (linkProvider) { linkProvider.dispose(); linkProvider = null }
    if (term) { term.dispose(); term = null }
    fitAddon = null
  }
```

4. En `setup()`, después de `fitAddon.fit()` (línea 43), registrar el provider:

```ts
    linkProvider = term.registerLinkProvider(
      createLinkProvider(term, (url) => window.open(url, '_blank', 'noopener,noreferrer')),
    )
```

- [ ] **Step 4: Verificar typecheck y build del cliente**

Run: `cd habitat/client && npx vue-tsc --noEmit`
Expected: PASS sin errores de tipos (si el proyecto no expone `vue-tsc`, usar `npm run build` y confirmar que compila).

- [ ] **Step 5: Verificación manual (smoke)**

Levantar la app, abrir una sesión cuya terminal imprima una URL (p. ej. correr `echo http://localhost:5173`). Confirmar:
- El texto de la URL se subraya al pasar el mouse.
- Ctrl/Cmd+click abre la URL en una pestaña nueva.
- Click simple NO abre nada (va a la terminal).

Si no es posible levantar la app en este entorno, dejar constancia en el reporte de que el smoke quedó pendiente de verificación manual.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/composables/terminalLinks.ts habitat/client/src/composables/useTerminal.ts
git commit -m "feat(habitat): links clickeables en la terminal (Ctrl/Cmd+click)"
```

---

## Notas

- `findLinks` opera por línea; xterm llama `provideLinks` por cada línea visible, así que no hace falta manejar links multi-línea (raros en URLs de terminal y fuera de alcance).
- El regex corta en espacios, comillas, `<>` y `()`, lo que cubre los wrappers más comunes; el recorte de puntuación final maneja el caso de una URL al final de una oración.
