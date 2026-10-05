# Habitat: infra docker y repos relacionados por sesión — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada sesión de Habitat nazca con worktrees de sus repos relacionados, `.env` renderizados por sesión (puertos y nombres propios) e instrucciones para levantar su stack docker aislado. Además, que la UI muestre y controle ese stack.

**Architecture:** La configuración por proyecto (`related`, `infra`, `envFiles`) se agrega al store JSON existente (`projects.js`). Las plantillas `.env` van en un store aparte con permisos `0600` (`env-store.js`). Un orquestador puro de I/O (`session-setup.js`) arma y desarma los extras de la sesión, usando `env-template.js` (render) y `ports.js` (asignación). `index.js` sólo lo cablea en `/spawn` y `/kill`. En el PR 2 se suman un poller de `docker ps` y el endpoint `/infra/up`.

**Tech Stack:** Node 20 ESM con `http` plano y `node:test`. Vue 3 + Pinia + Vite con vitest, happy-dom y `@vue/test-utils`. git y docker por `execFile`.

**Spec:** `docs/superpowers/specs/2026-10-05-habitat-infra-por-sesion-design.md`

## Global Constraints

- Persistencia en JSON con escritura atómica (tmp + `renameSync`). Sin base de datos ni dependencias nuevas.
- Plantillas `.env`: directorio `0700` y archivos `0600`. Su contenido nunca va en `.projects.json`, en `GET /projects` ni en ningún broadcast del WebSocket.
- `HABITAT_ENVS_DIR` default `habitat/.habitat-envs/`. `HABITAT_PORT_RANGE` default `20000-29999`.
- Carpeta de relacionados dentro del worktree principal: `.habitat-related/<name>/`.
- Variables de plantilla: `{{stack}}`, `{{port:NOMBRE}}` (con `NOMBRE` en `[a-z0-9_]+`), `{{path:self}}`, `{{path:<name>}}` y `{{branch}}`. Cualquier otra cosa entre `{{ }}` es desconocida.
- `related[].name`: `^[A-Za-z0-9][A-Za-z0-9_.-]*$` y distinto de `self`.
- Comandos de infra por defecto: `docker compose up -d` / `docker compose down`. Timeout de `up`: 15 minutos.
- Polling de infra: cada 15 s. Estados: `up` | `partial` | `off`.
- Todo endpoint nuevo pasa por `authorize()` y exige `config.ALLOW_SPAWN`.
- Los proyectos sin configuración (y los contenedor) mantienen exactamente el flujo actual.
- Comentarios y mensajes de UI en español rioplatense, con la densidad de comentarios del código existente.
- Cada `exec`, `probe` y store es inyectable, siguiendo el patrón de `git.js`/`gh.js`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `habitat/server/config.js` (mod) | `ENVS_DIR`, `PORT_RANGE` |
| `habitat/server/env-template.js` (nuevo) | `stackName`, `scan`, `render` (puro) |
| `habitat/server/ports.js` (nuevo) | `probePort`, `usedPorts`, `allocatePorts` |
| `habitat/server/projects.js` (mod) | `validateConfig`, campos `related`/`infra`/`envFiles`, `get(dir)` |
| `habitat/server/env-store.js` (nuevo) | CRUD de plantillas en disco (`0600`) o en memoria |
| `habitat/server/infra.js` (nuevo) | constantes de comandos default; en el PR 2, `runInfraCommand` |
| `habitat/server/session-setup.js` (nuevo) | `ensureExcluded`, `claudeLocal`, `hasConfig`, `prepareSession`, `teardownRelated` |
| `habitat/server/hooks-logic.js` (mod) | copiar `infra` al adoptar la sesión provisional |
| `habitat/server/index.js` (mod) | cableado en spawn/kill, endpoints de configuración y plantillas; en el PR 2, poller y `/infra/up` |
| `habitat/server/docker.js` (mod, PR 2) | `containerStates`, `stateForDir` |
| `habitat/client/src/types.ts` (mod) | `Project` con configuración; `Session.infra` |
| `habitat/client/src/composables/useProjects.ts` (mod) | `saveConfig`, `getEnv`, `saveEnv`, `importEnv`, error de spawn; en el PR 2, `infraUp` |
| `habitat/client/src/components/ProjectConfig.vue` (nuevo) | panel "configurar" de un proyecto |
| `habitat/client/src/components/ProjectsManager.vue` (mod) | botón "configurar" que monta `ProjectConfig` |
| `habitat/client/src/components/InfraBlock.vue` (nuevo, PR 2) | bloque Infra del panel de detalle |
| `habitat/client/src/components/DetailPanel.vue`, `SessionPod.vue` (mod, PR 2) | integrar `InfraBlock` y el indicador |

Comandos de test:
- Server: `cd habitat && node --test server/<archivo>.test.js`; suite completa con `cd habitat && npm test`.
- Cliente: `cd habitat/client && npx vitest run <ruta>`; suite completa con `npx vitest run`; typecheck y build con `npm run build`.

Branch: `feat/habitat-infra-por-sesion`, que ya existe y contiene el spec. Antes de arrancar, ejecutar `git fetch origin && git merge origin/main`, como pide CLAUDE.md.

---

# PR 1: configuración y spawn

### Task 1: Config, `env-template.js` y `ports.js`

**Files:**
- Modify: `habitat/server/config.js`
- Modify: `habitat/server/config.test.js`
- Modify: `habitat/.gitignore`
- Create: `habitat/server/env-template.js`, `habitat/server/env-template.test.js`
- Create: `habitat/server/ports.js`, `habitat/server/ports.test.js`

**Interfaces:**
- Produces:
  - `config.ENVS_DIR: string`, `config.PORT_RANGE: [number, number]`
  - `stackName(project: string, branch: string): string`
  - `scan(template: string, repos: string[]): { ports: string[], unknown: string[] }`. `ports` va ordenado y sin duplicados; `unknown` lleva los tokens literales, por ejemplo `'{{path:x}}'`.
  - `render(template: string, ctx: { stack, branch, paths: Record<string,string>, ports: Record<string,number> }): { ok: true, text } | { ok: false, unknown: string[] }`
  - `probePort(port: number): Promise<boolean>`
  - `usedPorts(sessions: object[]): Set<number>`, que lee `s.infra.ports`.
  - `allocatePorts(names: string[], { range, used?: Set<number>, probe? }): Promise<{ ok: true, ports: Record<string,number> } | { ok: false, error: string }>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `habitat/server/config.test.js`:

```js
test('config: ENVS_DIR y PORT_RANGE con defaults y parseo', async () => {
  delete process.env.HABITAT_ENVS_DIR;
  process.env.HABITAT_PORT_RANGE = '30000-30010';
  const { default: cfg } = await import(`./config.js?range=${Math.random()}`);
  assert.ok(cfg.ENVS_DIR.endsWith('.habitat-envs'));
  assert.deepEqual(cfg.PORT_RANGE, [30000, 30010]);
  process.env.HABITAT_PORT_RANGE = 'basura';
  const { default: cfg2 } = await import(`./config.js?range=${Math.random()}`);
  assert.deepEqual(cfg2.PORT_RANGE, [20000, 29999]);
  process.env.HABITAT_PORT_RANGE = '9000-80'; // invertido -> default
  const { default: cfg3 } = await import(`./config.js?range=${Math.random()}`);
  assert.deepEqual(cfg3.PORT_RANGE, [20000, 29999]);
  delete process.env.HABITAT_PORT_RANGE;
});
```

Crear `habitat/server/env-template.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackName, scan, render } from './env-template.js';

test('stackName normaliza a las reglas de compose', () => {
  assert.equal(stackName('ARTISANO-BackEnd', 'feature/Login'), 'artisano-backend-feature-login');
  assert.equal(stackName('.proj', 'x'), 'proj-x');
  assert.equal(stackName('mi proj', 'b.1'), 'mi-proj-b-1');
});

test('scan junta puertos únicos y ordenados, y tokens desconocidos', () => {
  const t = 'A={{port:db}}\nB={{port:app}}\nC={{ port:db }}\nD={{path:front}}\nE={{nope}}\nF={{port:Mal}}';
  const r = scan(t, ['self', 'infra']);
  assert.deepEqual(r.ports, ['app', 'db']);
  assert.deepEqual(r.unknown, ['{{path:front}}', '{{nope}}', '{{port:Mal}}']);
});

test('render resuelve todas las variables', () => {
  const ctx = { stack: 's-b', branch: 'b', paths: { self: '/wt', infra: '/wt/.habitat-related/infra' }, ports: { app: 20001 } };
  const r = render('N={{stack}}\nP={{port:app}}\nQ={{port:app}}\nC={{path:self}}\nI={{path:infra}}\nB={{branch}}\nX=sin vars', ctx);
  assert.deepEqual(r, { ok: true, text: 'N=s-b\nP=20001\nQ=20001\nC=/wt\nI=/wt/.habitat-related/infra\nB=b\nX=sin vars' });
});

test('render rechaza desconocidas y puertos sin asignar', () => {
  const ctx = { stack: 's', branch: 'b', paths: { self: '/wt' }, ports: {} };
  assert.deepEqual(render('A={{path:front}}', ctx), { ok: false, unknown: ['{{path:front}}'] });
  assert.deepEqual(render('A={{port:db}}', ctx), { ok: false, unknown: ['{{port:db}}'] });
});
```

Crear `habitat/server/ports.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { allocatePorts, usedPorts, probePort } from './ports.js';

test('allocatePorts asigna en orden, salteando usados y ocupados', async () => {
  const busy = new Set([20002]);
  const probe = async (p) => !busy.has(p);
  const r = await allocatePorts(['app', 'db', 'web'], { range: [20000, 20010], used: new Set([20000]), probe });
  assert.deepEqual(r, { ok: true, ports: { app: 20001, db: 20003, web: 20004 } });
});

test('allocatePorts sin nombres no prueba nada', async () => {
  const r = await allocatePorts([], { range: [20000, 20000], probe: async () => { throw new Error('no'); } });
  assert.deepEqual(r, { ok: true, ports: {} });
});

test('allocatePorts falla con el rango agotado', async () => {
  const r = await allocatePorts(['a', 'b'], { range: [20000, 20000], probe: async () => true });
  assert.deepEqual(r, { ok: false, error: 'no hay puertos libres en 20000-20000' });
});

test('usedPorts junta los puertos de las sesiones con infra', () => {
  const s = [{ infra: { ports: { app: 1, db: 2 } } }, {}, { infra: { ports: {} } }];
  assert.deepEqual([...usedPorts(s)].sort(), [1, 2]);
});

test('probePort detecta un puerto ocupado', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '0.0.0.0', r));
  const { port } = srv.address();
  assert.equal(await probePort(port), false);
  await new Promise((r) => srv.close(r));
  assert.equal(await probePort(port), true);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/config.test.js server/env-template.test.js server/ports.test.js`
Expected: FAIL. No existen los módulos y la config no tiene `ENVS_DIR`.

- [ ] **Step 3: Implementar**

En `habitat/server/config.js`, después de la línea de `list`:

```js
// 'a-b' -> [a, b]. Inválido, invertido o fuera de 1024-65535 -> default.
const range = (v, d) => {
  const m = /^(\d+)-(\d+)$/.exec(String(v || '').trim());
  if (!m) return d;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1024 && b <= 65535 && a <= b ? [a, b] : d;
};
```

Y dentro del objeto exportado, debajo de `CLONE_OWNERS`:

```js
  // Plantillas .env por proyecto (secretos): fuera de los repos, 0700/0600.
  ENVS_DIR: process.env.HABITAT_ENVS_DIR || join(HERE, '..', '.habitat-envs'),
  // Rango de puertos de host que se asignan a las sesiones ({{port:X}}).
  PORT_RANGE: range(process.env.HABITAT_PORT_RANGE, [20000, 29999]),
```

En `habitat/.gitignore`, agregar una línea `.habitat-envs/`. Hay que leer el archivo primero; si no existe, se crea con esa línea.

Crear `habitat/server/env-template.js`:

```js
// Plantillas .env de proyecto: variables que se resuelven por sesión. Puro (sin I/O):
// lo usan la validación al guardar (scan) y el spawn (scan + render).
const TOKEN_RE = /\{\{([^{}]*)\}\}/g;
const PORT_NAME_RE = /^[a-z0-9_]+$/;

// Nombre de proyecto de compose: minúsculas, [a-z0-9_-], empieza con letra o dígito.
export function stackName(project, branch) {
  const s = `${project}-${branch}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '');
  return s || 'habitat';
}

// repos: nombres válidos para {{path:X}} ('self' + los relacionados).
function classify(raw, repos) {
  const t = raw.trim();
  if (t === 'stack' || t === 'branch') return { kind: t };
  const m = /^(port|path):(.+)$/.exec(t);
  if (m && m[1] === 'port' && PORT_NAME_RE.test(m[2])) return { kind: 'port', arg: m[2] };
  if (m && m[1] === 'path' && repos.includes(m[2])) return { kind: 'path', arg: m[2] };
  return { kind: 'unknown' };
}

export function scan(template, repos) {
  const ports = new Set();
  const unknown = [];
  for (const m of String(template).matchAll(TOKEN_RE)) {
    const c = classify(m[1], repos);
    if (c.kind === 'port') ports.add(c.arg);
    else if (c.kind === 'unknown' && !unknown.includes(m[0])) unknown.push(m[0]);
  }
  return { ports: [...ports].sort(), unknown };
}

export function render(template, ctx) {
  const repos = Object.keys(ctx.paths);
  const { ports, unknown } = scan(template, repos);
  for (const p of ports) if (ctx.ports[p] == null) unknown.push(`{{port:${p}}}`);
  if (unknown.length) return { ok: false, unknown };
  const text = String(template).replace(TOKEN_RE, (_, raw) => {
    const c = classify(raw, repos);
    if (c.kind === 'stack') return ctx.stack;
    if (c.kind === 'branch') return ctx.branch;
    if (c.kind === 'path') return ctx.paths[c.arg];
    return String(ctx.ports[c.arg]);
  });
  return { ok: true, text };
}
```

Crear `habitat/server/ports.js`:

```js
import { createServer } from 'node:net';

// ¿El puerto está libre en el host? Intenta escucharlo en todas las interfaces, que es
// donde publica docker por default.
export function probePort(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '0.0.0.0', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

// Puertos ya asignados a sesiones vivas (session.infra.ports).
export function usedPorts(sessions) {
  const used = new Set();
  for (const s of sessions) for (const p of Object.values((s && s.infra && s.infra.ports) || {})) used.add(p);
  return used;
}

// Un puerto por nombre, recorriendo el rango en orden. Saltea los ya asignados (used) y
// los que el probe ve ocupados en el host.
export async function allocatePorts(names, { range, used = new Set(), probe = probePort }) {
  const ports = {};
  const taken = new Set(used);
  let next = range[0];
  for (const name of names) {
    let found = null;
    while (next <= range[1]) {
      const p = next++;
      if (taken.has(p)) continue;
      if (await probe(p)) { found = p; break; }
    }
    if (found == null) return { ok: false, error: `no hay puertos libres en ${range[0]}-${range[1]}` };
    taken.add(found);
    ports[name] = found;
  }
  return { ok: true, ports };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/config.test.js server/env-template.test.js server/ports.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/config.test.js habitat/.gitignore habitat/server/env-template.js habitat/server/env-template.test.js habitat/server/ports.js habitat/server/ports.test.js
git commit -m "feat(habitat): plantillas .env con variables por sesión y asignación de puertos"
```

---

### Task 2: Configuración de proyecto en `projects.js` y `env-store.js`

**Files:**
- Modify: `habitat/server/projects.js`
- Modify: `habitat/server/projects.test.js`
- Create: `habitat/server/env-store.js`, `habitat/server/env-store.test.js`

**Interfaces:**
- Produces:
  - `validateConfig({ related, infra, envFiles }, selfDir): { ok: true, value: { related, infra, envFiles } } | { ok: false, error: string }`
  - Los registros de `list()`, `get(dir)` y `add`/`update` traen `related: {dir,name}[]`, `infra: {repo,path,up,down} | null` y `envFiles: {repo,path}[]`.
  - `projects.get(dir): record | null`
  - `projects.update({ dir, label?, color?, chars?, related?, infra?, envFiles? })`. Si viene cualquiera de los tres campos de configuración, se fusiona con la configuración actual y se valida entera. Ante un error, devuelve `{ ok: false, error }`.
  - `hasConfig(record): boolean`
  - `createEnvStore({ dir? }): { get(project, repo, path): string, set(project, repo, path, content): void, remove(project, repo, path): void, removeProject(project): void }`. Sin `dir`, funciona en memoria.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `habitat/server/projects.test.js`. Ajustar el import a `import { createProjects, validateConfig, hasConfig } from './projects.js';`.

```js
const CFG = {
  related: [{ dir: '/r/infra-repo', name: 'infra' }, { dir: '/r/front', name: 'front' }],
  infra: { repo: 'infra', path: 'docker', up: 'make up', down: '' },
  envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: 'docker/.env' }],
};

test('validateConfig acepta una config completa y normaliza defaults', () => {
  const r = validateConfig(CFG, '/r/back');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.infra, { repo: 'infra', path: 'docker', up: 'make up', down: '' });
  assert.deepEqual(validateConfig({}, '/r/back'), { ok: true, value: { related: [], infra: null, envFiles: [] } });
});

test('validateConfig rechaza lo inválido', () => {
  const bad = [
    { related: [{ dir: 'rel/x', name: 'a' }] },                                   // dir no absoluto
    { related: [{ dir: '/r/back', name: 'a' }] },                                 // el propio proyecto
    { related: [{ dir: '/r/x', name: 'self' }] },                                 // nombre reservado
    { related: [{ dir: '/r/x', name: '-a' }] },                                   // formato
    { related: [{ dir: '/r/x', name: 'a' }, { dir: '/r/y', name: 'a' }] },        // duplicado
    { infra: { repo: 'self', path: '../afuera' } },                               // escapa
    { infra: { repo: 'self', path: '/abs' } },                                    // absoluto
    { envFiles: [{ repo: 'self', path: '' }] },                                   // path vacío
    { envFiles: [{ repo: 'self', path: '.env' }, { repo: 'self', path: '.env' }] },// duplicado
  ];
  for (const c of bad) assert.equal(validateConfig(c, '/r/back').ok, false, JSON.stringify(c));
});

test('validateConfig lista las referencias colgantes', () => {
  const r = validateConfig({ related: [], infra: { repo: 'infra' }, envFiles: [{ repo: 'front', path: '.env' }] }, '/r/back');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'referencias a relacionados inexistentes: infra, front');
});

test('update con config la guarda, la persiste y la devuelve en list/get', () => {
  const path = tmpPath('cfg');
  rmSync(path, { force: true });
  try {
    const p = createProjects({ persistPath: path, seed: ['/r/back'] });
    const r = p.update({ dir: '/r/back', ...CFG });
    assert.equal(r.ok, true);
    assert.deepEqual(r.record.related, CFG.related);
    const again = createProjects({ persistPath: path });
    assert.deepEqual(again.get('/r/back').envFiles, CFG.envFiles);
    assert.equal(hasConfig(again.get('/r/back')), true);
    // update parcial: sólo color, la config se conserva
    p.update({ dir: '/r/back', color: PALETTE[1] });
    assert.deepEqual(p.get('/r/back').infra, { repo: 'infra', path: 'docker', up: 'make up', down: '' });
  } finally { rmSync(path, { force: true }); }
});

test('update con config inválida no cambia nada y devuelve el error', () => {
  const p = createProjects({ seed: ['/r/back'] });
  const r = p.update({ dir: '/r/back', envFiles: [{ repo: 'front', path: '.env' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /front/);
  assert.deepEqual(p.get('/r/back').envFiles, []);
  assert.equal(hasConfig(p.get('/r/back')), false);
  assert.equal(p.get('/nope'), null);
});
```

Crear `habitat/server/env-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvStore } from './env-store.js';

test('env-store en disco: set/get con 0600 y carpeta 0700, path con / codificado', () => {
  const base = mkdtempSync(join(tmpdir(), 'habitat-envs-'));
  const dir = join(base, 'envs');
  try {
    const s = createEnvStore({ dir });
    assert.equal(s.get('back', 'self', '.env'), '');
    s.set('back', 'infra', 'docker/.env', 'A=1\n');
    assert.equal(s.get('back', 'infra', 'docker/.env'), 'A=1\n');
    assert.deepEqual(readdirSync(join(dir, 'back')), ['infra__docker%2F.env.env']);
    assert.equal(statSync(join(dir, 'back', 'infra__docker%2F.env.env')).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    s.remove('back', 'infra', 'docker/.env');
    assert.equal(s.get('back', 'infra', 'docker/.env'), '');
    s.set('back', 'self', '.env', 'B=2');
    s.removeProject('back');
    assert.equal(existsSync(join(dir, 'back')), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('env-store sin dir funciona en memoria', () => {
  const s = createEnvStore();
  s.set('p', 'self', '.env', 'X=1');
  assert.equal(s.get('p', 'self', '.env'), 'X=1');
  s.removeProject('p');
  assert.equal(s.get('p', 'self', '.env'), '');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/projects.test.js server/env-store.test.js`
Expected: FAIL. `validateConfig`, `hasConfig`, `get` y `env-store.js` no existen.

- [ ] **Step 3: Implementar**

En `habitat/server/projects.js`, cambiar el import de path a `import { basename, isAbsolute } from 'node:path';` y agregar, antes de `seedRecord`:

```js
const REL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// Relativo, sin '..' ni absoluto. allowEmpty: '' = raíz del repo (subcarpeta de infra).
const safeRel = (p, allowEmpty) => typeof p === 'string' && (allowEmpty || p !== '')
  && !isAbsolute(p) && !p.split(/[\\/]/).includes('..');
const fail = (error) => ({ ok: false, error });

// Valida y normaliza la config de infra/relacionados de un proyecto. Sólo forma: la
// existencia en disco de los relacionados la chequea index.js (async, con realpath).
export function validateConfig({ related = [], infra = null, envFiles = [] } = {}, selfDir) {
  if (!Array.isArray(related) || !Array.isArray(envFiles)) return fail('config inválida');
  const names = new Set();
  const rel = [];
  for (const r of related) {
    if (!r || typeof r.dir !== 'string' || !isAbsolute(r.dir)) return fail('relacionado: ruta inválida');
    if (r.dir === selfDir) return fail('relacionado: no puede ser el propio proyecto');
    if (typeof r.name !== 'string' || !REL_NAME_RE.test(r.name) || r.name === 'self') return fail(`relacionado: nombre inválido "${r && r.name}"`);
    if (names.has(r.name)) return fail(`relacionado: nombre duplicado "${r.name}"`);
    names.add(r.name);
    rel.push({ dir: r.dir, name: r.name });
  }
  const known = (x) => x === 'self' || names.has(x);
  const dangling = [];
  if (infra != null && !known(infra.repo)) dangling.push(String(infra.repo));
  for (const e of envFiles) if (e && !known(e.repo) && !dangling.includes(String(e.repo))) dangling.push(String(e.repo));
  if (dangling.length) return fail(`referencias a relacionados inexistentes: ${dangling.join(', ')}`);
  let inf = null;
  if (infra != null) {
    if (typeof infra !== 'object') return fail('infra inválida');
    const path = infra.path ?? '';
    const up = infra.up ?? '';
    const down = infra.down ?? '';
    if (!safeRel(path, true)) return fail('infra: subcarpeta inválida');
    if (typeof up !== 'string' || typeof down !== 'string') return fail('infra: comandos inválidos');
    inf = { repo: infra.repo, path, up, down };
  }
  const seen = new Set();
  const env = [];
  for (const e of envFiles) {
    if (!e || !safeRel(e.path, false)) return fail(`archivo .env: ruta inválida "${e && e.path}"`);
    const key = `${e.repo}\0${e.path}`;
    if (seen.has(key)) return fail(`archivo .env duplicado: ${e.repo}/${e.path}`);
    seen.add(key);
    env.push({ repo: e.repo, path: e.path });
  }
  return { ok: true, value: { related: rel, infra: inf, envFiles: env } };
}

// ¿El proyecto tiene algo que preparar en el spawn más allá del worktree?
export function hasConfig(p) {
  return !!(p && (p.related.length || p.infra || p.envFiles.length));
}
```

En `seedRecord`, devolver además `related: [], infra: null, envFiles: []`.

En la carga (`.map((p) => ({ ... }))`), agregar al objeto la configuración validada. Si es inválida, se descarta en lugar de romper el arranque:

```js
          .map((p) => {
            const cfg = validateConfig({ related: p.related, infra: p.infra, envFiles: p.envFiles }, p.dir);
            return {
              dir: p.dir,
              label: typeof p.label === 'string' && p.label ? p.label : basename(p.dir),
              color: validColor(p.color) ? p.color : pickColor(p.dir),
              chars: validChars(p.chars) ? [...p.chars] : [],
              ...(cfg.ok ? cfg.value : { related: [], infra: null, envFiles: [] }),
            };
          });
```

Reemplazar `copy` y extender `add`, `update` y el objeto devuelto:

```js
  const copy = (r) => ({
    dir: r.dir, label: r.label, color: r.color, chars: [...r.chars],
    related: r.related.map((x) => ({ ...x })),
    infra: r.infra ? { ...r.infra } : null,
    envFiles: r.envFiles.map((x) => ({ ...x })),
  });
```

En `add`, el `record` suma `related: [], infra: null, envFiles: []`. Agregar `get: (dir) => { const r = find(dir); return r ? copy(r) : null; },` junto a `has`. Reemplazar `update` por:

```js
    update: ({ dir, label, color, chars, related, infra, envFiles } = {}) => {
      const r = find(dir);
      if (!r) return { ok: false, error: 'no existe' };
      if (color != null && !validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      let cfg = null;
      if (related !== undefined || infra !== undefined || envFiles !== undefined) {
        cfg = validateConfig({
          related: related !== undefined ? related : r.related,
          infra: infra !== undefined ? infra : r.infra,
          envFiles: envFiles !== undefined ? envFiles : r.envFiles,
        }, r.dir);
        if (!cfg.ok) return cfg;
      }
      if (typeof label === 'string' && label) r.label = label;
      if (color != null) r.color = color;
      if (chars != null) r.chars = [...chars];
      if (cfg) Object.assign(r, cfg.value);
      persist();
      return { ok: true, record: copy(r) };
    },
```

Crear `habitat/server/env-store.js`:

```js
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Plantillas .env por proyecto. Tienen secretos: viven fuera de .projects.json (que se
// broadcastea) con 0700/0600, y sólo salen por endpoints autenticados. Sin `dir`,
// en memoria (tests), como createProjects sin persistPath.
const fileName = (repo, path) => `${repo}__${encodeURIComponent(path)}.env`;

export function createEnvStore({ dir } = {}) {
  if (!dir) {
    const mem = new Map();
    const key = (p, r, f) => `${p}\0${r}\0${f}`;
    return {
      get: (p, r, f) => mem.get(key(p, r, f)) ?? '',
      set: (p, r, f, content) => { mem.set(key(p, r, f), String(content)); },
      remove: (p, r, f) => { mem.delete(key(p, r, f)); },
      removeProject: (p) => { for (const k of [...mem.keys()]) if (k.startsWith(`${p}\0`)) mem.delete(k); },
    };
  }
  const projDir = (project) => join(dir, encodeURIComponent(project));
  return {
    get(project, repo, path) {
      try { return readFileSync(join(projDir(project), fileName(repo, path)), 'utf8'); } catch { return ''; }
    },
    set(project, repo, path, content) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      mkdirSync(projDir(project), { recursive: true, mode: 0o700 });
      const f = join(projDir(project), fileName(repo, path));
      const tmp = `${f}.tmp`;
      writeFileSync(tmp, String(content), { mode: 0o600 });
      renameSync(tmp, f); // atómico
    },
    remove(project, repo, path) {
      rmSync(join(projDir(project), fileName(repo, path)), { force: true });
    },
    removeProject(project) {
      rmSync(projDir(project), { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/projects.test.js server/env-store.test.js && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS, y la suite completa sigue en `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/projects.js habitat/server/projects.test.js habitat/server/env-store.js habitat/server/env-store.test.js
git commit -m "feat(habitat): config de relacionados/infra/envFiles por proyecto y store de plantillas"
```

---

### Task 3: Orquestador `session-setup.js`

**Files:**
- Create: `habitat/server/infra.js`
- Create: `habitat/server/session-setup.js`, `habitat/server/session-setup.test.js`

**Interfaces:**
- Consumes:
  - `scan`, `render`, `stackName` (Task 1)
  - `createEnvStore` (Task 2)
  - De `git.js`: `worktreeAdd(projectDir, branch, base, path, exec?) -> Promise<boolean>`, `worktreeRemove(projectDir, path, { force }, exec?) -> Promise<boolean>`, `remoteDefaultBranch(repoDir, exec?) -> Promise<string>`, `defaultExec(file, args, opts?) -> Promise<string>` y `NET_OPTS`.
- Produces:
  - `infra.js`: `DEFAULT_UP = 'docker compose up -d'`, `DEFAULT_DOWN = 'docker compose down'`.
  - `RELATED_DIR = '.habitat-related'`
  - `ensureExcluded(repoDir, patterns: string[], exec): Promise<void>`
  - `claudeLocal({ branch, stack, ports, infra, infraDirRel, related }): string`
  - `prepareSession({ project, projectName, branch, wtPath, envStore, allocate, git }): Promise<{ ok: true, infra: { stack, ports, dir: string|null, branch } } | { ok: false, error: string }>`. `git` es `{ worktreeAdd, worktreeRemove, remoteDefaultBranch, exec }`, y `allocate(names: string[]) -> Promise<allocatePorts result>`. **No** crea ni remueve el worktree principal: de eso se encarga el caller.
  - `teardownRelated({ related, branch, wtPath, git }): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `habitat/server/session-setup.test.js`. Usa repos git reales:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as realGit from './git.js';
import { createEnvStore } from './env-store.js';
import { prepareSession, teardownRelated, claudeLocal, RELATED_DIR } from './session-setup.js';

const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' }).toString();
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-b', 'main');
  gitIn(dir, 'config', 'user.email', 't@l'); gitIn(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-m', 'init');
}
const git = {
  worktreeAdd: realGit.worktreeAdd, worktreeRemove: realGit.worktreeRemove,
  remoteDefaultBranch: realGit.remoteDefaultBranch, exec: realGit.defaultExec,
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'habitat-setup-'));
  const back = join(root, 'back');
  const infraRepo = join(root, 'docker');
  initRepo(back); initRepo(infraRepo);
  const wtPath = join(root, 'wt', 'back', 'bob');
  gitIn(back, 'worktree', 'add', '-b', 'bob', wtPath, 'main'); // el worktree principal lo crea el caller
  const project = {
    dir: back, related: [{ dir: infraRepo, name: 'infra' }],
    infra: { repo: 'infra', path: '', up: 'make up', down: '' },
    envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: 'cfg/.env' }],
  };
  const envStore = createEnvStore();
  envStore.set('back', 'self', '.env', 'DB_PORT={{port:db}}\n');
  envStore.set('back', 'infra', 'cfg/.env', 'COMPOSE_PROJECT_NAME={{stack}}\nAPP={{path:self}}\nDB={{port:db}}\nWEB={{port:web}}\n');
  return { root, back, infraRepo, wtPath, project, envStore };
}
const allocate = async (names) => ({ ok: true, ports: Object.fromEntries(names.map((n, i) => [n, 21000 + i])) });

test('prepareSession arma relacionados, .env, CLAUDE.local.md y exclude', async () => {
  const f = fixture();
  try {
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.equal(r.ok, true, r.error);
    const infraWt = join(f.wtPath, RELATED_DIR, 'infra');
    assert.deepEqual(r.infra, { stack: 'back-bob', ports: { db: 21000, web: 21001 }, dir: infraWt, branch: 'bob' });
    assert.equal(gitIn(infraWt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'bob');
    assert.equal(readFileSync(join(f.wtPath, '.env'), 'utf8'), 'DB_PORT=21000\n');
    assert.equal(readFileSync(join(infraWt, 'cfg/.env'), 'utf8'),
      `COMPOSE_PROJECT_NAME=back-bob\nAPP=${f.wtPath}\nDB=21000\nWEB=21001\n`);
    assert.equal(statSync(join(infraWt, 'cfg/.env')).mode & 0o777, 0o600);
    const md = readFileSync(join(f.wtPath, 'CLAUDE.local.md'), 'utf8');
    assert.match(md, /make up/);
    assert.match(md, /db → localhost:21000/);
    assert.match(md, /\.habitat-related\/infra/);
    // nada de lo generado ensucia git status
    assert.equal(gitIn(f.wtPath, 'status', '--porcelain'), '');
    assert.equal(gitIn(infraWt, 'status', '--porcelain'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('prepareSession con relacionado inexistente hace rollback y explica', async () => {
  const f = fixture();
  try {
    f.project.related.push({ dir: join(f.root, 'no-existe'), name: 'front' });
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.deepEqual(r, { ok: false, error: 'el repo relacionado front no existe' });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false); // rollback del ya creado
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('prepareSession falla con variable desconocida o sin puertos, con rollback', async () => {
  const f = fixture();
  try {
    f.envStore.set('back', 'self', '.env', 'X={{path:front}}');
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.deepEqual(r, { ok: false, error: 'plantilla self/.env: variables desconocidas: {{path:front}}' });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false);
    f.envStore.set('back', 'self', '.env', 'X={{port:db}}');
    const r2 = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore,
      allocate: async () => ({ ok: false, error: 'no hay puertos libres en 1-1' }), git });
    assert.deepEqual(r2, { ok: false, error: 'no hay puertos libres en 1-1' });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('teardownRelated remueve worktrees limpios y borra su rama; conserva los sucios', async () => {
  const f = fixture();
  try {
    const front = join(f.root, 'front'); initRepo(front);
    f.project.related.push({ dir: front, name: 'front' });
    const r = await prepareSession({ project: f.project, projectName: 'back', branch: 'bob', wtPath: f.wtPath, envStore: f.envStore, allocate, git });
    assert.equal(r.ok, true, r.error);
    writeFileSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt'), 'wip'); // front queda sucio
    await teardownRelated({ related: f.project.related, branch: 'bob', wtPath: f.wtPath, git });
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'infra')), false);
    assert.equal(gitIn(f.infraRepo, 'branch', '--list', 'bob').trim(), ''); // rama sin commits: borrada
    assert.equal(existsSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt')), true);
    assert.match(gitIn(front, 'branch', '--list', 'bob'), /bob/);
    // con los relacionados limpios fuera, el principal se puede remover sin --force
    rmSync(join(f.wtPath, RELATED_DIR, 'front', 'sucio.txt'));
    await teardownRelated({ related: f.project.related, branch: 'bob', wtPath: f.wtPath, git });
    assert.equal(await realGit.worktreeRemove(f.back, f.wtPath), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('claudeLocal sin infra ni puertos sólo lista relacionados', () => {
  const md = claudeLocal({ branch: 'b', stack: 's', ports: {}, infra: null, infraDirRel: null, related: [{ name: 'front' }] });
  assert.doesNotMatch(md, /Infra/);
  assert.match(md, /front: `\.habitat-related\/front`/);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/session-setup.test.js`
Expected: FAIL, porque no existe `session-setup.js`.

- [ ] **Step 3: Implementar**

Crear `habitat/server/infra.js`:

```js
// Comandos de infra por default (proyecto con infra.up/down vacíos).
export const DEFAULT_UP = 'docker compose up -d';
export const DEFAULT_DOWN = 'docker compose down';
```

Crear `habitat/server/session-setup.js`:

```js
import { mkdir, writeFile, readFile, appendFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { scan, render, stackName } from './env-template.js';
import { DEFAULT_UP, DEFAULT_DOWN } from './infra.js';
import { NET_OPTS } from './git.js';

// Extras de una sesión con config de proyecto: worktrees de relacionados, .env
// renderizados, CLAUDE.local.md. El worktree principal lo crea/remueve el caller.
export const RELATED_DIR = '.habitat-related';

// Agrega patrones a info/exclude del directorio común del repo (compartido por todos
// sus worktrees, local, no se commitea). Idempotente.
export async function ensureExcluded(repoDir, patterns, exec) {
  const common = String(await exec('git', ['-C', repoDir, 'rev-parse', '--git-common-dir'])).trim();
  const file = join(resolve(repoDir, common), 'info', 'exclude');
  let cur = '';
  try { cur = await readFile(file, 'utf8'); } catch { /* sin exclude aún */ }
  const have = new Set(cur.split('\n').map((l) => l.trim()));
  const missing = patterns.filter((p) => !have.has(p));
  if (!missing.length) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, (cur && !cur.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

export function claudeLocal({ branch, stack, ports, infra, infraDirRel, related }) {
  const L = ['# Sesión de Habitat', '', 'Archivo generado por Habitat para esta sesión (no se commitea).', ''];
  if (infra) {
    L.push('## Infra docker', '',
      `- Carpeta: \`${infraDirRel}\``,
      `- Levantar: \`${infra.up || DEFAULT_UP}\``,
      `- Bajar: \`${infra.down || DEFAULT_DOWN}\``,
      `- Stack: \`${stack}\``,
      '- Arranca apagada: levantala sólo si la tarea lo necesita. Al cerrar la sesión Habitat la baja sola.',
      '');
  }
  const names = Object.keys(ports);
  if (names.length) {
    L.push('## Puertos de esta sesión', '');
    for (const n of names) L.push(`- ${n} → localhost:${ports[n]}`);
    L.push('');
  }
  if (related.length) {
    L.push('## Repos relacionados', '',
      `Cada uno es un worktree en su propia rama \`${branch}\`: commiteá y pusheá desde ese repo.`, '');
    for (const r of related) L.push(`- ${r.name}: \`${RELATED_DIR}/${r.name}\``);
    L.push('');
  }
  return L.join('\n');
}

export async function prepareSession({ project, projectName, branch, wtPath, envStore, allocate, git }) {
  const created = [];
  const fail = async (error) => {
    for (const c of [...created].reverse()) await git.worktreeRemove(c.repoDir, c.path, { force: true });
    return { ok: false, error };
  };
  try {
    const paths = { self: wtPath };
    if (project.related.length || project.infra) {
      await ensureExcluded(project.dir, [`/${RELATED_DIR}/`, '/CLAUDE.local.md'], git.exec);
    }
    for (const r of project.related) {
      if (!existsSync(r.dir)) return fail(`el repo relacionado ${r.name} no existe`);
      const path = join(wtPath, RELATED_DIR, r.name);
      try { await git.exec('git', ['-C', r.dir, 'fetch', 'origin'], NET_OPTS); } catch { /* best-effort */ }
      const base = await git.remoteDefaultBranch(r.dir);
      if (!(await git.worktreeAdd(r.dir, branch, base, path))) return fail(`falló el worktree de ${r.name}`);
      created.push({ repoDir: r.dir, path });
      paths[r.name] = path;
    }
    const repos = Object.keys(paths);
    const templates = project.envFiles.map((e) => ({ ...e, content: envStore.get(projectName, e.repo, e.path) }));
    const portNames = new Set();
    for (const t of templates) {
      const s = scan(t.content, repos);
      if (s.unknown.length) return fail(`plantilla ${t.repo}/${t.path}: variables desconocidas: ${s.unknown.join(', ')}`);
      for (const p of s.ports) portNames.add(p);
    }
    const alloc = await allocate([...portNames].sort());
    if (!alloc.ok) return fail(alloc.error);
    const stack = stackName(projectName, branch);
    const ctx = { stack, branch, paths, ports: alloc.ports };
    for (const t of templates) {
      const root = paths[t.repo];
      const target = resolve(root, t.path);
      if (!target.startsWith(root + sep)) return fail(`plantilla ${t.repo}/${t.path}: ruta inválida`);
      const out = render(t.content, ctx);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, out.text, { mode: 0o600 });
      await chmod(target, 0o600); // writeFile no cambia el modo de un archivo existente
      const repoDir = t.repo === 'self' ? project.dir : project.related.find((r) => r.name === t.repo).dir;
      await ensureExcluded(repoDir, [`/${t.path}`], git.exec);
    }
    const infraDir = project.infra ? resolve(paths[project.infra.repo], project.infra.path || '.') : null;
    if (project.infra || project.related.length) {
      await writeFile(join(wtPath, 'CLAUDE.local.md'), claudeLocal({
        branch, stack, ports: alloc.ports, infra: project.infra,
        infraDirRel: infraDir ? (relative(wtPath, infraDir) || '.') : null,
        related: project.related,
      }));
    }
    return { ok: true, infra: { stack, ports: alloc.ports, dir: infraDir, branch } };
  } catch (e) {
    return fail(`no se pudo preparar la sesión: ${(e && e.message) || e}`);
  }
}

// Cierre: remueve cada worktree relacionado sin forzar (si tiene cambios, git se niega y
// queda en disco) y, si salió, borra su rama con -d (sólo si no tiene commits sin mergear).
export async function teardownRelated({ related, branch, wtPath, git }) {
  for (const r of related) {
    const path = join(wtPath, RELATED_DIR, r.name);
    if (await git.worktreeRemove(r.dir, path)) {
      try { await git.exec('git', ['-C', r.dir, 'branch', '-d', branch]); } catch { /* tiene commits o no existe */ }
    }
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd habitat && node --test server/session-setup.test.js`
Expected: PASS. Si el test de `teardownRelated` falla porque `branch -d` no borra la rama, verificar que el worktree relacionado se creó con `-b bob ... main`. Sin remoto, `remoteDefaultBranch` cae a `currentBranch`, la rama queda mergeada en `HEAD` y `-d` la borra.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/infra.js habitat/server/session-setup.js habitat/server/session-setup.test.js
git commit -m "feat(habitat): orquestador de extras de sesión (relacionados, .env, CLAUDE.local.md)"
```

---

### Task 4: Cablear spawn, kill y adopción

**Files:**
- Modify: `habitat/server/index.js` (imports; `createApp` ~L91-96; `projectsForClient` ~L161; `POST /spawn` ~L695-735; `POST /kill` ~L765-795; arranque ~L925)
- Modify: `habitat/server/hooks-logic.js` (~L164-170)
- Modify: `habitat/server/hooks-logic.test.js`, `habitat/server/index.test.js`
- Modify: `habitat/client/src/composables/useProjects.ts` (función `spawn`)

**Interfaces:**
- Consumes:
  - `prepareSession`, `teardownRelated` (Task 3)
  - `allocatePorts`, `usedPorts` (Task 1)
  - `createEnvStore`, `hasConfig`, `projects.get` (Task 2)
- Produces:
  - `createApp({ ..., envStore, probePort })`. `envStore` tiene como default `createEnvStore({ dir: config.ENVS_DIR })`, que con `ENVS_DIR` undefined queda en memoria.
  - El objeto `git` de `createApp` suma `exec: defaultExec`.
  - La sesión provisional, y la real tras la adopción, tienen `infra: { stack, ports, dir, branch }`.
  - `POST /spawn` responde 500 con `{ error }` cuando falla `prepareSession`.
  - `GET /projects` incluye `related`, `infra` y `envFiles` en cada proyecto.

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/hooks-logic.test.js`, agregar el test siguiendo el estilo existente: `applyEvent(store, payload, deps)` con `createStore()` y `newSession`. Revisar los imports al principio del archivo.

```js
test('SessionStart que adopta el pod provisional conserva su infra', () => {
  const store = createStore();
  store.upsert(newSession('pending:back-bob', { tmux: 'back-bob', infra: { stack: 'back-bob', ports: { db: 21000 }, dir: '/wt/x', branch: 'bob' } }));
  const { session, removed } = applyEvent(store, {
    session_id: 'real-1', cwd: '/wt/back/bob', hook_event_name: 'SessionStart',
  }, { worktreeName: () => ({ project: 'back', tmux: 'back-bob' }) });
  assert.equal(removed, 'pending:back-bob');
  assert.deepEqual(session.infra, { stack: 'back-bob', ports: { db: 21000 }, dir: '/wt/x', branch: 'bob' });
});
```

En `habitat/server/index.test.js`, agregar los imports `import { createEnvStore } from './env-store.js';` y `import { RELATED_DIR } from './session-setup.js';`, y al final:

```js
// --- Infra y relacionados por sesión ---

function initRepoAt(dir) {
  mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  g('init', '-b', 'main'); g('config', 'user.email', 't@l'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-m', 'init');
}

function infraSetup() {
  const root = mkdtempSync(join(tmpdir(), 'habitat-infra-'));
  const back = join(root, 'proyectos', 'back');
  const docker = join(root, 'proyectos', 'docker');
  initRepoAt(back); initRepoAt(docker);
  const projectsStore = createProjects({ seed: [back] });
  projectsStore.update({
    dir: back,
    related: [{ dir: docker, name: 'infra' }],
    infra: { repo: 'infra', path: '', up: 'make up', down: '' },
    envFiles: [{ repo: 'infra', path: '.env' }],
  });
  const envStore = createEnvStore();
  envStore.set('back', 'infra', '.env', 'COMPOSE_PROJECT_NAME={{stack}}\nAPP={{path:self}}\nDB_PORT={{port:db}}\n');
  const cfg = {
    ...config, ALLOW_SPAWN: true, PROJECTS: [], PROJECTS_ROOT: join(root, 'proyectos'),
    WORKTREES_DIR: join(root, 'wt'), PORT_RANGE: [41000, 41100], DOCKER_CLEANUP: false,
  };
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  return { root, back, docker, projectsStore, envStore, cfg, tmux };
}
const spawnReq = (port, body) => fetch(`http://127.0.0.1:${port}/spawn`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /spawn con config arma relacionados, .env e infra en la sesión provisional', async () => {
  const f = infraSetup();
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const r = await spawnReq(port, { dir: f.back, name: 'bob' });
    assert.equal(r.status, 200);
    const wt = join(f.root, 'wt', 'back', 'bob');
    const infraDir = join(wt, RELATED_DIR, 'infra');
    const env = readFileSync(join(infraDir, '.env'), 'utf8');
    assert.match(env, /COMPOSE_PROJECT_NAME=back-bob/);
    assert.match(env, new RegExp(`APP=${wt}`));
    assert.match(env, /DB_PORT=410\d\d/);
    assert.ok(existsSync(join(wt, 'CLAUDE.local.md')));
    const pod = store.get('pending:back-bob');
    assert.equal(pod.infra.dir, infraDir);
    assert.equal(pod.infra.branch, 'bob');
    assert.ok(pod.infra.ports.db >= 41000 && pod.infra.ports.db <= 41100);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('POST /spawn con config inválida en el spawn -> 500 con error y rollback del worktree', async () => {
  const f = infraSetup();
  f.envStore.set('back', 'infra', '.env', 'X={{path:front}}');
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const r = await spawnReq(port, { dir: f.back, name: 'bob' });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'plantilla infra/.env: variables desconocidas: {{path:front}}' });
    assert.equal(existsSync(join(f.root, 'wt', 'back', 'bob')), false);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('POST /spawn de dos sesiones del mismo proyecto no repite puertos', async () => {
  const f = infraSetup();
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    assert.equal((await spawnReq(port, { dir: f.back, name: 'bob' })).status, 200);
    assert.equal((await spawnReq(port, { dir: f.back, name: 'ana' })).status, 200);
    assert.notEqual(store.get('pending:back-bob').infra.ports.db, store.get('pending:back-ana').infra.ports.db);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('POST /kill limpia los worktrees relacionados y su rama', async () => {
  const f = infraSetup();
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    assert.equal((await spawnReq(port, { dir: f.back, name: 'bob' })).status, 200);
    assert.equal(store.get('pending:back-bob').infra.branch, 'bob'); // el cierre usa esta rama
    const r = await fetch(`http://127.0.0.1:${port}/kill`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'pending:back-bob' }),
    });
    assert.equal(r.status, 200);
    assert.equal(existsSync(join(f.root, 'wt', 'back', 'bob')), false);
    assert.equal(execFileSync('git', ['-C', f.docker, 'branch', '--list', 'bob']).toString().trim(), '');
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('GET /projects expone la config (sin plantillas)', async () => {
  const f = infraSetup();
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const body = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
    assert.deepEqual(body.projects[0].envFiles, [{ repo: 'infra', path: '.env' }]);
    assert.equal(body.projects[0].related[0].name, 'infra');
    assert.equal(body.projects[0].related[0].exists, true);
    assert.doesNotMatch(JSON.stringify(body), /COMPOSE_PROJECT_NAME/);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/hooks-logic.test.js server/index.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: FAIL en los 6 tests nuevos.

- [ ] **Step 3: Implementar**

En `habitat/server/hooks-logic.js`, reemplazar el bloque de adopción:

```js
      const provId = `pending:${s.tmux || s.name}`;
      const prov = store.get(provId);
      if (payload.session_id !== provId && prov) {
        // La sesión real es un objeto nuevo: heredamos del provisional lo que armó /spawn
        // (puertos y carpeta de infra), que ningún hook vuelve a reportar.
        if (prov.infra && !s.infra) s.infra = prov.infra;
        store.remove(provId);
        removed = provId;
      }
```

En `habitat/server/index.js`:

1. Imports:
```js
import { worktreeAdd, worktreeRemove, validBranch, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch, resolveRepo, defaultExec } from './git.js';
import { createProjects, hasConfig } from './projects.js';
import { createEnvStore } from './env-store.js';
import { allocatePorts, usedPorts, probePort as defaultProbePort } from './ports.js';
import { prepareSession, teardownRelated } from './session-setup.js';
```
(reemplazan las líneas de import de `git.js` y `projects.js` existentes).

2. Firma de `createApp`: agregar `envStore = createEnvStore({ dir: config.ENVS_DIR }), probePort = defaultProbePort` a la lista de parámetros desestructurados, y en el cuerpo:
```js
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch, exec: defaultExec, ...gitOverrides };
  // Puertos asignados por un spawn en vuelo que todavía no está en el store: sin esto dos
  // spawns simultáneos podrían recibir el mismo puerto.
  const reservedPorts = new Set();
  async function allocateForSpawn(names) {
    const used = new Set([...usedPorts(store.all()), ...reservedPorts]);
    const r = await allocatePorts(names, { range: config.PORT_RANGE || [20000, 29999], used, probe: probePort });
    if (r.ok) for (const p of Object.values(r.ports)) reservedPorts.add(p);
    return r;
  }
```

3. `projectsForClient` (`exists` le permite a Settings marcar en rojo un relacionado que ya no está en disco; `validateConfig` lo descarta si vuelve en un PATCH):
```js
    return projects.list().map((p) => ({
      dir: p.dir, name: p.label, color: p.color, chars: p.chars,
      related: p.related.map((r) => ({ ...r, exists: existsSync(r.dir) })),
      infra: p.infra, envFiles: p.envFiles,
    }));
```

4. En `POST /spawn`, reemplazar desde `if (!ok) { res.writeHead(500).end(); return; }` hasta `announcePending(...)`:
```js
      if (!ok) { res.writeHead(500).end(); return; }
      const proj = projects.get(dir);
      let infra = null;
      // Extras de sesión (relacionados, .env, CLAUDE.local.md). No aplica a contenedores.
      if (!nested.length && hasConfig(proj)) {
        const r = await prepareSession({ project: proj, projectName, branch: name, wtPath: path, envStore, allocate: allocateForSpawn, git });
        if (!r.ok) {
          await git.worktreeRemove(dir, path, { force: true }); // todo o nada: recién creado, sin trabajo
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: r.error }));
          return;
        }
        infra = r.infra;
      }
      const releasePorts = () => { if (infra) for (const p of Object.values(infra.ports)) reservedPorts.delete(p); };
      if (!(await tmux.newTmuxSession(tmuxName, path, undefined, { permissionMode }))) { releasePorts(); res.writeHead(500).end(); return; }
      announcePending(tmuxName, { name, project: projectName, branch: name, char, ...(infra ? { infra } : {}) });
      releasePorts(); // ya están en el store (session.infra.ports)
```
(La línea original `if (!(await tmux.newTmuxSession(...)))` queda reemplazada por la nueva, y la original `announcePending(...)` también).

5. En `POST /kill`, dentro de `if (projectDir) {`, antes del loop de `nested`:
```js
          const proj = projects.get(projectDir);
          if (proj && proj.related.length) {
            // Rama con la que se crearon los relacionados (session.branch cambia con un checkout).
            const branch = (s.infra && s.infra.branch) || s.branch;
            await teardownRelated({ related: proj.related, branch, wtPath, git });
          }
```

6. En el arranque real, pasar `envStore` explícito no es necesario: el default usa `config.ENVS_DIR`. No hay cambios.

En `habitat/client/src/composables/useProjects.ts`, en `spawn`, reemplazar el cálculo de `error.value` por:

```ts
    if (res.ok) return true
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    error.value =
      data.error ? `no se pudo crear la sesión: ${data.error}`
      : res.status === 409 ? 'ya existe un personaje con ese nombre'
      : res.status === 400 ? 'nombre inválido'
      : res.status === 403 ? 'no permitido'
      : 'no se pudo crear la sesión'
    return false
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` y `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -2`
Expected: server en `fail 0`; cliente con todos los tests en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/hooks-logic.js habitat/server/hooks-logic.test.js habitat/server/index.test.js habitat/client/src/composables/useProjects.ts
git commit -m "feat(habitat): spawn y kill preparan y limpian relacionados, .env e infra de la sesión"
```

---

### Task 5: Endpoints de configuración y plantillas

**Files:**
- Modify: `habitat/server/index.js` (`PATCH /projects`, `DELETE /projects` y nuevos endpoints `/projects/env*`, junto a `dirWithinRoot` ~L570)
- Modify: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `projects.update` con configuración, `projects.get`, `envStore` y `scan` (Tasks 1, 2 y 4).
- Produces (HTTP):
  - `PATCH /projects` con body `{ dir, related?, infra?, envFiles?, ... }`. Responde 200 con el proyecto en formato `projectsForClient`, o 400 con `{ error }`.
  - `GET /projects/env?dir=&repo=&path=` → 200 `{ content }`, o 404 si (`repo`, `path`) no está en `envFiles`.
  - `PUT /projects/env` con body `{ dir, repo, path, content }` → 200, 400 `{ unknown }`, 404 o 413 si el contenido supera 256 KB.
  - `GET /projects/env/import?dir=&repo=&path=` → 200 `{ content }` o 404.
  - `DELETE /projects` borra también las plantillas del proyecto.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `habitat/server/index.test.js`. Usa `infraSetup` de la Task 4.

```js
const jsonReq = (port, method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { ...auth, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
});

test('PATCH /projects guarda config válida y rechaza relacionados fuera del root o no-repo', async () => {
  const f = infraSetup();
  const outside = mkdtempSync(join(tmpdir(), 'habitat-out-')); initRepoAt(outside);
  const notRepo = join(f.root, 'proyectos', 'plain'); mkdirSync(notRepo);
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const ok = await jsonReq(port, 'PATCH', '/projects', { dir: f.back, infra: { repo: 'self', path: 'docker', up: '', down: '' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).infra.path, 'docker');
    // dir relativo al root (lo que manda el navegador de carpetas) se resuelve en el server
    const relOk = await jsonReq(port, 'PATCH', '/projects', { dir: f.back, related: [{ dir: 'docker', name: 'infra' }] });
    assert.equal(relOk.status, 200);
    assert.equal((await relOk.json()).related[0].dir, f.docker);
    const out = await jsonReq(port, 'PATCH', '/projects', { dir: f.back, related: [{ dir: outside, name: 'x' }] });
    assert.equal(out.status, 400);
    assert.match((await out.json()).error, /fuera de la carpeta de proyectos/);
    const plain = await jsonReq(port, 'PATCH', '/projects', { dir: f.back, related: [{ dir: notRepo, name: 'x' }] });
    assert.equal(plain.status, 400);
    assert.match((await plain.json()).error, /no es un repo git/);
    const dangling = await jsonReq(port, 'PATCH', '/projects', { dir: f.back, related: [] });
    assert.equal(dangling.status, 400);
    assert.match((await dangling.json()).error, /referencias a relacionados inexistentes/);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('PATCH /projects quitar un envFile borra su plantilla', async () => {
  const f = infraSetup();
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    assert.equal((await jsonReq(port, 'PATCH', '/projects', { dir: f.back, envFiles: [] })).status, 200);
    assert.equal(f.envStore.get('back', 'infra', '.env'), '');
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('GET/PUT /projects/env leen y validan la plantilla', async () => {
  const f = infraSetup();
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const q = `dir=${encodeURIComponent(f.back)}&repo=infra&path=.env`;
    const g = await fetch(`http://127.0.0.1:${port}/projects/env?${q}`, { headers: auth });
    assert.match((await g.json()).content, /COMPOSE_PROJECT_NAME/);
    const bad = await jsonReq(port, 'PUT', '/projects/env', { dir: f.back, repo: 'infra', path: '.env', content: 'A={{path:front}}' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { unknown: ['{{path:front}}'] });
    const good = await jsonReq(port, 'PUT', '/projects/env', { dir: f.back, repo: 'infra', path: '.env', content: 'A={{path:infra}}' });
    assert.equal(good.status, 200);
    assert.equal(f.envStore.get('back', 'infra', '.env'), 'A={{path:infra}}');
    const missing = await jsonReq(port, 'PUT', '/projects/env', { dir: f.back, repo: 'self', path: '.env', content: 'x' });
    assert.equal(missing.status, 404); // (self, .env) no está en envFiles
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('GET /projects/env/import lee el .env del checkout y no se escapa del repo', async () => {
  const f = infraSetup();
  writeFileSync(join(f.docker, '.env'), 'REAL=1\n');
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/projects/env/import?dir=${encodeURIComponent(f.back)}`;
    const r = await fetch(`${base}&repo=infra&path=.env`, { headers: auth });
    assert.deepEqual(await r.json(), { content: 'REAL=1\n' });
    assert.equal((await fetch(`${base}&repo=infra&path=..%2Fback%2FREADME.md`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}&repo=self&path=.env`, { headers: auth })).status, 404);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('DELETE /projects borra las plantillas del proyecto', async () => {
  const f = infraSetup();
  const { server } = createApp({ config: f.cfg, store: createStore(), projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    assert.equal((await jsonReq(port, 'DELETE', '/projects', { dir: f.back })).status, 200);
    assert.equal(f.envStore.get('back', 'infra', '.env'), '');
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat && node --test server/index.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: FAIL en los 5 tests nuevos.

- [ ] **Step 3: Implementar**

En `habitat/server/index.js`, agregar `import { scan } from './env-template.js';`. Junto a `dirWithinRoot`, agregar los helpers:

```js
    const MAX_ENV_BYTES = 256 * 1024;
    const projectJson = (r) => ({
      dir: r.dir, name: r.label, color: r.color, chars: r.chars,
      related: r.related.map((x) => ({ ...x, exists: existsSync(x.dir) })), infra: r.infra, envFiles: r.envFiles,
    });
    const sendJson = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    // Dir del checkout principal de un repo del proyecto ('self' o un relacionado).
    const repoDirOf = (proj, repo) => (repo === 'self' ? proj.dir : (proj.related.find((r) => r.name === repo) || {}).dir);
    const hasEnvFile = (proj, repo, path) => proj.envFiles.some((e) => e.repo === repo && e.path === path);
```

Reemplazar el handler de `PATCH /projects` por:

```js
    if (req.method === 'PATCH' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      const before = projects.get(body.dir);
      if (!before) { res.writeHead(404).end(); return; }
      const touchesConfig = body.related !== undefined || body.infra !== undefined || body.envFiles !== undefined;
      if (touchesConfig) {
        if (Array.isArray(body.related)) {
          for (const r of body.related) {
            // El cliente manda rel (respecto de PROJECTS_ROOT) para los recién elegidos.
            if (r && typeof r.dir === 'string' && r.dir && !r.dir.startsWith(sep)) r.dir = resolve(config.PROJECTS_ROOT || '', r.dir);
            if (!r || typeof r.dir !== 'string' || !(await dirWithinRoot(r.dir))) { sendJson(400, { error: `relacionado ${r && r.name}: no existe o está fuera de la carpeta de proyectos` }); return; }
            if (!existsSync(join(r.dir, '.git'))) { sendJson(400, { error: `relacionado ${r.name}: no es un repo git` }); return; }
          }
        }
        if ((await git.findNestedRepos(body.dir)).length) { sendJson(400, { error: 'un proyecto contenedor no admite relacionados ni infra' }); return; }
      }
      const r = projects.update({
        dir: body.dir, label: body.label, color: body.color, chars: body.chars,
        related: body.related, infra: body.infra, envFiles: body.envFiles,
      });
      if (!r.ok) { sendJson(400, { error: r.error }); return; }
      // Plantillas de envFiles que dejaron de existir: se borran (tienen secretos).
      for (const e of before.envFiles) {
        if (!hasEnvFile(r.record, e.repo, e.path)) envStore.remove(basename(before.dir), e.repo, e.path);
      }
      broadcastProjects();
      sendJson(200, projectJson(r.record));
      return;
    }
```

En `DELETE /projects`, antes de `broadcastProjects();`, agregar `envStore.removeProject(basename(body.dir));`.

Endpoints nuevos, después del de `DELETE /projects`:

```js
    if (url.pathname === '/projects/env' || url.pathname === '/projects/env/import') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      const isImport = url.pathname === '/projects/env/import';
      const isPut = req.method === 'PUT' && !isImport;
      if (!isPut && req.method !== 'GET') { res.writeHead(405).end(); return; }
      let q;
      if (isPut) {
        let raw;
        try { raw = await readBody(req); } catch { res.writeHead(400).end(); return; }
        if (Buffer.byteLength(raw) > MAX_ENV_BYTES) { res.writeHead(413).end(); return; }
        try { q = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      } else {
        q = { dir: url.searchParams.get('dir'), repo: url.searchParams.get('repo'), path: url.searchParams.get('path') };
      }
      const proj = q && typeof q.dir === 'string' ? projects.get(q.dir) : null;
      if (!proj) { res.writeHead(404).end(); return; }
      const project = basename(proj.dir);
      if (isImport) {
        const repoDir = repoDirOf(proj, q.repo);
        if (!repoDir || typeof q.path !== 'string' || !q.path) { res.writeHead(404).end(); return; }
        const target = resolve(repoDir, q.path);
        if (!target.startsWith(repoDir + sep)) { res.writeHead(400).end(); return; }
        let realTarget, realRepo;
        try { realTarget = await realpath(target); realRepo = await realpath(repoDir); }
        catch { res.writeHead(404).end(); return; }
        if (!realTarget.startsWith(realRepo + sep)) { res.writeHead(400).end(); return; }
        try { sendJson(200, { content: await readFile(realTarget, 'utf8') }); }
        catch { res.writeHead(404).end(); }
        return;
      }
      if (!hasEnvFile(proj, q.repo, q.path)) { res.writeHead(404).end(); return; }
      if (!isPut) { sendJson(200, { content: envStore.get(project, q.repo, q.path) }); return; }
      if (typeof q.content !== 'string') { res.writeHead(400).end(); return; }
      const { unknown } = scan(q.content, ['self', ...proj.related.map((r) => r.name)]);
      if (unknown.length) { sendJson(400, { unknown }); return; }
      envStore.set(project, q.repo, q.path, q.content);
      res.writeHead(200).end();
      return;
    }
```

Antes de implementar, verificar que `readBody` no tenga un límite de tamaño menor a 256 KB. Si lo tiene, el 413 lo devolverá `readBody` como error y el `catch` responde 400: en ese caso ajustar el `catch` del PUT a `res.writeHead(413)`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoints de config de proyecto y plantillas .env"
```

---

### Task 6: Cliente, composable y tipos

**Files:**
- Modify: `habitat/client/src/types.ts`
- Modify: `habitat/client/src/composables/useProjects.ts`
- Create: `habitat/client/src/composables/useProjects.config.test.ts`

**Interfaces:**
- Consumes: los endpoints de la Task 5.
- Produces (TS):
  ```ts
  export interface RelatedRepo { dir: string; name: string }
  export interface InfraConfig { repo: string; path: string; up: string; down: string }
  export interface EnvFile { repo: string; path: string }
  // Project suma: related?: RelatedRepo[]; infra?: InfraConfig | null; envFiles?: EnvFile[]
  saveConfig(dir: string, cfg: { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] }): Promise<{ ok: true } | { ok: false; error: string }>
  getEnv(dir: string, repo: string, path: string): Promise<string | null>
  saveEnv(dir: string, repo: string, path: string, content: string): Promise<{ ok: true } | { ok: false; unknown?: string[]; error: string }>
  importEnv(dir: string, repo: string, path: string): Promise<string | null>
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/composables/useProjects.config.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useProjects } from './useProjects'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('useProjects: config e .env', () => {
  it('saveConfig manda PATCH con la config y propaga el error del server', async () => {
    let init: any = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, i: any) => { if (url === '/projects' && i?.method === 'PATCH') init = i; return resp(200, {}) }))
    const { saveConfig } = useProjects()
    const cfg = { related: [{ dir: '/r/d', name: 'infra' }], infra: null, envFiles: [] }
    expect(await saveConfig('/r/back', cfg)).toEqual({ ok: true })
    expect(JSON.parse(init.body)).toEqual({ dir: '/r/back', ...cfg })
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { error: 'relacionado x: no es un repo git' })))
    expect(await saveConfig('/r/back', cfg)).toEqual({ ok: false, error: 'relacionado x: no es un repo git' })
  })

  it('getEnv e importEnv arman la query y devuelven null si falla', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp(200, { content: 'A=1' }) }))
    const { getEnv, importEnv } = useProjects()
    expect(await getEnv('/r/back', 'infra', 'docker/.env')).toBe('A=1')
    expect(urls[0]).toBe('/projects/env?dir=%2Fr%2Fback&repo=infra&path=docker%2F.env')
    await importEnv('/r/back', 'self', '.env')
    expect(urls[1]).toBe('/projects/env/import?dir=%2Fr%2Fback&repo=self&path=.env')
    vi.stubGlobal('fetch', vi.fn(async () => resp(404)))
    expect(await importEnv('/r/back', 'self', '.env')).toBeNull()
  })

  it('saveEnv devuelve las variables desconocidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { unknown: ['{{x}}'] })))
    const { saveEnv } = useProjects()
    expect(await saveEnv('/r/back', 'self', '.env', 'A={{x}}')).toEqual({ ok: false, unknown: ['{{x}}'], error: 'variables desconocidas: {{x}}' })
    vi.stubGlobal('fetch', vi.fn(async () => resp(200)))
    expect(await saveEnv('/r/back', 'self', '.env', 'A=1')).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useProjects.config.test.ts`
Expected: FAIL, porque `saveConfig`/`getEnv`/`saveEnv`/`importEnv` no existen.

- [ ] **Step 3: Implementar**

En `habitat/client/src/types.ts`, antes de `export interface Project`:

```ts
export interface RelatedRepo { dir: string; name: string; exists?: boolean }
export interface InfraConfig { repo: string; path: string; up: string; down: string }
export interface EnvFile { repo: string; path: string }
```

y dentro de `Project` agregar:

```ts
  related?: RelatedRepo[]
  infra?: InfraConfig | null
  envFiles?: EnvFile[]
```

En `habitat/client/src/composables/useProjects.ts`, cambiar el import de tipos a `import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'` y agregar, antes de `function colorForProject`:

```ts
const envQuery = (dir: string, repo: string, path: string) =>
  `dir=${encodeURIComponent(dir)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`

async function saveConfig(dir: string, cfg: { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/projects', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ dir, ...cfg }) })
    if (res.ok) { await load(); return { ok: true } }
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: data.error || 'no se pudo guardar la configuración' }
  } catch {
    return { ok: false, error: 'no se pudo guardar la configuración' }
  }
}

// Plantilla guardada en Habitat. null si no se pudo leer.
async function getEnv(dir: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/projects/env?${envQuery(dir, repo, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return ((await res.json()) as { content: string }).content
  } catch {
    return null
  }
}

// .env real del checkout principal, como punto de partida de la plantilla.
async function importEnv(dir: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/projects/env/import?${envQuery(dir, repo, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return ((await res.json()) as { content: string }).content
  } catch {
    return null
  }
}

async function saveEnv(dir: string, repo: string, path: string, content: string): Promise<{ ok: true } | { ok: false; unknown?: string[]; error: string }> {
  try {
    const res = await fetch('/projects/env', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ dir, repo, path, content }) })
    if (res.ok) return { ok: true }
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { unknown?: string[] }
      if (data.unknown?.length) return { ok: false, unknown: data.unknown, error: `variables desconocidas: ${data.unknown.join(', ')}` }
    }
    return { ok: false, error: res.status === 413 ? 'la plantilla es demasiado grande' : 'no se pudo guardar la plantilla' }
  } catch {
    return { ok: false, error: 'no se pudo guardar la plantilla' }
  }
}
```

y sumar `saveConfig, getEnv, saveEnv, importEnv` al objeto que devuelve `useProjects()`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd habitat/client && npx vitest run src/composables/useProjects.config.test.ts && npm run build 2>&1 | tail -2`
Expected: PASS y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useProjects.ts habitat/client/src/composables/useProjects.config.test.ts
git commit -m "feat(habitat): composable para config de proyecto y plantillas .env"
```

---

### Task 7: UI `ProjectConfig.vue` en Settings

**Files:**
- Create: `habitat/client/src/components/ProjectConfig.vue`, `habitat/client/src/components/ProjectConfig.test.ts`
- Modify: `habitat/client/src/components/ProjectsManager.vue`

**Interfaces:**
- Consumes: `browse`, `saveConfig`, `getEnv`, `saveEnv`, `importEnv` y los tipos de la Task 6.
- Produces: `<ProjectConfig :project="p" @close="..." />`

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/components/ProjectConfig.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ProjectConfig from './ProjectConfig.vue'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const PROJECT = {
  dir: '/root/back', name: 'back', color: '#fff', chars: [],
  related: [{ dir: '/root/docker', name: 'infra' }],
  infra: { repo: 'infra', path: '', up: 'make up', down: '' },
  envFiles: [{ repo: 'infra', path: '.env' }],
}

function stub(calls: { url: string; method?: string; body?: any }[], over: Record<string, any> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined })
    for (const [k, v] of Object.entries(over)) if (url.startsWith(k)) return v
    if (url.startsWith('/projects/env/import')) return resp({ content: 'REAL=1' })
    if (url.startsWith('/projects/env')) return init?.method === 'PUT' ? resp({}) : resp({ content: 'A={{port:db}}' })
    if (url.startsWith('/projects/browse')) return resp({ root: 'proyectos', rel: '', breadcrumbs: [], entries: [
      { name: 'front', rel: 'front', isRepo: true, added: false }, { name: 'plain', rel: 'plain', isRepo: false, added: false }] })
    if (url === '/projects') return resp({ canSpawn: true, canManage: true, projects: [] })
    return resp({}, 404)
  }))
}

describe('ProjectConfig', () => {
  it('muestra la config actual y guarda los cambios de infra', async () => {
    const calls: any[] = []
    stub(calls)
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    expect(w.text()).toContain('infra')
    expect((w.get('[data-test="infra-repo"]').element as HTMLSelectElement).value).toBe('infra')
    await w.get('[data-test="infra-path"]').setValue('docker')
    await w.get('[data-test="save-config"]').trigger('click')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch.body).toEqual({
      dir: '/root/back', related: PROJECT.related,
      infra: { repo: 'infra', path: 'docker', up: 'make up', down: '' }, envFiles: PROJECT.envFiles,
    })
  })

  it('agrega un relacionado desde el navegador (sólo repos) con nombre = carpeta', async () => {
    const calls: any[] = []
    stub(calls)
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    await w.get('[data-test="related-add"]').trigger('click')
    await flushPromises()
    const picks = w.findAll('[data-test="related-pick"]')
    expect(picks).toHaveLength(2)
    expect(picks[1].attributes('disabled')).toBeDefined() // 'plain' no es repo
    await picks[0].trigger('click')
    expect(w.findAll('[data-test="related-row"]').map((r) => (r.get('input').element as HTMLInputElement).value)).toEqual(['infra', 'front'])
  })

  it('marca en rojo un relacionado que ya no existe', async () => {
    stub([])
    const w = mount(ProjectConfig, { props: { project: { ...PROJECT, related: [{ dir: '/root/docker', name: 'infra', exists: false }] } } })
    await flushPromises()
    expect(w.get('[data-test="related-row"]').classes()).toContain('missing')
  })

  it('edita una plantilla: carga, importa, guarda y muestra desconocidas', async () => {
    const calls: any[] = []
    stub(calls, { '/projects/env?': resp({ content: 'A={{port:db}}' }) })
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    await w.get('[data-test="env-open"]').trigger('click')
    await flushPromises()
    const ta = w.get('[data-test="env-text"]')
    expect((ta.element as HTMLTextAreaElement).value).toBe('A={{port:db}}')
    await w.get('[data-test="env-import"]').trigger('click')
    await flushPromises()
    expect((ta.element as HTMLTextAreaElement).value).toBe('REAL=1')
    stub(calls, { '/projects/env': resp({ unknown: ['{{x}}'] }, 400) })
    await w.get('[data-test="env-save"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('variables desconocidas: {{x}}')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/ProjectConfig.test.ts`
Expected: FAIL, porque no existe el componente.

- [ ] **Step 3: Implementar**

Crear `habitat/client/src/components/ProjectConfig.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects, type BrowseResult } from '../composables/useProjects'
import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()
const { browse, saveConfig, getEnv, saveEnv, importEnv } = useProjects()

// Borrador local: se manda entero al guardar (el server valida la config completa).
const related = ref<RelatedRepo[]>((props.project.related ?? []).map((r) => ({ ...r })))
const infraRepo = ref(props.project.infra?.repo ?? '')
const infraPath = ref(props.project.infra?.path ?? '')
const infraUp = ref(props.project.infra?.up ?? '')
const infraDown = ref(props.project.infra?.down ?? '')
const envFiles = ref<EnvFile[]>((props.project.envFiles ?? []).map((e) => ({ ...e })))
const saving = ref(false)
const configError = ref('')
const configOk = ref(false)

const repoOptions = computed(() => ['self', ...related.value.map((r) => r.name)])
const repoLabel = (r: string) => (r === 'self' ? 'este repo' : r)

function draft(): { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] } {
  return {
    related: related.value,
    infra: infraRepo.value ? { repo: infraRepo.value, path: infraPath.value, up: infraUp.value, down: infraDown.value } : null,
    envFiles: envFiles.value,
  }
}
async function save() {
  saving.value = true
  configError.value = ''
  configOk.value = false
  const r = await saveConfig(props.project.dir, draft())
  saving.value = false
  if (r.ok) configOk.value = true
  else configError.value = r.error
}

// --- relacionados: navegador de carpetas (sólo repos git) ---
const picking = ref(false)
const tree = ref<BrowseResult | null>(null)
async function openPicker() { picking.value = true; tree.value = await browse('') }
async function go(rel: string) { tree.value = await browse(rel) }
function pick(rel: string, name: string) {
  // browse devuelve rutas relativas a PROJECTS_ROOT; el server las resuelve al guardar.
  related.value.push({ dir: rel, name })
  picking.value = false
}
function removeRelated(i: number) { related.value.splice(i, 1) }

// --- archivos .env ---
const newEnvRepo = ref('self')
const newEnvPath = ref('.env')
function addEnvFile() {
  if (!newEnvPath.value.trim()) return
  envFiles.value.push({ repo: newEnvRepo.value, path: newEnvPath.value.trim() })
}
function removeEnvFile(i: number) { envFiles.value.splice(i, 1); if (editing.value === i) editing.value = null }

const editing = ref<number | null>(null)
const envText = ref('')
const envMsg = ref('')
const envErr = ref('')
async function openEnv(i: number) {
  editing.value = i
  envMsg.value = ''
  envErr.value = ''
  const e = envFiles.value[i]
  envText.value = (await getEnv(props.project.dir, e.repo, e.path)) ?? ''
}
async function doImport() {
  const e = envFiles.value[editing.value!]
  const c = await importEnv(props.project.dir, e.repo, e.path)
  if (c == null) envErr.value = 'no hay un .env en el checkout para importar'
  else { envText.value = c; envErr.value = ''; envMsg.value = 'importado (falta guardar)' }
}
async function doSaveEnv() {
  const e = envFiles.value[editing.value!]
  const r = await saveEnv(props.project.dir, e.repo, e.path, envText.value)
  envMsg.value = r.ok ? 'guardado' : ''
  envErr.value = r.ok ? '' : r.error
}
</script>

<template>
  <div class="pconfig">
    <h4>Repos relacionados</h4>
    <ul class="rows">
      <li v-for="(r, i) in related" :key="r.dir" class="row" :class="{ missing: r.exists === false }" data-test="related-row">
        <input v-model="r.name" class="name" />
        <span class="dir">{{ r.dir }}</span>
        <button class="btn small" @click="removeRelated(i)">quitar</button>
      </li>
    </ul>
    <button v-if="!picking" class="btn small" data-test="related-add" @click="openPicker">+ agregar</button>
    <div v-if="picking" class="picker">
      <div class="crumbs">
        <button class="crumb" @click="go('')">{{ tree?.root ?? 'root' }}</button>
        <template v-for="b in tree?.breadcrumbs ?? []" :key="b.rel">/<button class="crumb" @click="go(b.rel)">{{ b.name }}</button></template>
      </div>
      <ul class="rows">
        <li v-for="e in tree?.entries ?? []" :key="e.rel" class="row">
          <button class="enter" @click="go(e.rel)">📁 {{ e.name }}</button>
          <button class="btn small" data-test="related-pick" :disabled="!e.isRepo" @click="pick(e.rel, e.name)">elegir</button>
        </li>
      </ul>
      <button class="btn small" @click="picking = false">cancelar</button>
    </div>

    <h4>Infra docker</h4>
    <div class="grid">
      <label>Dónde está
        <select v-model="infraRepo" data-test="infra-repo">
          <option value="">ninguna</option>
          <option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option>
        </select>
      </label>
      <template v-if="infraRepo">
        <label>Subcarpeta <input v-model="infraPath" data-test="infra-path" placeholder="(raíz)" /></label>
        <label>Levantar <input v-model="infraUp" placeholder="docker compose up -d" /></label>
        <label>Bajar <input v-model="infraDown" placeholder="docker compose down" /></label>
      </template>
    </div>

    <h4>Archivos .env</h4>
    <ul class="rows">
      <li v-for="(e, i) in envFiles" :key="e.repo + e.path" class="row">
        <span class="dir">{{ repoLabel(e.repo) }} / {{ e.path }}</span>
        <button class="btn small" data-test="env-open" @click="openEnv(i)">editar</button>
        <button class="btn small" @click="removeEnvFile(i)">quitar</button>
      </li>
    </ul>
    <div class="row">
      <select v-model="newEnvRepo"><option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option></select>
      <input v-model="newEnvPath" placeholder=".env" />
      <button class="btn small" @click="addEnvFile">+ agregar</button>
    </div>
    <p class="hint">Guardá la configuración antes de editar un archivo nuevo.</p>

    <div v-if="editing !== null" class="editor">
      <textarea v-model="envText" data-test="env-text" spellcheck="false" rows="12"></textarea>
      <details class="help">
        <summary>Variables disponibles</summary>
        <ul>
          <li><code v-pre>{{stack}}</code>: nombre único del stack de la sesión</li>
          <li><code v-pre>{{port:NOMBRE}}</code>: un puerto libre por nombre (mismo nombre, mismo puerto)</li>
          <li><code v-pre>{{path:self}}</code> / <code v-pre>{{path:&lt;relacionado&gt;}}</code>: ruta del worktree</li>
          <li><code v-pre>{{branch}}</code>: rama de la sesión</li>
        </ul>
      </details>
      <div class="row">
        <button class="btn small" data-test="env-import" @click="doImport">importar del checkout</button>
        <button class="btn small" data-test="env-save" @click="doSaveEnv">guardar</button>
        <button class="btn small" @click="editing = null">cerrar</button>
      </div>
      <p class="ok" v-if="envMsg">{{ envMsg }}</p>
      <p class="err" v-if="envErr">{{ envErr }}</p>
    </div>

    <div class="actions">
      <button class="btn" data-test="save-config" :disabled="saving" @click="save">Guardar configuración</button>
      <button class="btn" @click="emit('close')">cerrar</button>
    </div>
    <p class="ok" v-if="configOk">configuración guardada</p>
    <p class="err" v-if="configError">{{ configError }}</p>
  </div>
</template>

<style scoped>
.pconfig { border: 2px solid var(--color-edge); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; margin: 6px 0 12px; }
.pconfig h4 { margin: 6px 0 0; font-family: var(--font-lore); font-size: 13px; }
.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.name { width: 120px; }
.row.missing .dir { color: var(--color-crimson); }
.row.missing .dir::after { content: ' (no existe)'; }
.dir { color: var(--color-dim); font-size: 11px; font-family: var(--font-machine); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
.grid label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
input, select, textarea { font: inherit; background: var(--color-bg); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 6px; padding: 4px 6px; }
textarea { width: 100%; box-sizing: border-box; font-family: var(--font-machine); font-size: 12px; }
.picker, .editor { border-top: 1px solid var(--color-edge); padding-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.crumb, .enter { background: transparent; border: none; color: var(--color-ink); cursor: pointer; }
.help { font-size: 12px; color: var(--color-dim); }
.hint { color: var(--color-dim); font-size: 11px; margin: 0; }
.ok { color: var(--color-brass); font-size: 12px; margin: 0; }
.err { color: var(--color-crimson); font-size: 12px; margin: 0; }
.actions { display: flex; gap: 6px; }
.btn { font: inherit; font-size: 13px; padding: 8px 12px; background: var(--color-surface-2); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 9px; cursor: pointer; }
.btn.small { font-size: 11px; padding: 4px 8px; }
.btn:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
.btn:disabled { opacity: .6; cursor: default; }
</style>
```

En `habitat/client/src/components/ProjectsManager.vue`:
- Importar `import ProjectConfig from './ProjectConfig.vue'` y agregar `const configuring = ref('')` (el dir del proyecto abierto).
- En cada `<li class="pitem">`, antes del botón "quitar", agregar `<button class="btn del" @click="configuring = configuring === p.dir ? '' : p.dir">configurar</button>`.
- Debajo del `</li>` del ítem, dentro del `v-for`, el `<li>` tiene que envolver también el panel. Convertir el `v-for` en `<template v-for="p in projects" :key="p.dir"><li class="pitem">…</li><li v-if="configuring === p.dir"><ProjectConfig :project="p" @close="configuring = ''" /></li></template>`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -2`
Expected: todos los tests en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/components/ProjectConfig.vue habitat/client/src/components/ProjectConfig.test.ts habitat/client/src/components/ProjectsManager.vue
git commit -m "feat(habitat): panel de configuración de relacionados, infra y .env por proyecto"
```

---

### Task 8: Documentación, E2E manual y PR 1

**Files:**
- Modify: `habitat/README.md` (sección "Crear sesiones desde el panel")

- [ ] **Step 1: Documentar**

Agregar al final de la sección "Crear sesiones desde el panel (opcional)" de `habitat/README.md`:

```markdown
### Infra docker y repos relacionados por sesión

En **Settings → Proyectos → configurar** cada proyecto puede definir:

- **Repos relacionados**: otros repos de `HABITAT_PROJECTS_ROOT` (p.ej. el repo de infra,
  el front). Cada sesión recibe un worktree de cada uno, en su misma rama, dentro de
  `.habitat-related/<nombre>/`. Al cerrar la sesión se remueven, y su rama se borra si no
  tiene commits.
- **Infra**: en qué repo y subcarpeta está el compose, y los comandos para levantarlo y
  bajarlo (default `docker compose up -d` / `docker compose down`).
- **Archivos `.env`**: plantillas que guarda Habitat (en `HABITAT_ENVS_DIR`, default
  `.habitat-envs/`, con permisos 0600) y que se escriben en cada sesión con estas
  variables: `{{stack}}` (nombre único del stack), `{{port:NOMBRE}}` (un puerto libre de
  `HABITAT_PORT_RANGE`, default `20000-29999`), `{{path:self}}` / `{{path:<relacionado>}}`
  y `{{branch}}`.

La sesión arranca con la infra apagada y un `CLAUDE.local.md` que le dice a Claude dónde
está, cómo levantarla y qué puertos tiene.

    export HABITAT_ENVS_DIR="/home/tu/.habitat-envs"   # opcional
    export HABITAT_PORT_RANGE="20000-29999"            # opcional
```

- [ ] **Step 2: Sincronizar y verificar**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
```
Expected: `fail 0`, todos los tests de vitest en verde y build OK. Resolver conflictos si aparecen.

- [ ] **Step 3: E2E manual en una instancia aparte** (no en producción; ver la memoria `habitat-prod-vs-worktree`)

1. `cd habitat/client && npm run build`.
2. `cd habitat && HABITAT_PORT=8399 HABITAT_ALLOW_SPAWN=1 HABITAT_TOKEN=e2e HABITAT_PROJECTS_ROOT=$HOME/dev/proyectos HABITAT_WORKTREES_DIR=/tmp/habitat-e2e-wt HABITAT_PROJECTS_STATE=/tmp/habitat-e2e-projects.json HABITAT_STATE=/tmp/habitat-e2e-state.json HABITAT_ENVS_DIR=/tmp/habitat-e2e-envs node server/index.js`
3. En `http://127.0.0.1:8399/?token=e2e` → Settings, agregar `ARTISANO-BackEnd` (o el back que esté en `~/dev/proyectos`), configurar `ArtisanoDockerEnv` como relacionado `infra` con infra en `infra` / `make up` / `make down`. Agregar el archivo `.env` del repo `infra`, importarlo del checkout y reemplazar `COMPOSE_PROJECT_NAME={{stack}}`, `APP_CODE_PATH_HOST={{path:self}}`, `APP_PORT={{port:app}}`, `APP_SSL_PORT={{port:ssl}}` y `DB_PORT={{port:db}}`. Guardar.
4. Crear dos sesiones. En cada worktree, verificar `.habitat-related/infra/.env` (con puertos distintos entre sesiones) y `CLAUDE.local.md`. Correr `make up` en ambas carpetas de infra y verificar con `docker ps` que conviven sin conflictos.
5. Cerrar ambas sesiones y verificar que no quedan containers (`docker ps -a`), que los worktrees se borraron y que la rama no está en `ArtisanoDockerEnv`.
6. Matar la instancia y borrar `/tmp/habitat-e2e-*`.

Si el paso 4 falla porque las imágenes del compose usan `container_name`/`image` fijos, revisar que la plantilla use `{{stack}}` donde corresponde, y anotarlo en el PR.

- [ ] **Step 4: Commit, push y PR**

```bash
git add habitat/README.md
git commit -m "docs(habitat): infra docker y repos relacionados por sesión"
git push -u origin feat/habitat-infra-por-sesion
gh pr create --base main --head feat/habitat-infra-por-sesion --title "feat(habitat): infra docker, .env y repos relacionados por sesión (1/2)" --body "<resumen + testing + E2E; terminar con la línea de atribución de Claude Code>"
```

Si el PR #72 (clonar repos) todavía no está mergeado, aclararlo en el cuerpo del PR, porque esta branch lo incluye.

---

# PR 2: infra en vivo

Branch: `git checkout -b feat/habitat-infra-en-vivo` desde `feat/habitat-infra-por-sesion`, una vez abierto el PR 1.

### Task 9: Estado de containers en `docker.js` y `runInfraCommand`

**Files:**
- Modify: `habitat/server/docker.js`, `habitat/server/docker.test.js`
- Modify: `habitat/server/infra.js`
- Create: `habitat/server/infra.test.js`

**Interfaces:**
- Produces:
  - `STATE_FORMAT` (string)
  - `containerStates(exec?): Promise<{ dir: string, state: string }[]>`, o `[]` sin docker.
  - `stateForDir(containers, dir): 'up' | 'partial' | 'off'`
  - `UP_TIMEOUT_MS = 15 * 60_000`
  - `runInfraCommand(cmd: string, cwd: string, exec?): Promise<{ ok: true } | { ok: false, message: string }>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `habitat/server/docker.test.js`. Ajustar el import para incluir `containerStates, stateForDir, STATE_FORMAT`.

```js
test('containerStates parsea working_dir y estado; sin docker devuelve []', async () => {
  let args;
  const exec = async (f, a) => { args = a; return '/wt/a/infra\trunning\n/wt/a/infra\texited\n\trunning\n/otro\trunning\n'; };
  const r = await containerStates(exec);
  assert.deepEqual(args, ['ps', '-a', '--format', STATE_FORMAT]);
  assert.deepEqual(r, [{ dir: '/wt/a/infra', state: 'running' }, { dir: '/wt/a/infra', state: 'exited' }, { dir: '/otro', state: 'running' }]);
  assert.deepEqual(await containerStates(async () => { throw new Error('no docker'); }), []);
});

test('stateForDir: up, partial u off según los containers dentro de dir', () => {
  const cs = [{ dir: '/wt/a/infra', state: 'running' }, { dir: '/wt/a/infra/sub', state: 'running' }, { dir: '/wt/b/infra', state: 'exited' }, { dir: '/wt/b/infra', state: 'running' }];
  assert.equal(stateForDir(cs, '/wt/a/infra'), 'up');
  assert.equal(stateForDir(cs, '/wt/b/infra'), 'partial');
  assert.equal(stateForDir(cs, '/wt/c'), 'off');
  assert.equal(stateForDir(cs, '/wt/a/inf'), 'off'); // contención por segmento
});
```

Crear `habitat/server/infra.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInfraCommand, UP_TIMEOUT_MS } from './infra.js';

test('runInfraCommand corre sh -c en cwd con timeout largo', async () => {
  let call;
  const exec = async (file, args, opts) => { call = { file, args, opts }; return ''; };
  assert.deepEqual(await runInfraCommand('make up', '/wt/x', exec), { ok: true });
  assert.equal(call.file, 'sh');
  assert.deepEqual(call.args, ['-c', 'make up']);
  assert.equal(call.opts.cwd, '/wt/x');
  assert.equal(call.opts.timeout, UP_TIMEOUT_MS);
  assert.ok(call.opts.maxBuffer >= 16 * 1024 * 1024);
});

test('runInfraCommand devuelve el error recortado', async () => {
  const exec = async () => { const e = new Error('x'); e.stderr = 'Error: port is already allocated'; throw e; };
  const r = await runInfraCommand('make up', '/wt/x', exec);
  assert.equal(r.ok, false);
  assert.match(r.message, /port is already allocated/);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat && node --test server/docker.test.js server/infra.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `habitat/server/docker.js`, al final:

```js
// working_dir de compose + estado de cada container (running, exited, restarting…).
export const STATE_FORMAT = '{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}';

// Todos los containers de compose con su working_dir. Best-effort: sin docker, [].
export async function containerStates(exec = defaultExec) {
  let out;
  try {
    out = await exec('docker', ['ps', '-a', '--format', STATE_FORMAT]);
  } catch {
    return [];
  }
  const list = [];
  for (const line of String(out).split('\n')) {
    const [dir, state] = line.split('\t');
    const d = norm(dir);
    if (!d) continue;
    list.push({ dir: d, state: (state || '').trim() });
  }
  return list;
}

// Estado del stack levantado dentro de `dir` (la carpeta de infra de una sesión): mismo
// criterio por working_dir que la limpieza, así no depende del nombre de proyecto.
export function stateForDir(containers, dir) {
  const mine = containers.filter((c) => inside(c.dir, dir));
  if (!mine.length) return 'off';
  return mine.every((c) => c.state === 'running') ? 'up' : 'partial';
}
```

En `habitat/server/infra.js`, agregar:

```js
import { defaultExec } from './git.js';
import { trimErr } from './git-write.js';

// Un `up` con build puede tardar varios minutos; corre con el lock de la sesión tomado.
export const UP_TIMEOUT_MS = 15 * 60_000;

// Comando de shell libre del proyecto (lo define el usuario autenticado en Settings, mismo
// modelo de confianza que el spawn). maxBuffer amplio: la salida de un build es larga.
export async function runInfraCommand(cmd, cwd, exec = defaultExec) {
  try {
    await exec('sh', ['-c', cmd], { cwd, timeout: UP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: trimErr(e) };
  }
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && node --test server/docker.test.js server/infra.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add habitat/server/docker.js habitat/server/docker.test.js habitat/server/infra.js habitat/server/infra.test.js
git commit -m "feat(habitat): estado de containers por carpeta y runner de comandos de infra"
```

---

### Task 10: Poller y `POST /infra/up`

**Files:**
- Modify: `habitat/server/index.js` (firma de `createApp`, nuevo `pollInfra`, endpoint `/infra/up`, valor devuelto y arranque)
- Modify: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `containerStates`, `stateForDir`, `runInfraCommand` y `DEFAULT_UP` (Task 9 y Task 3).
- Produces:
  - `createApp({ ..., docker: dockerOverrides = {}, infra: infraOverrides = {} })`. Se fusionan con `{ downForDir, downOrphans, containerStates }` y `{ runInfraCommand }`.
  - `createApp` devuelve además `pollInfra(): Promise<void>`.
  - `session.infra.state: 'up' | 'partial' | 'off'`, broadcasteado como `{ type: 'session' }` cuando cambia.
  - `POST /infra/up?id=` → 200 `{ ok, message? }`, 404 o 409.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `habitat/server/index.test.js`:

```js
test('pollInfra actualiza infra.state y broadcastea sólo los cambios', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'bob', infra: { stack: 'b', ports: {}, dir: '/wt/back/bob/.habitat-related/infra', branch: 'bob' } }));
  store.upsert(newSession('s2', { name: 'ana' })); // sin infra: se ignora
  let containers = [{ dir: '/wt/back/bob/.habitat-related/infra', state: 'running' }];
  const docker = { containerStates: async () => containers };
  const { server, pollInfra } = createApp({ config: spawnConfig(), store, docker });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); });
  const msgs = [];
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'session') msgs.push(m.session); });
  try {
    await pollInfra();
    await pollInfra(); // sin cambios: no re-broadcastea
    containers = [{ dir: '/wt/back/bob/.habitat-related/infra', state: 'exited' }, { dir: '/wt/back/bob/.habitat-related/infra', state: 'running' }];
    await pollInfra();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(msgs.map((s) => [s.id, s.infra.state]), [['s1', 'up'], ['s1', 'partial']]);
    assert.equal(store.get('s1').infra.state, 'partial');
  } finally { ws.close(); server.close(); }
});

test('POST /infra/up corre el comando del proyecto en la carpeta de infra, con lock', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'bob', project: 'proj-api', infra: { stack: 'b', ports: {}, dir: '/wt/infra', branch: 'bob' } }));
  const projectsStore = createProjects({ seed: ['/home/u/proj-api'] });
  projectsStore.update({ dir: '/home/u/proj-api', infra: { repo: 'self', path: '', up: 'make up', down: '' } });
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const infra = { runInfraCommand: async (cmd, cwd) => { calls.push([cmd, cwd]); await gate; return { ok: true }; } };
  const { server } = createApp({ config: spawnConfig(), store, projectsStore, infra, docker: { containerStates: async () => [] } });
  try {
    const port = await listen(server);
    const up = () => fetch(`http://127.0.0.1:${port}/infra/up?id=s1`, { method: 'POST', headers: auth });
    const first = up();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await up()).status, 409);
    release();
    const r = await first;
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(calls, [['make up', '/wt/infra']]);
    assert.equal((await fetch(`http://127.0.0.1:${port}/infra/up?id=nope`, { method: 'POST', headers: auth })).status, 404);
  } finally { server.close(); }
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat && node --test server/index.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: FAIL en los 2 tests nuevos.

- [ ] **Step 3: Implementar**

En `habitat/server/index.js`:

1. Imports: `import { downForDir, downOrphans, containerStates, stateForDir } from './docker.js';` y `import { DEFAULT_UP, runInfraCommand } from './infra.js';`.
2. En la firma de `createApp`, reemplazar `docker = { downForDir, downOrphans }` por `docker: dockerOverrides = {}, infra: infraOverrides = {}`, y en el cuerpo:
```js
  const docker = { downForDir, downOrphans, containerStates, ...dockerOverrides };
  const infraRunner = { runInfraCommand, ...infraOverrides };
```
3. Después de `broadcastProjects`, agregar:
```js
  // Estado de la infra de cada sesión. Claude puede levantarla/bajarla desde su terminal,
  // así que no alcanza con las acciones de la UI: se consulta docker periódicamente (una
  // sola llamada para todas las sesiones) y se broadcastea sólo lo que cambió.
  async function pollInfra() {
    const sessions = store.all().filter((s) => s.infra && s.infra.dir);
    if (!sessions.length) return;
    const containers = await docker.containerStates();
    let changed = false;
    for (const s of sessions) {
      const state = stateForDir(containers, s.infra.dir);
      if (s.infra.state === state) continue;
      s.infra.state = state; // misma referencia: no pisamos campos escritos por hooks en vuelo
      changed = true;
      if (hub) hub.broadcast({ type: 'session', session: snapOf(s) });
    }
    if (changed) store.persist();
  }
```
4. Endpoint, junto a `/docker/status`:
```js
    if (req.method === 'POST' && url.pathname === '/infra/up') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      const id = url.searchParams.get('id') || '';
      const s = store.get(id);
      if (!s || !s.infra || !s.infra.dir) { res.writeHead(404).end(); return; }
      const proj = projects.list().find((p) => basename(p.dir) === s.project);
      const cmd = (proj && proj.infra && proj.infra.up) || DEFAULT_UP;
      let r;
      try {
        r = await locks.run(`infra:${id}`, () => infraRunner.runInfraCommand(cmd, s.infra.dir));
      } catch (e) {
        res.writeHead(e && e.message === 'busy' ? 409 : 500).end();
        return;
      }
      await pollInfra().catch(() => {}); // refleja el estado nuevo sin esperar el próximo tick
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      return;
    }
```
5. Cambiar el `return` de `createApp` a `return { server, get hub() { return hub; }, pollInfra };`.
6. En el arranque real, cambiar a `const { server, pollInfra } = createApp(...)` y agregar después del `server.listen`:
```js
  if (config.ALLOW_SPAWN) {
    setInterval(() => { pollInfra().catch((err) => console.error('[habitat] poll de infra falló (ignorado):', err && err.message)); }, 15_000).unref();
  }
```

Verificar que los tests existentes que pasan `docker: { downForDir, downOrphans }` sigan funcionando, porque la fusión los conserva.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): poller del estado de infra por sesión y endpoint para levantarla"
```

---

### Task 11: UI de infra en la card y en el panel de detalle

**Files:**
- Modify: `habitat/client/src/types.ts`, `habitat/client/src/composables/useProjects.ts`
- Create: `habitat/client/src/components/InfraBlock.vue`, `habitat/client/src/components/InfraBlock.test.ts`
- Modify: `habitat/client/src/components/SessionPod.vue`, `habitat/client/src/components/DetailPanel.vue`

**Interfaces:**
- Consumes: `POST /infra/up?id=`, el `POST /docker/down` existente y `session.infra` por WebSocket.
- Produces:
  - `Session.infra?: SessionInfra`, donde `SessionInfra = { stack: string; ports: Record<string, number>; dir: string | null; branch: string; state?: 'up' | 'partial' | 'off' }`
  - `infraUp(id: string): Promise<{ ok: true } | { ok: false; message: string }>`
  - `<InfraBlock :session="s" />`

- [ ] **Step 1: Escribir el test que falla**

Crear `habitat/client/src/components/InfraBlock.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import InfraBlock from './InfraBlock.vue'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const session = (state?: string) => ({
  id: 's1', name: 'bob', project: 'back', branch: 'bob', status: 'idle', action: '', since: 0, stamina: 100,
  infra: { stack: 'back-bob', ports: { app: 20003, db: 20004 }, dir: '/wt/infra', branch: 'bob', state },
}) as any

describe('InfraBlock', () => {
  it('muestra estado, stack y puertos como links al host actual', () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({})))
    const w = mount(InfraBlock, { props: { session: session('partial') } })
    expect(w.text()).toContain('back-bob')
    expect(w.get('[data-test="infra-state"]').text()).toBe('parcial')
    const links = w.findAll('a')
    expect(links.map((a) => a.text())).toEqual(['app :20003', 'db :20004'])
    expect(links[0].attributes('href')).toBe(`http://${location.hostname}:20003`)
    expect(links[0].attributes('target')).toBe('_blank')
  })

  it('sin estado muestra apagado; levantar llama al endpoint y muestra el error', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp({ ok: false, message: 'port is already allocated' }) }))
    const w = mount(InfraBlock, { props: { session: session() } })
    expect(w.get('[data-test="infra-state"]').text()).toBe('apagado')
    await w.get('[data-test="infra-up"]').trigger('click')
    await flushPromises()
    expect(urls).toContain('/infra/up?id=s1')
    expect(w.text()).toContain('port is already allocated')
  })

  it('bajar llama a /docker/down', async () => {
    const calls: { url: string; body?: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: any) => { calls.push({ url: u, body: i?.body && JSON.parse(i.body) }); return resp({ stacks: ['x'] }) }))
    const w = mount(InfraBlock, { props: { session: session('up') } })
    await w.get('[data-test="infra-down"]').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.url === '/docker/down')?.body).toEqual({ id: 's1' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/InfraBlock.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `habitat/client/src/types.ts`, antes de `export interface Session`:

```ts
export interface SessionInfra {
  stack: string
  ports: Record<string, number>
  dir: string | null
  branch: string
  state?: 'up' | 'partial' | 'off'
}
```

y en `Session` agregar `infra?: SessionInfra`.

En `habitat/client/src/composables/useProjects.ts`, agregar y exportar en el objeto de `useProjects()`:

```ts
// Levanta la infra de la sesión (puede tardar minutos si hay build).
async function infraUp(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/infra/up?id=${encodeURIComponent(id)}`, { method: 'POST', headers: authHeaders() })
    if (res.status === 409) return { ok: false, message: 'ocupado: ya se está levantando' }
    if (!res.ok) return { ok: false, message: 'no se pudo levantar la infra' }
    const data = (await res.json()) as { ok: boolean; message?: string }
    return data.ok ? { ok: true } : { ok: false, message: data.message || 'no se pudo levantar la infra' }
  } catch {
    return { ok: false, message: 'no se pudo levantar la infra' }
  }
}
```

Crear `habitat/client/src/components/InfraBlock.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import type { Session } from '../types'

const props = defineProps<{ session: Session }>()
const { infraUp, dockerDown } = useProjects()

const LABEL = { up: 'arriba', partial: 'parcial', off: 'apagado' } as const
const state = computed(() => props.session.infra?.state ?? 'off')
const ports = computed(() => Object.entries(props.session.infra?.ports ?? {}))
const busy = ref<'' | 'up' | 'down'>('')
const error = ref('')
// `location` no está en el scope del template; las variables top-level de script setup sí.
const location = window.location

async function up() {
  busy.value = 'up'
  error.value = ''
  const r = await infraUp(props.session.id)
  busy.value = ''
  if (!r.ok) error.value = r.message
}
async function down() {
  if (!confirm('¿Bajar la infra de esta sesión? Los volúmenes con datos quedan.')) return
  busy.value = 'down'
  error.value = ''
  await dockerDown(props.session.id)
  busy.value = ''
}
</script>

<template>
  <div class="infra">
    <div class="head">
      <span class="dot" :class="state"></span>
      <b>Infra</b>
      <span data-test="infra-state" class="state">{{ LABEL[state] }}</span>
      <span class="stack">{{ session.infra?.stack }}</span>
    </div>
    <div class="ports" v-if="ports.length">
      <a v-for="[name, p] in ports" :key="name" :href="`http://${location.hostname}:${p}`" target="_blank" rel="noopener">{{ name }} :{{ p }}</a>
    </div>
    <div class="actions">
      <button class="tool" data-test="infra-up" :disabled="!!busy" @click="up">{{ busy === 'up' ? 'Levantando…' : 'Levantar' }}</button>
      <button class="tool" data-test="infra-down" :disabled="!!busy || state === 'off'" @click="down">{{ busy === 'down' ? 'Bajando…' : 'Bajar' }}</button>
    </div>
    <p class="err" v-if="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.infra { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--color-edge); border-radius: 10px; background: var(--color-surface-2); }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.state { color: var(--color-dim); font-size: 12px; }
.stack { color: var(--color-dim); font-size: 11px; font-family: var(--font-machine); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-dim); }
.dot.up { background: #4caf50; }
.dot.partial { background: var(--color-brass); }
.ports { display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--font-machine); font-size: 12px; }
.ports a { color: var(--color-brass); }
.actions { display: flex; gap: 6px; }
.tool { font: inherit; font-size: 12px; padding: 6px 10px; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 8px; cursor: pointer; }
.tool:disabled { opacity: .6; cursor: default; }
.err { color: var(--color-crimson); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
</style>
```

En `habitat/client/src/components/DetailPanel.vue`:
- Importar `InfraBlock`.
- Cambiar el `v-if` del botón "Bajar docker" a `v-if="canSpawn && dockerStacks.length && !store.selected.infra?.dir"`.
- Debajo del `<div class="dhead">…</div>`, el contenedor de `portrait`/`dinfo`/`dtools`, agregar `<InfraBlock v-if="canSpawn && store.selected.infra?.dir" :session="store.selected" class="dinfra" />`. Revisar el nombre real del contenedor leyendo el template: el bloque va inmediatamente después del cierre de la fila de cabecera y antes de `<div class="term"`.

En `habitat/client/src/components/SessionPod.vue`, dentro de ambos `<div class="name">` (compacto y normal), al final:

```vue
<span v-if="session.infra?.dir" class="infra-dot" :class="session.infra.state ?? 'off'" :title="`infra: ${session.infra.state ?? 'off'}`"></span>
```

y en el `<style scoped>`:

```css
.infra-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; vertical-align: middle; background: var(--color-dim); }
.infra-dot.up { background: #4caf50; }
.infra-dot.partial { background: var(--color-brass); }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -2`
Expected: todos los tests en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src/types.ts habitat/client/src/composables/useProjects.ts habitat/client/src/components/InfraBlock.vue habitat/client/src/components/InfraBlock.test.ts habitat/client/src/components/SessionPod.vue habitat/client/src/components/DetailPanel.vue
git commit -m "feat(habitat): estado de la infra en la card y bloque para levantarla/bajarla"
```

---

### Task 12: E2E y PR 2

- [ ] **Step 1: Sincronizar y verificar**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
```

- [ ] **Step 2: E2E manual** (instancia aparte, mismo comando que en la Task 8)

1. Crear una sesión del proyecto configurado. La card muestra el punto gris (`apagado`).
2. En el panel de detalle, presionar "Levantar": el botón queda en "Levantando…" y en menos de 15 s el punto pasa a verde. Los links de puertos abren la app.
3. `docker stop` de un container del stack: en menos de 15 s el estado pasa a `parcial`.
4. "Bajar": vuelve a `apagado`.
5. Pedirle a Claude, en la terminal de la sesión, que levante la infra según `CLAUDE.local.md`. El estado se actualiza solo.
6. Cerrar la sesión y limpiar `/tmp/habitat-e2e-*`.

Para las capturas, usar el procedimiento de la memoria `habitat-headless-screenshots`.

- [ ] **Step 3: Push y PR**

```bash
git push -u origin feat/habitat-infra-en-vivo
gh pr create --base main --head feat/habitat-infra-en-vivo --title "feat(habitat): estado y control de la infra por sesión (2/2)" --body "<resumen + testing + E2E; depende del PR 1; terminar con la línea de atribución de Claude Code>"
```

Si el PR 1 no está mergeado, usar `--base feat/habitat-infra-por-sesion` y aclararlo en el cuerpo.
