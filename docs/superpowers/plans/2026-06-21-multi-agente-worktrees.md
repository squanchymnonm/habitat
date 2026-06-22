# Multi-agente por proyecto vía git worktrees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correr varios agentes Claude sobre el mismo repo a la vez, cada uno en su rama, orquestado por Hábitat vía git worktrees.

**Architecture:** Hábitat crea un git worktree dedicado por agente bajo `~/habitat-worktrees/<proyecto>/<rama-saneada>`, levanta una sesión tmux nombrada `<proyecto>-<rama-saneada>` y lanza `claude`. Se desacopla el nombre tmux del basename poblando `s.tmux` (que preview/chat/term ya consumen vía `s.tmux || s.name`). El nombre tmux se deriva determinísticamente del cwd, sin estado persistente.

**Tech Stack:** Node.js (ESM, `node:test`), `node-pty`, `ws`, git CLI vía `execFile`, cliente Vue 3 + TS.

## Global Constraints

- Tests con `node:test` + `node:assert/strict`, corren con `node --test` desde `habitat/`.
- Helpers de sistema (git/tmux): args por array vía `execFile`/`execFileSync`, nunca shell. `exec` inyectable para tests, con `defaultExec` real.
- Funciones que envuelven comandos externos atrapan el error y devuelven valor seguro (bool/`''`/`[]`), siguiendo `tmux.js`.
- No romper sesiones legacy: `claude` corrido a mano en el dir del repo debe seguir funcionando igual (sin `s.tmux`, cae a `basename`).
- Saneo de rama compartido: `rama.replace(/\//g, '-')`. Validación de rama: `^[A-Za-z0-9._/-]+$` y sin `..`.

---

### Task 1: Módulo `git.js` con `worktreeAdd`

**Files:**
- Create: `habitat/server/git.js`
- Test: `habitat/server/git.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export function validBranch(branch): boolean` — `true` si `branch` matchea `^[A-Za-z0-9._/-]+$` y no contiene `..`.
  - `export async function branchExists(projectDir, branch, exec?): Promise<boolean>` — `git -C <projectDir> rev-parse --verify --quiet refs/heads/<branch>`; `true`/`false`.
  - `export async function worktreeAdd(projectDir, branch, base, path, exec?): Promise<boolean>` — crea el worktree; `true` si ok, `false` si falla o branch inválida.

- [ ] **Step 1: Write the failing test**

```javascript
// habitat/server/git.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validBranch, branchExists, worktreeAdd } from './git.js';

test('validBranch acepta nombres seguros y rechaza inválidos', () => {
  assert.equal(validBranch('feature/x'), true);
  assert.equal(validBranch('fix-123_a.b'), true);
  assert.equal(validBranch(''), false);
  assert.equal(validBranch('a b'), false);
  assert.equal(validBranch('../evil'), false);
  assert.equal(validBranch('a;rm -rf'), false);
});

test('branchExists true cuando rev-parse no falla', async () => {
  const exec = async (file, args) => {
    assert.equal(file, 'git');
    assert.deepEqual(args, ['-C', '/proj', 'rev-parse', '--verify', '--quiet', 'refs/heads/feat']);
    return 'abc123\n';
  };
  assert.equal(await branchExists('/proj', 'feat', exec), true);
});

test('branchExists false cuando rev-parse falla', async () => {
  const exec = async () => { throw new Error('unknown revision'); };
  assert.equal(await branchExists('/proj', 'nope', exec), false);
});

test('worktreeAdd con rama nueva usa -b y la base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) throw new Error('no existe'); // rama nueva
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feature/x', 'main', '/wt/proj/feature-x', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '-b', 'feature/x', '/wt/proj/feature-x', 'main',
  ]);
});

test('worktreeAdd con rama existente no usa -b ni base', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('rev-parse')) return 'abc\n'; // rama existe
    return '';
  };
  const ok = await worktreeAdd('/proj', 'feat', 'main', '/wt/proj/feat', exec);
  assert.equal(ok, true);
  assert.deepEqual(calls.at(-1), [
    'git', '-C', '/proj', 'worktree', 'add', '/wt/proj/feat', 'feat',
  ]);
});

test('worktreeAdd con branch inválida devuelve false sin ejecutar', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal(await worktreeAdd('/proj', '../evil', 'main', '/wt/x', exec), false);
  assert.equal(called, false);
});

test('worktreeAdd ante fallo de git devuelve false', async () => {
  const exec = async (file, args) => {
    if (args.includes('rev-parse')) throw new Error('no existe');
    throw new Error('worktree add failed');
  };
  assert.equal(await worktreeAdd('/proj', 'feat', 'main', '/wt/feat', exec), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/git.test.js`
Expected: FAIL — no se puede importar `./git.js` (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

```javascript
// habitat/server/git.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export function validBranch(branch) {
  const b = String(branch || '');
  if (!b || b.includes('..')) return false;
  return /^[A-Za-z0-9._/-]+$/.test(b);
}

export async function branchExists(projectDir, branch, exec = defaultExec) {
  try {
    await exec('git', ['-C', projectDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function worktreeAdd(projectDir, branch, base, path, exec = defaultExec) {
  if (!validBranch(branch)) return false;
  try {
    const args = (await branchExists(projectDir, branch, exec))
      ? ['-C', projectDir, 'worktree', 'add', path, branch]
      : ['-C', projectDir, 'worktree', 'add', '-b', branch, path, base];
    await exec('git', args);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat && node --test server/git.test.js`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git.js habitat/server/git.test.js
git commit -m "feat(habitat): git.js con worktreeAdd para sesiones por rama"
```

---

### Task 2: `WORKTREES_DIR` en config + helper `worktreeName`

**Files:**
- Modify: `habitat/server/config.js`
- Create: `habitat/server/worktree.js`
- Test: `habitat/server/worktree.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `config.WORKTREES_DIR: string` — base de worktrees (default `~/habitat-worktrees`).
  - `export function sanitizeBranch(branch): string` — `branch.replace(/\//g, '-')`.
  - `export function worktreeName(worktreesDir, cwd): { project, tmux } | null` — si `cwd` cuelga de `worktreesDir` con forma `<base>/<proyecto>/<leaf>`, devuelve `{ project, tmux: project + '-' + leaf }`; si no, `null`.
  - `export function worktreePaths(worktreesDir, projectName, branch): { path, tmux }` — `path = join(worktreesDir, projectName, sanitizeBranch(branch))`, `tmux = projectName + '-' + sanitizeBranch(branch)`.

- [ ] **Step 1: Write the failing test**

```javascript
// habitat/server/worktree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBranch, worktreeName, worktreePaths } from './worktree.js';

const BASE = '/home/u/habitat-worktrees';

test('sanitizeBranch reemplaza slashes', () => {
  assert.equal(sanitizeBranch('feature/x'), 'feature-x');
  assert.equal(sanitizeBranch('fix'), 'fix');
});

test('worktreeName deriva project y tmux de un cwd bajo la base', () => {
  assert.deepEqual(worktreeName(BASE, `${BASE}/rpg/feature-x`), { project: 'rpg', tmux: 'rpg-feature-x' });
});

test('worktreeName devuelve null para cwd fuera de la base', () => {
  assert.equal(worktreeName(BASE, '/home/u/rpg'), null);
});

test('worktreeName devuelve null si falta el leaf (solo proyecto)', () => {
  assert.equal(worktreeName(BASE, `${BASE}/rpg`), null);
});

test('worktreePaths arma path y tmux consistentes con la derivación', () => {
  const { path, tmux } = worktreePaths(BASE, 'rpg', 'feature/x');
  assert.equal(path, `${BASE}/rpg/feature-x`);
  assert.equal(tmux, 'rpg-feature-x');
  // round-trip: derivar desde el path reproduce el mismo tmux
  assert.equal(worktreeName(BASE, path).tmux, tmux);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/worktree.test.js`
Expected: FAIL — `./worktree.js` no existe.

- [ ] **Step 3: Write minimal implementation**

```javascript
// habitat/server/worktree.js
import { join, dirname, basename, sep } from 'node:path';

export function sanitizeBranch(branch) {
  return String(branch || '').replace(/\//g, '-');
}

export function worktreeName(worktreesDir, cwd) {
  const c = String(cwd || '');
  const prefix = worktreesDir.endsWith(sep) ? worktreesDir : worktreesDir + sep;
  if (!c.startsWith(prefix)) return null;
  const leaf = basename(c);
  const project = basename(dirname(c));
  // el padre del leaf debe ser exactamente <base>/<project>
  if (!project || dirname(c) === worktreesDir || join(worktreesDir, project) !== dirname(c)) return null;
  return { project, tmux: `${project}-${leaf}` };
}

export function worktreePaths(worktreesDir, projectName, branch) {
  const leaf = sanitizeBranch(branch);
  return { path: join(worktreesDir, projectName, leaf), tmux: `${projectName}-${leaf}` };
}
```

- [ ] **Step 4: Add `WORKTREES_DIR` to config**

```javascript
// habitat/server/config.js — agregar import arriba y el campo al objeto exportado
import { homedir } from 'node:os';
import { join } from 'node:path';
```

Agregar dentro del objeto `export default { ... }`, después de `PROJECTS`:

```javascript
  WORKTREES_DIR: process.env.HABITAT_WORKTREES_DIR || join(homedir(), 'habitat-worktrees'),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd habitat && node --test server/worktree.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/worktree.js habitat/server/worktree.test.js habitat/server/config.js
git commit -m "feat(habitat): WORKTREES_DIR y helpers de naming de worktree"
```

---

### Task 3: `SessionStart` puebla `s.tmux` para sesiones worktree

**Files:**
- Modify: `habitat/server/hooks-logic.js:46-55` (caso `SessionStart`)
- Test: `habitat/server/hooks-logic.test.js` (agregar tests)

**Interfaces:**
- Consumes: `deps.worktreeName(cwd): { project, tmux } | null` (de Task 2, inyectado por index.js en Task 4).
- Produces: cuando `deps.worktreeName(cwd)` no es `null`, la sesión tiene `s.tmux = <derivado>` y `s.name = s.project = project`. Cuando es `null` o no hay dep, `s.name = basename(cwd)` y `s.tmux` queda sin setear (comportamiento legacy).

- [ ] **Step 1: Write the failing test**

Agregar al final de `habitat/server/hooks-logic.test.js`:

```javascript
test('SessionStart bajo worktree setea s.tmux y project derivados', () => {
  const store = createStore();
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd, hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: () => ({ project: 'rpg', tmux: 'rpg-feature-x' }) });
  assert.equal(session.name, 'rpg');
  assert.equal(session.project, 'rpg');
  assert.equal(session.tmux, 'rpg-feature-x');
});

test('SessionStart sin worktreeName mantiene basename y sin s.tmux', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/rpg', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.name, 'rpg');
  assert.equal(session.tmux, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: FAIL — el test de worktree espera `session.tmux === 'rpg-feature-x'` pero hoy es `undefined`.

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/hooks-logic.js`, reemplazar el bloque `if (payload.cwd) { ... }` del caso `SessionStart` (líneas 47-51) por:

```javascript
      if (payload.cwd) {
        const wt = deps.worktreeName ? deps.worktreeName(payload.cwd) : null;
        if (wt) {
          s.name = wt.project;
          s.tmux = wt.tmux;
        } else {
          s.name = basename(payload.cwd);
        }
        s.project = s.name;
        if (deps.gitBranch) s.branch = deps.gitBranch(payload.cwd) || '';
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && node --test server/hooks-logic.test.js`
Expected: PASS (incluyendo los tests previos de SessionStart).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js
git commit -m "feat(habitat): SessionStart puebla s.tmux para sesiones worktree"
```

---

### Task 4: `/spawn` crea worktree + tmux por rama

**Files:**
- Modify: `habitat/server/index.js` (import de `git`, deps de `/hooks`, handler de `/spawn`)
- Test: `habitat/server/index.test.js` (agregar tests)

**Interfaces:**
- Consumes: `worktreeAdd` (Task 1), `worktreePaths`/`worktreeName` (Task 2), `s.tmux` en SessionStart (Task 3).
- Produces: `/spawn` acepta `{ dir, branch?, base? }`. Con `branch` válido crea worktree + tmux `<proyecto>-<rama-saneada>` y responde `{ name: tmuxName }`. Sin `branch` mantiene el flujo legacy `{ name: basename(dir) }`. `createApp` acepta `git` inyectable: `createApp({ config, store, tmux, git })`.

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/index.test.js`:

```javascript
test('POST /spawn con branch crea worktree y tmux <proyecto>-<rama>', async () => {
  const seenTmux = [];
  const seenGit = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async (n, d) => { seenTmux.push([n, d]); return true; } };
  const git = { worktreeAdd: async (...a) => { seenGit.push(a); return true; } };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x', base: 'main' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api-feature-x');
  assert.deepEqual(seenGit, [['/home/u/proj-api', 'feature/x', 'main', '/home/u/habitat-worktrees/proj-api/feature-x']]);
  assert.deepEqual(seenTmux, [['proj-api-feature-x', '/home/u/habitat-worktrees/proj-api/feature-x']]);
  server.close();
});

test('POST /spawn con branch usa base=main por default', async () => {
  const seenGit = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async (...a) => { seenGit.push(a); return true; } };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'fix' }),
  });
  assert.equal(seenGit[0][2], 'main');
  server.close();
});

test('POST /spawn branch inválida -> 400', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => true };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: '../evil' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn colisión de tmux de worktree -> 409', async () => {
  const tmux = { listSessions: async () => ['proj-api-feature-x'], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => true };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x' }),
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /spawn fallo de worktreeAdd -> 500', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => false };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feat' }),
  });
  assert.equal(r.status, 500);
  server.close();
});
```

> Nota: el test legacy existente "POST /spawn OK -> 200 con name" (sin `branch`) debe seguir pasando sin cambios.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — los nuevos tests con `branch` fallan (el handler aún ignora `branch`/`git`).

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/index.js`:

a) Agregar import (junto al de tmux, línea ~11):

```javascript
import { worktreeAdd } from './git.js';
import { worktreePaths, worktreeName } from './worktree.js';
```

b) Cambiar la firma de `createApp` (línea 32) para aceptar `git`:

```javascript
export function createApp({ config, store, tmux = { listSessions, newTmuxSession }, git = { worktreeAdd } }) {
```

c) En el handler `/hooks`, agregar el dep `worktreeName` al objeto pasado a `applyEvent` (línea ~51-53):

```javascript
        const { session, fightResult } = applyEvent(store, payload, {
          readUsage, gitBranch, maxContext: config.MAX_CONTEXT, now: () => Date.now(),
          worktreeName: (cwd) => worktreeName(config.WORKTREES_DIR, cwd),
        });
```

d) Reemplazar el bloque del handler `/spawn` (líneas 85-90, desde `const name = basename(dir);` hasta el `res.writeHead(200...)`) por:

```javascript
      const branch = body && body.branch;
      if (branch != null && branch !== '') {
        if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
          res.writeHead(400).end(); return;
        }
        const base = (typeof body.base === 'string' && body.base) ? body.base : 'main';
        const { path, tmux: tmuxName } = worktreePaths(config.WORKTREES_DIR, basename(dir), branch);
        const existing = await tmux.listSessions();
        if (existing.includes(tmuxName)) { res.writeHead(409).end(); return; }
        if (!(await git.worktreeAdd(dir, branch, base, path))) { res.writeHead(500).end(); return; }
        if (!(await tmux.newTmuxSession(tmuxName, path))) { res.writeHead(500).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: tmuxName }));
        return;
      }
      const name = basename(dir);
      const existing = await tmux.listSessions();
      if (existing.includes(name)) { res.writeHead(409).end(); return; }
      const ok = await tmux.newTmuxSession(name, dir);
      if (!ok) { res.writeHead(500).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name }));
      return;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS (nuevos tests + legacy "POST /spawn OK -> 200").

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): /spawn crea worktree+tmux por rama; wirea worktreeName en /hooks"
```

---

### Task 5: Front — form de rama en `SpawnMenu`

**Files:**
- Modify: `habitat/client/src/composables/useProjects.ts`
- Modify: `habitat/client/src/components/SpawnMenu.vue`

**Interfaces:**
- Consumes: `/spawn` con `{ dir, branch, base }` (Task 4).
- Produces: al elegir un proyecto, se abre un form con inputs de rama y base; `spawn(dir, branch, base)` postea los tres campos.

- [ ] **Step 1: Actualizar `useProjects.spawn` para aceptar branch y base**

En `habitat/client/src/composables/useProjects.ts`, reemplazar la función `spawn` (líneas 32-50) por:

```typescript
  async function spawn(dir: string, branch: string, base: string): Promise<boolean> {
    error.value = ''
    try {
      const res = await fetch('/spawn', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ dir, branch, base }),
      })
      if (res.ok) return true
      error.value =
        res.status === 409 ? 'ya hay un agente en esa rama'
        : res.status === 400 ? 'nombre de rama inválido'
        : res.status === 403 ? 'no permitido'
        : 'no se pudo crear el agente'
      return false
    } catch {
      error.value = 'no se pudo crear el agente'
      return false
    }
  }
```

- [ ] **Step 2: Actualizar `SpawnMenu.vue` con el form de rama**

Reemplazar el contenido completo de `habitat/client/src/components/SpawnMenu.vue` por:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const busy = ref(false)
const selected = ref<string | null>(null)
const branch = ref('')
const base = ref('main')

function choose(dir: string) {
  selected.value = dir
  branch.value = ''
  base.value = 'main'
}

async function create() {
  if (!selected.value || !branch.value.trim()) return
  busy.value = true
  const ok = await spawn(selected.value, branch.value.trim(), base.value.trim() || 'main')
  busy.value = false
  if (ok) { open.value = false; selected.value = null }
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="open = !open" :disabled="busy">+ NUEVO AGENTE</button>
    <div class="spawn-menu" v-if="open">
      <template v-if="!selected">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="choose(p.dir)"
        >
          {{ p.name }}
        </button>
      </template>
      <template v-else>
        <input class="spawn-input" v-model="branch" placeholder="rama (ej. feature/x)" :disabled="busy" @keyup.enter="create" />
        <input class="spawn-input" v-model="base" placeholder="base" :disabled="busy" @keyup.enter="create" />
        <button class="ctl spawn-item" :disabled="busy || !branch.trim()" @click="create">CREAR</button>
        <button class="ctl spawn-item" :disabled="busy" @click="selected = null">← VOLVER</button>
      </template>
      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Agregar estilo del input**

En `habitat/client/src/style.css`, agregar (cerca de las reglas `.spawn`/`.spawn-item` existentes):

```css
.spawn-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 4px;
  font: inherit;
}
```

- [ ] **Step 4: Verificar build del cliente**

Run: `cd habitat/client && npm run build`
Expected: build sin errores de TS (genera `habitat/web/`).

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/composables/useProjects.ts habitat/client/src/components/SpawnMenu.vue habitat/client/src/style.css
git commit -m "feat(habitat): form de rama en SpawnMenu para crear agente por worktree"
```

---

### Task 6: Suite completa + doc de README

**Files:**
- Modify: `habitat/README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código; documentación del flujo y verificación end-to-end de tests.

- [ ] **Step 1: Correr toda la suite del server**

Run: `cd habitat && node --test`
Expected: PASS — todos los archivos `*.test.js`, sin fallos.

- [ ] **Step 2: Documentar el flujo en README**

En `habitat/README.md`, en la sección "Crear sesiones desde el panel", agregar tras el párrafo existente:

```markdown
Con `HABITAT_ALLOW_SPAWN=1`, al elegir un proyecto se pide una **rama** y una **base** (default `main`).
Hábitat crea un git worktree en `HABITAT_WORKTREES_DIR` (default `~/habitat-worktrees/<proyecto>/<rama>`),
levanta una sesión tmux `<proyecto>-<rama>` y lanza `claude` dentro. Así varios agentes trabajan el mismo
repo en paralelo, cada uno en su rama. Los worktrees persisten: limpialos con `git worktree remove` cuando
termines.
```

- [ ] **Step 3: Commit**

```bash
git add habitat/README.md
git commit -m "docs(habitat): flujo multi-agente por worktree en README"
```

---

## Self-Review

**Spec coverage:**
- `git.js` / `worktreeAdd` + validación → Task 1. ✔
- `WORKTREES_DIR` en config → Task 2. ✔
- `/spawn` con `{dir,branch,base}` + 409/500 + legacy → Task 4. ✔
- `SessionStart` puebla `s.tmux` + derivación determinística + sin regresión legacy → Task 3 (+ helper en Task 2). ✔
- Front `SpawnMenu` + `useProjects` con branch/base + 409 → Task 5. ✔
- Tests git/index/hooks-logic → Tasks 1, 3, 4 (+ worktree en Task 2). ✔
- Snapshot incluye `s.tmux`: ya cubierto por el filtro existente `!k.startsWith('_')` en `snapOf`/`stripInternal`; sin cambio necesario. ✔

**Placeholder scan:** sin TBD/TODO; todos los steps de código muestran el código completo y comandos con output esperado.

**Type consistency:** `worktreeName(worktreesDir, cwd) → {project,tmux}|null`, `worktreePaths(...) → {path,tmux}`, `worktreeAdd(projectDir,branch,base,path,exec)→bool`, `validBranch→bool`, `branchExists→bool` — usados de forma consistente entre Tasks 1, 2, 3 y 4. El dep `worktreeName` inyectado en `/hooks` (Task 4c) coincide con el consumido en `hooks-logic` (Task 3). El nombre tmux `<proyecto>-<rama-saneada>` es idéntico en `worktreePaths` (Task 2) y en la derivación de `worktreeName` (Task 2), garantizando el round-trip spawn↔SessionStart.
