# Stamina real desde el statusLine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el orbe de stamina sea el espejo exacto del uso de context window de cada sesión (`100 − used_percentage`), alimentado por el statusLine de Claude Code, eliminando el cálculo erróneo basado en un `MAX_CONTEXT` hardcodeado.

**Architecture:** El `statusLine.command` de Claude Code recibe por stdin `context_window.used_percentage`, ya calculado por sesión contra la ventana real (200k o 1M). Un wrapper bash (`habitat-statusline`) postea ese payload a un endpoint nuevo `POST /status` del server, que setea `stamina = 100 − used_percentage` y lo difunde por WS. Se elimina el cálculo de stamina basado en transcript en `hooks-logic.js`. El cliente no cambia.

**Tech Stack:** Node.js (server HTTP nativo + `node:test`), bash (wrapper), `ws` (broadcast). Sin dependencias nuevas.

## Global Constraints

- Runtime: Node.js con ESM (`"type": "module"`). Tests con `node --test`, ejecutados con `cd habitat && npm test`.
- El wrapper bash NUNCA debe bloquear Claude Code: `exit 0` siempre, errores de red ignorados.
- No editar `~/.claude/statusline-command.sh` (lo gestiona el plugin `statusline@claude-statusline`; se reescribe en cada SessionStart). El wrapper delega en él.
- Autorización del endpoint `/status`: idéntica a `/hooks` (Bearer `config.TOKEN` + loopback).
- Sesión inexistente en `/status` → no crear pod zombie (responder 204 sin tocar el store), igual que el manejo de `SessionEnd` inexistente.
- `readUsage`/`transcript.js` quedan SIN tocar: siguen devolviendo `{ contextTokens, totalTokens }`. `contextTokens` queda sin consumidores pero removerlo no aporta valor y rompería `transcript.test.js`. (Decisión explícita: YAGNI hacia ambos lados.)

---

### Task 1: Función pura `staminaFromStatus(body)`

Convierte el payload del statusLine en un valor de stamina 0–100, o `null` si el payload no trae el dato. Vive en `hooks-logic.js` junto al resto de la lógica de sesión.

**Files:**
- Modify: `habitat/server/hooks-logic.js` (agregar export `staminaFromStatus`)
- Test: `habitat/server/hooks-logic.test.js` (agregar tests al final)

**Interfaces:**
- Produces: `staminaFromStatus(body) -> number | null`. `body` es el JSON del statusLine. Devuelve `Math.max(0, Math.min(100, Math.round(100 - body.context_window.used_percentage)))`, o `null` si `body.context_window.used_percentage` no es un número finito.

- [ ] **Step 1: Write the failing tests**

Agregar al final de `habitat/server/hooks-logic.test.js` (y agregar `staminaFromStatus` al import existente de `./hooks-logic.js` en la línea 4 — debe quedar `import { applyEvent, staminaFromStatus } from './hooks-logic.js';`):

```js
test('staminaFromStatus: used 4% -> stamina 96', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 4 } }), 96);
});

test('staminaFromStatus: used 25% -> stamina 75', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 25 } }), 75);
});

test('staminaFromStatus: redondea y clampa', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 4.6 } }), 95);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 120 } }), 0);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: -10 } }), 100);
});

test('staminaFromStatus: sin context_window o sin used_percentage -> null', () => {
  assert.equal(staminaFromStatus({}), null);
  assert.equal(staminaFromStatus({ context_window: {} }), null);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 'x' } }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && npm test 2>&1 | grep -A2 staminaFromStatus`
Expected: FAIL — `staminaFromStatus is not a function` / `not exported`.

- [ ] **Step 3: Implement `staminaFromStatus`**

Agregar en `habitat/server/hooks-logic.js` (junto a la función `staminaFromContext`, que seguirá existiendo hasta la Task 2):

```js
export function staminaFromStatus(body) {
  const used = body && body.context_window && body.context_window.used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && npm test 2>&1 | tail -5`
Expected: PASS, sin fallos (el resto de la suite sigue verde).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): staminaFromStatus — stamina = 100 - used_percentage"
```

---

### Task 2: Quitar el cálculo de stamina basado en transcript

`hooks-logic.js` deja de tocar `stamina` salvo en `PreCompact` (efecto visual). El daño de combate (delta de `totalTokens`) se conserva intacto. El statusLine pasa a ser la única fuente de stamina.

**Files:**
- Modify: `habitat/server/hooks-logic.js`
- Test: `habitat/server/hooks-logic.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `applyEvent` ya no lee `deps.maxContext` ni asigna stamina en `UserPromptSubmit`/`handleHit`. `PreCompact` sigue dejando `stamina = 5`.

- [ ] **Step 1: Actualizar los tests afectados (que ahora deben fallar contra el código viejo)**

En `habitat/server/hooks-logic.test.js`:

1. En el helper `deps` (líneas ~5-9), quitar la línea `maxContext: 200000,` (queda sin uso):

```js
const deps = (usage) => ({
  readUsage: () => usage,
  now: () => 1000,
});
```

2. Reemplazar el test `'golpe acumula daño = delta de totalTokens y baja stamina'` por esta versión (mismo cuerpo, sin las dos asserts de stamina y con nombre actualizado):

```js
test('golpe acumula daño = delta de totalTokens', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'b', status: 'in_progress' }] } }, deps(null));
  // primer golpe: total 1000, _lastTotal era 0 -> damage 1000
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', transcript_path: '/t' },
    deps({ contextTokens: 40000, totalTokens: 1000 }));
  assert.equal(r.session.combat.hits, 1);
  assert.equal(r.session.combat.tokens, 1000);
  assert.equal(r.session.combat.lastDamage, 1000);
  // segundo golpe: total 1500 -> damage 500
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: '/t' },
    deps({ contextTokens: 50000, totalTokens: 1500 }));
  assert.equal(r.session.combat.tokens, 1500);
  assert.equal(r.session.combat.lastDamage, 500);
});
```

(El test `'PreCompact descansa (stamina baja)...'` queda igual: `PreCompact` sigue poniendo `stamina = 5`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && npm test 2>&1 | tail -8`
Expected: PASS todavía (los tests viejos sólo perdieron asserts; el código viejo aún calcula stamina pero ya no se verifica). Este step confirma que la suite queda verde antes de tocar el código fuente. Si algo falla, revisar el editado del test.

- [ ] **Step 3: Editar `habitat/server/hooks-logic.js`**

3a. Borrar la función `staminaFromContext` (líneas 6-8):

```js
function staminaFromContext(ctx, max) {
  return Math.max(0, Math.round(100 * (1 - ctx / max)));
}
```

3b. En `applyEvent`, cambiar la desestructuración de deps (línea ~34) de:

```js
  const { readUsage, maxContext, now } = deps;
```
a:
```js
  const { readUsage, now } = deps;
```

3c. Borrar la definición de `recomputeStamina` (líneas ~46-50):

```js
  const recomputeStamina = () => {
    if (!payload.transcript_path) return;
    const u = readUsage(payload.transcript_path);
    if (u) s.stamina = staminaFromContext(u.contextTokens, maxContext);
  };
```

3d. En el `case 'UserPromptSubmit'`, borrar la línea `recomputeStamina();` (queda el resto del case igual):

```js
    case 'UserPromptSubmit': {
      s._resting = false;
      setStatus(s, 'working', 'procesando tu pedido', now);
      ensureMonster(s);
      break;
    }
```

3e. En `handleHit`, cambiar la desestructuración (línea ~141) de `const { readUsage, maxContext, now } = deps;` a `const { readUsage, now } = deps;`, y borrar la asignación de stamina (línea ~156). El bloque de transcript queda así (conserva daño y `_resting`):

```js
  if (payload.transcript_path) {
    const u = readUsage(payload.transcript_path);
    if (u) {
      const damage = Math.max(0, u.totalTokens - s._lastTotal);
      s.combat.tokens += damage;
      s.combat.lastDamage = damage;
      s._lastTotal = u.totalTokens;
      s._resting = false;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && npm test 2>&1 | tail -5`
Expected: PASS. Toda la suite verde; ya no hay referencias a `staminaFromContext` ni a `maxContext` en `hooks-logic.js`.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "refactor(habitat): stamina deja de calcularse desde el transcript"
```

---

### Task 3: Endpoint `POST /status`

Recibe el payload del statusLine, actualiza la stamina de la sesión y la difunde por WS.

**Files:**
- Modify: `habitat/server/index.js` (import + nueva ruta)
- Test: `habitat/server/index.test.js` (nuevos tests)

**Interfaces:**
- Consumes: `staminaFromStatus(body)` de la Task 1.
- Produces: ruta `POST /status`. Respuestas: 401 sin token; 400 body inválido o sin `session_id` string; 204 en éxito y también si la sesión no existe o el payload no trae stamina. En éxito difunde `{ type: 'session', session: <snap> }` y persiste.

- [ ] **Step 1: Write the failing tests**

Agregar en `habitat/server/index.test.js` (después del test de `/hooks con token`, antes de los de `/preview`). Usan helpers ya existentes en el archivo: `config`, `listen`, `auth`, `newSession`, `createStore`, `createApp`, `WebSocket`.

```js
test('POST /status sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1', context_window: { used_percentage: 4 } }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /status sin session_id -> 400', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/status`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ context_window: { used_percentage: 4 } }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /status sesión inexistente -> 204 y no crea pod', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/status`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'nope', context_window: { used_percentage: 4 } }),
  });
  assert.equal(res.status, 204);
  assert.equal(store.get('nope'), undefined);
  server.close();
});

test('POST /status setea stamina = 100 - used_percentage y difunde session', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const sessionMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'session') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/status`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1', context_window: { used_percentage: 4 } }),
  });
  assert.equal(res.status, 204);
  const m = await sessionMsg;
  assert.equal(m.session.id, 's1');
  assert.equal(m.session.stamina, 96);
  assert.equal(store.get('s1').stamina, 96);
  ws.close();
  server.close();
});

test('POST /status sin context_window -> 204 y no cambia stamina', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api', stamina: 42 }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/status`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1' }),
  });
  assert.equal(res.status, 204);
  assert.equal(store.get('s1').stamina, 42);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && npm test 2>&1 | grep -i status | head`
Expected: FAIL — los POST a `/status` caen en el handler de estáticos y devuelven 404/403, no los códigos esperados.

- [ ] **Step 3: Implementar la ruta**

3a. En `habitat/server/index.js`, ampliar el import (línea 8) de:
```js
import { applyEvent } from './hooks-logic.js';
```
a:
```js
import { applyEvent, staminaFromStatus } from './hooks-logic.js';
```

3b. Agregar el bloque de ruta justo después del bloque `if (req.method === 'POST' && url.pathname === '/hooks') { ... }` (antes del de `/preview`):

```js
    if (req.method === 'POST' && url.pathname === '/status') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const id = body && body.session_id;
      if (typeof id !== 'string' || !id) { res.writeHead(400).end(); return; }
      const s = store.get(id);
      if (s) {
        const stamina = staminaFromStatus(body);
        if (stamina != null) {
          s.stamina = stamina;
          hub.broadcast({ type: 'session', session: snapOf(s) });
          store.persist();
        }
      }
      res.writeHead(204).end();
      return;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && npm test 2>&1 | tail -5`
Expected: PASS, suite completa verde.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): POST /status setea stamina desde el statusLine"
```

---

### Task 4: Limpiar `MAX_CONTEXT` (config muerta)

Tras la Task 2 nadie lee `maxContext`. Se elimina de la config, del pase a `applyEvent` y de su test.

**Files:**
- Modify: `habitat/server/config.js`
- Modify: `habitat/server/index.js:53` (quitar `maxContext` del objeto de deps)
- Test: `habitat/server/config.test.js`

**Interfaces:**
- Consumes/Produces: ninguna interfaz nueva; sólo se borra código muerto.

- [ ] **Step 1: Actualizar el test de config**

En `habitat/server/config.test.js`, borrar las dos asserts de `MAX_CONTEXT` (líneas 9-10):

```js
  assert.equal(typeof config.MAX_CONTEXT, 'number');
  assert.ok(config.MAX_CONTEXT > 0);
```

- [ ] **Step 2: Run tests to verify they pass (todavía con MAX_CONTEXT presente)**

Run: `cd habitat && npm test 2>&1 | grep -i config`
Expected: PASS — el test de config ya no exige `MAX_CONTEXT`.

- [ ] **Step 3: Borrar `MAX_CONTEXT` del código**

3a. En `habitat/server/config.js`, borrar la línea (15):
```js
  MAX_CONTEXT: num(process.env.HABITAT_MAX_CONTEXT, 200000),
```

3b. En `habitat/server/index.js`, en la llamada a `applyEvent` (líneas ~52-54), quitar `maxContext: config.MAX_CONTEXT,`. El objeto de deps queda:
```js
        const { session, fightResult } = applyEvent(store, payload, {
          readUsage, gitBranch, now: () => Date.now(),
        });
```

- [ ] **Step 4: Run the full suite**

Run: `cd habitat && npm test 2>&1 | tail -5`
Expected: PASS. No quedan referencias a `MAX_CONTEXT`/`maxContext` en `config.js`, `index.js` ni `hooks-logic.js`.

Verificación extra:
Run: `cd habitat && grep -rn "MAX_CONTEXT\|maxContext" server/ | grep -v test`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/config.test.js habitat/server/index.js
git commit -m "refactor(habitat): eliminar MAX_CONTEXT (config muerta)"
```

---

### Task 5: Wrapper `habitat-statusline` + documentación de instalación

Script bash que postea el payload del statusLine a `/status` y delega en el renderer del plugin para que la línea de estado de la terminal siga igual.

**Files:**
- Create: `habitat/hook/habitat-statusline`
- Modify: `habitat/README.md` (sección de instalación del statusLine)

**Interfaces:**
- Consumes: endpoint `POST /status` (Task 3).
- Produces: comando para `statusLine.command` en `~/.claude/settings.json`. Env: `HABITAT_URL_STATUS` (default `http://127.0.0.1:8377/status`), `HABITAT_TOKEN`, `HABITAT_STATUSLINE_DELEGATE` (default `bash $HOME/.claude/statusline-command.sh`).

- [ ] **Step 1: Crear el script**

Crear `habitat/hook/habitat-statusline` con este contenido exacto:

```bash
#!/usr/bin/env bash
# Lee el JSON del statusLine por stdin, lo reenvía al servicio hábitat (POST /status)
# y delega en el renderer del statusline (plugin) para la salida en terminal.
# Diseñado para NUNCA bloquear Claude Code: el POST va en background y siempre sale 0.
URL="${HABITAT_URL_STATUS:-http://127.0.0.1:8377/status}"
TOKEN="${HABITAT_TOKEN:-}"
DELEGATE="${HABITAT_STATUSLINE_DELEGATE:-bash $HOME/.claude/statusline-command.sh}"
payload="$(cat || true)"
printf '%s' "$payload" | curl -fsS -m 3 -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  --data-binary @- >/dev/null 2>&1 &
printf '%s' "$payload" | $DELEGATE
exit 0
```

- [ ] **Step 2: Hacerlo ejecutable**

Run:
```bash
chmod +x habitat/hook/habitat-statusline
ls -l habitat/hook/habitat-statusline
```
Expected: permisos `-rwxr-xr-x` (o `-rwxrwxr-x`).

- [ ] **Step 3: Verificar delegación + no bloqueo**

Run (delegate stub = `cat`, endpoint a un puerto cerrado para forzar fallo silencioso de curl):
```bash
printf '{"session_id":"s1","context_window":{"used_percentage":4}}' | \
  HABITAT_STATUSLINE_DELEGATE='cat' HABITAT_URL_STATUS='http://127.0.0.1:9/status' \
  bash habitat/hook/habitat-statusline; echo " EXIT:$?"
```
Expected: imprime `{"session_id":"s1","context_window":{"used_percentage":4}} EXIT:0` (la salida del delegate `cat` y exit 0 pese a que el POST falla).

- [ ] **Step 4: Verificar el POST de punta a punta (server real)**

Run (levanta el server con token, manda un statusLine, confirma que la stamina se actualiza vía `/status`):
```bash
cd habitat && HABITAT_TOKEN=secret HABITAT_PORT=8390 node server/index.js &
SRV=$!; sleep 1
# crear la sesión con un SessionStart
curl -fsS -X POST http://127.0.0.1:8390/hooks -H 'Authorization: Bearer secret' \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"s1","hook_event_name":"SessionStart","cwd":"/home/u/api"}'
# mandar el statusLine via wrapper
printf '{"session_id":"s1","context_window":{"used_percentage":4}}' | \
  HABITAT_STATUSLINE_DELEGATE='cat' HABITAT_URL_STATUS='http://127.0.0.1:8390/status' \
  HABITAT_TOKEN=secret bash hook/habitat-statusline >/dev/null
sleep 1
# leer el estado por el WS snapshot seria mas complejo; verificamos via /preview no aplica.
# En su lugar confirmamos por el log del server o matamos y revisamos .state.json:
kill $SRV; sleep 1
grep -o '"stamina":[0-9]*' .state.json | head -1
```
Expected: `"stamina":96` en `.state.json`. (Si `.state.json` está en otra ruta por `HABITAT_STATE`, ajustar.) Limpiar: `rm -f habitat/.state.json` si se generó de prueba y no se quiere versionar.

- [ ] **Step 5: Documentar en el README**

En `habitat/README.md`, agregar después del bloque de Hooks (tras la línea 54), una sección nueva:

```markdown
## StatusLine (stamina real)

La stamina del orbe = `100 − context_window.used_percentage` que Claude Code
calcula por sesión contra la ventana real (200k o 1M). Para alimentarla, apuntar
`statusLine.command` en `~/.claude/settings.json` al wrapper de habitat, que
postea a `/status` y delega en el renderer del statusline existente:

    {
      "statusLine": {
        "type": "command",
        "command": "bash /ruta/a/habitat/hook/habitat-statusline"
      }
    }

- Exportar `HABITAT_TOKEN` (y `HABITAT_URL_STATUS` si el server no está en el
  default `http://127.0.0.1:8377/status`) en el entorno.
- `HABITAT_STATUSLINE_DELEGATE` controla el renderer al que se delega; por
  default `bash $HOME/.claude/statusline-command.sh` (el del plugin
  `statusline@claude-statusline`). El wrapper NO edita ese archivo.
```

- [ ] **Step 6: Commit**

```bash
git add habitat/hook/habitat-statusline habitat/README.md
git commit -m "feat(habitat): wrapper habitat-statusline + doc de instalación"
```

---

## Verificación final (post-implementación)

- [ ] `cd habitat && npm test` → toda la suite verde.
- [ ] `cd habitat && grep -rn "MAX_CONTEXT\|maxContext\|staminaFromContext" server/ | grep -v test` → sin salida.
- [ ] En una sesión real con context ~4%, tras apuntar `statusLine.command` al wrapper, el orbe muestra ~96% (espejo del `% used` de la terminal).
