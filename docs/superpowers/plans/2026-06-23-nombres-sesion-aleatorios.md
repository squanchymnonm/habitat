# Nombres de Sesión Aleatorios y Únicos Globalmente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el nombre autogenerado de una sesión nueva se elija al azar (en vez de siempre `mario`, `luigi`, …) y que sea único entre todas las sesiones abiertas, no solo dentro del mismo proyecto.

**Architecture:** Dos cambios en el server. (1) `autoName(used)` en `characters.js` pasa de recorrer `NAMES` en orden a elegir aleatoriamente entre los nombres libres, manteniendo el fallback de sufijos `-2`, `-3`, … cuando no quedan libres. (2) El handler `/spawn` en `index.js` calcula `used` sobre **todas** las sesiones (`store.all()`) en vez de filtrar por proyecto.

**Tech Stack:** Node.js (ESM, `type: module`), test runner nativo `node:test` + `node:assert/strict`. Tests se corren con `npm test` desde `habitat/` (ejecuta `node --test`).

## Global Constraints

- Los nombres en `NAMES` deben seguir siendo válidos como branch/carpeta: `/^[a-zA-Z0-9._-]+$/` (chequeado por el test existente y por `validBranch` en `git.js`). No se modifica la lista `NAMES`.
- `autoName` nunca debe devolver un nombre presente en `used`.
- No cambia el contrato cliente/servidor, ni el chequeo de colisión de tmux (respuesta 409).
- Comandos `npm`/`node` se corren desde el directorio `habitat/`.

---

### Task 1: `autoName` aleatorio

**Files:**
- Modify: `habitat/server/characters.js:20-30` (función `autoName`)
- Test: `habitat/server/characters.test.js:9-15` (reescribir los dos tests que asumen orden determinista)

**Interfaces:**
- Consumes: `NAMES` (array de strings) exportado por `characters.js`.
- Produces: `autoName(used = [])` → string. Devuelve un miembro aleatorio de `NAMES` que no esté en `used`; si todos están usados, un candidato sufijado (`<nombre>-<n>`, `n >= 2`) libre. Nunca devuelve un valor presente en `used`.

- [ ] **Step 1: Reescribir los tests para la semántica aleatoria**

En `habitat/server/characters.test.js`, reemplazar los tests de las líneas 9-15 (`autoName devuelve el primer nombre libre` y `autoName sufija cuando todos están usados`) por estos tres. Dejar intacto el test `NAMES no está vacío…` de las líneas 5-8.

```js
test('autoName devuelve un nombre de NAMES cuando hay libres', () => {
  assert.ok(NAMES.includes(autoName([])));
});
test('autoName nunca devuelve un nombre ya usado (50 sorteos)', () => {
  const used = ['mario', 'luigi', 'link'];
  for (let i = 0; i < 50; i++) {
    const r = autoName(used);
    assert.ok(NAMES.includes(r), `${r} debería estar en NAMES`);
    assert.ok(!used.includes(r), `${r} no debería estar en used`);
  }
});
test('autoName sufija (y no repite) cuando todos están usados', () => {
  const r = autoName(NAMES);
  assert.match(r, /-\d+$/);
  assert.ok(!NAMES.includes(r));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/characters.test.js`
Expected: FAIL. El test de los 50 sorteos puede pasar por casualidad con la implementación vieja (devuelve el primer libre, que nunca está en `used`), pero el comportamiento aún es determinista. El objetivo real de este step es confirmar que la suite corre; el cambio de comportamiento se valida en Step 4. (Si querés un fallo inequívoco, agregá temporalmente `assert.notEqual(autoName([]), NAMES[0])` y quitalo antes de commitear.)

- [ ] **Step 3: Implementar `autoName` aleatorio**

En `habitat/server/characters.js`, reemplazar la función `autoName` (líneas 20-30) por:

```js
// Nombre aleatorio de NAMES no presente en `used`. Si están todos, sufija -2, -3, …
export function autoName(used = []) {
  const set = new Set(used);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const free = NAMES.filter((n) => !set.has(n));
  if (free.length) return pick(free);
  for (let i = 2; ; i++) {
    const freeSuffixed = NAMES.map((n) => `${n}-${i}`).filter((c) => !set.has(c));
    if (freeSuffixed.length) return pick(freeSuffixed);
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/characters.test.js`
Expected: PASS (4 tests: el de `NAMES` + los tres nuevos).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/characters.js habitat/server/characters.test.js
git commit -m "feat(habitat): autoName elige nombre de sesión al azar"
```

---

### Task 2: Unicidad global en `/spawn`

**Files:**
- Modify: `habitat/server/index.js:153` (cálculo de `used`)
- Test: `habitat/server/index.test.js` (relajar la aserción de nombre exacto en el test existente de autogeneración + agregar un test de unicidad global)

**Interfaces:**
- Consumes: `store.all()` → array de sesiones, cada una con `.name` y `.project`. `autoName(used)` de Task 1. `newSession(id, { name, project })` de `state.js`. `NAMES` de `characters.js`.
- Produces: el handler `/spawn`, al no recibir `name`, asigna un nombre libre considerando los nombres de **todas** las sesiones del store (no solo las del mismo proyecto).

- [ ] **Step 1: Relajar el test de autogeneración existente**

En `habitat/server/index.test.js`, en el test `POST /spawn autogenera nombre cuando no se provee` (alrededor de la línea 216), la aserción actual es:

```js
  assert.equal(body.name, 'proj-api-mario');
```

Reemplazarla por (el nombre ya no es determinista):

```js
  assert.match(body.name, /^proj-api-[a-z0-9-]+$/);
```

- [ ] **Step 2: Agregar el test de unicidad global**

En `habitat/server/index.test.js`, justo después del test anterior, agregar este test nuevo. Verificá que el import de la cabecera ya traiga `newSession` (línea 4: `import { createStore, newSession } from './state.js';`) y agregá `NAMES` al import de characters si no estuviera presente — al inicio del archivo: `import { NAMES } from './characters.js';`.

```js
test('POST /spawn autogenera nombre único global (no repite entre proyectos)', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const store = createStore();
  // Sembrar TODOS los nombres base en otro proyecto distinto.
  NAMES.forEach((n, i) => store.upsert(newSession(`seed-${i}`, { name: n, project: 'proj-other' })));
  const { server } = createApp({ config: spawnConfig(), store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  // Como TODOS los nombres base ya están usados (en otro proyecto), debe caer al fallback sufijado.
  assert.match(body.name, /^proj-api-[a-z0-9]+-\d+$/);
  server.close();
});
```

- [ ] **Step 3: Correr los tests y verificar que el nuevo falla**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL en `autogenera nombre único global …`. Con el código actual, `used` se filtra por `proj-api` (vacío), así que `autoName` devuelve un nombre base sin sufijo y el `assert.match(.../-\d+$/)` falla.

- [ ] **Step 4: Implementar unicidad global**

En `habitat/server/index.js`, línea 153, reemplazar:

```js
        const used = store.all().filter((s) => s.project === projectName).map((s) => s.name);
```

por:

```js
        const used = store.all().map((s) => s.name);
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (toda la suite de `index.test.js`, incluido el nuevo test y el relajado).

- [ ] **Step 6: Correr toda la suite del server**

Run: `cd habitat && npm test`
Expected: PASS (todos los archivos `*.test.js`).

- [ ] **Step 7: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): nombre de sesión único entre todas las sesiones abiertas"
```

---

## Notas

- El cliente no requiere cambios: sigue recibiendo `{ name }` del `/spawn`.
- El fallback sufijado solo se activa con ≥48 sesiones abiertas simultáneas (todos los `NAMES` ocupados), escenario poco probable pero cubierto y testeado.
