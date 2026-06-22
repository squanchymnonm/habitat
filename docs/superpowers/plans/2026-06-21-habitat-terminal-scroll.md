# Scroll de la terminal del drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar el scroll por rueda del mouse en la terminal del drawer activando el modo mouse de tmux al attachear.

**Architecture:** Cambio único en `habitat/server/term.js`: el PTY que hace `tmux attach-session` pasa a encadenar `set-option -t <target> mouse on` antes del attach, en la misma invocación de tmux. El armado de args se extrae a una función pura `attachArgs(target)` para poder testearlo sin spawnear tmux real. El cliente no cambia (xterm.js reenvía la rueda solo cuando tmux activa el reporte de mouse).

**Tech Stack:** Node.js (ESM, `node:test`), node-pty, tmux.

## Global Constraints

- Módulos ESM (`import`/`export`). No CommonJS.
- Tests con `node:test` + `node:assert/strict`, archivos `*.test.js` co-locados; se corren con `npm test` (= `node --test`) desde `habitat/`.
- Comentarios en español, calcando el estilo del archivo.
- El `;` se pasa como **argumento literal** propio en el array de args (no como string con espacios): tmux lo interpreta como separador de comandos cuando se invoca sin shell.
- No tocar el cliente (`useTerminal.ts`) ni `newTmuxSession`.
- Working dir base: `/home/mnonm/proyectos/RPG-Agents`.

---

### Task 1: tmux mouse on al attachear (term.js)

**Files:**
- Modify: `habitat/server/term.js` (función `defaultSpawnPty`; nueva export `attachArgs`)
- Test: `habitat/server/term.test.js`

**Interfaces:**
- Produces: `attachArgs(target: string) => string[]` — devuelve los args de tmux para attachear con mouse on: `['set-option','-t',target,'mouse','on',';','attach-session','-t',target]`.
- `defaultSpawnPty(target, {cols, rows})` pasa a usar `attachArgs(target)` como args del `pty.spawn('tmux', ...)`.

- [ ] **Step 1: Escribir el test que falla**

En `habitat/server/term.test.js`, agregar `attachArgs` al import de la línea 6:

```js
import { attachTerm, attachArgs } from './term.js';
```

Y al final del archivo:

```js
test('attachArgs encadena set-option mouse on antes del attach', () => {
  assert.deepEqual(
    attachArgs('api'),
    ['set-option', '-t', 'api', 'mouse', 'on', ';', 'attach-session', '-t', 'api'],
  );
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/term.test.js`
Expected: FAIL (`attachArgs is not a function` / import no resuelve).

- [ ] **Step 3: Implementar**

En `habitat/server/term.js`, reemplazar la función `defaultSpawnPty` (líneas 6-17) por:

```js
// Args de tmux para attachear a la sesión con el modo mouse activado, de modo que la
// rueda del mouse entre a copy-mode y scrollee el historial. El ';' se pasa como argumento
// literal: tmux lo trata como separador de comandos (invocado sin shell). Exportada para test.
export function attachArgs(target) {
  return ['set-option', '-t', target, 'mouse', 'on', ';', 'attach-session', '-t', target];
}

// Factory por defecto: PTY real que attachea a la sesión tmux por nombre.
// Relies on tmux's default client-sizing behavior (does not set window-size option).
function defaultSpawnPty(target, { cols, rows }) {
  // import perezoso: node-pty es binario nativo; sólo se carga al usar la terminal real.
  const pty = require('node-pty');
  return pty.spawn('tmux', attachArgs(target), {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    env: process.env,
  });
}
```

(El `import { WebSocketServer }`, el `createRequire`/`require` y el resto del archivo quedan igual.)

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && node --test server/term.test.js`
Expected: PASS (los 3 tests existentes + el nuevo).

- [ ] **Step 5: Suite completa (gate)**

Run: `cd /home/mnonm/proyectos/RPG-Agents/habitat && npm test`
Expected: PASS (todos los `server/*.test.js`).

- [ ] **Step 6: Commit**

```bash
cd /home/mnonm/proyectos/RPG-Agents
git add habitat/server/term.js habitat/server/term.test.js
git commit -m "feat(habitat): tmux mouse on al attachear -> scroll por rueda en el drawer"
```

---

## Self-Review (hecho)

**Cobertura del spec:** objetivo (scroll por rueda) → Task 1 activa `mouse on` al attach. Arquitectura (cambio único en term.js, `attachArgs` puro, `;` literal, sin tocar cliente/`newTmuxSession`) → reflejada en Task 1. Testing (`attachArgs('api')` deep-equals) → Step 1. Manejo de errores: sin cambios (el try/catch existente cubre el fallo de spawn) — no requiere tarea.

**Placeholders:** ninguno; el código va completo.

**Consistencia de tipos/nombres:** `attachArgs(target)` definido y usado consistente en Task 1 (Step 1 test, Step 3 impl).
