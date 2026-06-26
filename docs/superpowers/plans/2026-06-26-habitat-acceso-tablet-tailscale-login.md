# Acceso a Hábitat desde tablet: login con sesión (Tailscale Serve) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el token-en-URL del navegador por login usuario+contraseña con sesión por cookie HttpOnly, manteniendo el `HABITAT_TOKEN` como Bearer para hooks/statusline y `?token=` como fallback. El acceso de red (Tailscale Serve) es ops y se documenta, no es código.

**Architecture:** Tres módulos nuevos en `server/` (`password.js`, `sessions.js`, `auth.js`) + endpoints `/login`, `/logout`, `/auth/me` en `index.js`. `authorize()`, `ws.js` y `term.js` pasan a aceptar la cookie de sesión vía un helper común `isAuthenticated`. En el cliente, una vista de Login que se muestra cuando `/auth/me` da 401. La cookie viaja sola en fetch y en el upgrade WebSocket (mismo origen), por eso no hay token en la URL.

**Tech Stack:** Node puro (`node:crypto` scrypt, `node:test`), Vue 3 + TS (Vite). Sin dependencias nuevas.

## Global Constraints

- **Sin dependencias npm nuevas** — usar `node:crypto` para scrypt y `timingSafeEqual`.
- **Login es opt-in**: si `HABITAT_USER` o `HABITAT_PASSWORD_HASH` están vacíos, el login está deshabilitado y el comportamiento es el actual (solo token). No romper deploys sin credenciales.
- **`HABITAT_TOKEN` sigue válido** como `Authorization: Bearer` (hooks, statusline) y `?token=` sigue como fallback de navegador.
- **Sesión: 1 día (`86_400_000` ms) con renovación deslizante** — cada request autenticado por cookie empuja `expiresAt = now + TTL`.
- **Persistir sesiones a disco** con escritura atómica (patrón de `settings.js`/`state.js`), para sobrevivir reinicios (`KillMode=process`).
- Tests con `node --test`, en español, siguiendo el estilo de `settings.test.js` / `index.test.js`.
- Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`. `Secure` configurable vía `HABITAT_COOKIE_SECURE` (default `true`) para permitir pruebas en http plano.

---

### Task 1: Hashing de contraseña (`server/password.js`) + CLI

**Files:**
- Create: `habitat/server/password.js`
- Create: `habitat/server/password.test.js`
- Create: `habitat/server/scripts/hash-password.js`
- Modify: `habitat/package.json` (script `hash-password`)

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): string` → formato `scrypt$16384$<saltB64url>$<hashB64url>` (N=16384, keylen=32, salt 16B).
  - `verifyPassword(plain: string, stored: string): boolean` → compara con `timingSafeEqual`; `false` si el formato es inválido o no matchea.

- [ ] **Step 1: Write the failing test**

```js
// habitat/server/password.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword produce formato scrypt$N$salt$hash', () => {
  const h = hashPassword('secreta');
  const parts = h.split('$');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '16384');
  assert.ok(parts[2].length > 0 && parts[3].length > 0);
});

test('verifyPassword acepta la contraseña correcta', () => {
  const h = hashPassword('correcta');
  assert.equal(verifyPassword('correcta', h), true);
});

test('verifyPassword rechaza la contraseña incorrecta', () => {
  const h = hashPassword('correcta');
  assert.equal(verifyPassword('incorrecta', h), false);
});

test('dos hashes de la misma contraseña difieren (salt aleatorio)', () => {
  assert.notEqual(hashPassword('x'), hashPassword('x'));
});

test('verifyPassword con formato inválido devuelve false sin tirar', () => {
  assert.equal(verifyPassword('x', 'no-es-un-hash'), false);
  assert.equal(verifyPassword('x', ''), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/server && node --test password.test.js`
Expected: FAIL — `Cannot find module './password.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// habitat/server/password.js
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;      // costo CPU/memoria de scrypt
const KEYLEN = 32;
const SALT_BYTES = 16;

// Formato serializado: scrypt$<N>$<saltBase64url>$<hashBase64url>
export function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(String(plain), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, nStr, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(String(plain), salt, expected.length, { N: Number(nStr) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/server && node --test password.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the CLI script**

```js
// habitat/server/scripts/hash-password.js
// Lee la contraseña por stdin (sin eco) y emite la línea HABITAT_PASSWORD_HASH=...
import { hashPassword } from '../password.js';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// Sin eco: ocultamos lo tipeado sobreescribiendo la salida del prompt.
rl._writeToOutput = (s) => { if (s.includes('\n')) rl.output.write('\n'); };
process.stdout.write('Contraseña: ');
rl.question('', (pw) => {
  rl.close();
  if (!pw) { console.error('contraseña vacía'); process.exit(1); }
  process.stdout.write(`\nHABITAT_PASSWORD_HASH=${hashPassword(pw)}\n`);
});
```

- [ ] **Step 6: Add npm script**

En `habitat/package.json`, dentro de `"scripts"`, agregar:

```json
"hash-password": "node server/scripts/hash-password.js"
```

- [ ] **Step 7: Smoke-test the CLI**

Run: `cd habitat && printf 'miclave\n' | npm run --silent hash-password`
Expected: imprime una línea `HABITAT_PASSWORD_HASH=scrypt$16384$...$...`.

- [ ] **Step 8: Commit**

```bash
git add habitat/server/password.js habitat/server/password.test.js habitat/server/scripts/hash-password.js habitat/package.json
git commit -m "feat(habitat): hashing scrypt de contraseña + CLI hash-password"
```

---

### Task 2: Store de sesiones (`server/sessions.js`)

**Files:**
- Create: `habitat/server/sessions.js`
- Create: `habitat/server/sessions.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `createSessionStore({ persistPath?, ttlMs?, now? })` con:
  - `create(user: string): string` → genera un `sessionId` (32B base64url), lo guarda con `expiresAt = now()+ttl`, persiste, devuelve el id.
  - `validate(id: string): { user } | null` → `null` si no existe o expiró (y la borra); si vale, **renueva** `expiresAt` y devuelve `{ user }`.
  - `destroy(id: string): void` → borra y persiste.
  - `ttlMs: number` (la constante efectiva, default `86_400_000`).
  - `now` inyectable para tests (default `Date.now`).

- [ ] **Step 1: Write the failing test**

```js
// habitat/server/sessions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { createSessionStore } from './sessions.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-sessions-${process.pid}-${tag}.json`);

test('create devuelve un id y validate lo acepta', () => {
  const s = createSessionStore({ ttlMs: 1000, now: () => 0 });
  const id = s.create('nico');
  assert.ok(typeof id === 'string' && id.length >= 16);
  assert.deepEqual(s.validate(id), { user: 'nico' });
});

test('validate de id inexistente devuelve null', () => {
  const s = createSessionStore({ now: () => 0 });
  assert.equal(s.validate('nope'), null);
});

test('sesión expirada devuelve null', () => {
  let t = 0;
  const s = createSessionStore({ ttlMs: 100, now: () => t });
  const id = s.create('nico');
  t = 101;
  assert.equal(s.validate(id), null);
});

test('validate renueva la expiración (sliding)', () => {
  let t = 0;
  const s = createSessionStore({ ttlMs: 100, now: () => t });
  const id = s.create('nico');
  t = 80; assert.deepEqual(s.validate(id), { user: 'nico' }); // renueva a 180
  t = 150; assert.deepEqual(s.validate(id), { user: 'nico' }); // seguiría viva
});

test('destroy invalida la sesión', () => {
  const s = createSessionStore({ now: () => 0 });
  const id = s.create('nico');
  s.destroy(id);
  assert.equal(s.validate(id), null);
});

test('persistencia: un store nuevo recarga las sesiones del disco', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createSessionStore({ persistPath: path, ttlMs: 100000, now: () => 0 });
    const id = a.create('nico');
    assert.ok(existsSync(path));
    const b = createSessionStore({ persistPath: path, ttlMs: 100000, now: () => 0 });
    assert.deepEqual(b.validate(id), { user: 'nico' });
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca vacío sin tirar', () => {
  const path = tmpPath('corrupt');
  rmSync(path, { force: true });
  writeFileSync(path, '{ no json');
  try {
    const s = createSessionStore({ persistPath: path, now: () => 0 });
    assert.equal(s.validate('x'), null);
  } finally {
    rmSync(path, { force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/server && node --test sessions.test.js`
Expected: FAIL — `Cannot find module './sessions.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// habitat/server/sessions.js
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DEFAULT_TTL = 86_400_000; // 1 día

// Store de sesiones de login, respaldado en disco con escritura atómica (igual que
// settings.js/state.js) para sobrevivir reinicios del server (KillMode=process).
export function createSessionStore({ persistPath, ttlMs = DEFAULT_TTL, now = Date.now } = {}) {
  // id -> { user, expiresAt }
  const sessions = new Map();

  if (persistPath) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      const t = now();
      for (const [id, v] of Object.entries(parsed)) {
        if (v && typeof v.user === 'string' && typeof v.expiresAt === 'number' && v.expiresAt > t) {
          sessions.set(id, { user: v.user, expiresAt: v.expiresAt });
        }
      }
    } catch { /* sin archivo o corrupto: arrancamos vacío */ }
  }

  function persist() {
    if (!persistPath) return;
    const obj = {};
    for (const [id, v] of sessions) obj[id] = v;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, persistPath);
  }

  return {
    ttlMs,
    create(user) {
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { user, expiresAt: now() + ttlMs });
      persist();
      return id;
    },
    validate(id) {
      const v = sessions.get(id);
      if (!v) return null;
      if (v.expiresAt <= now()) { sessions.delete(id); persist(); return null; }
      v.expiresAt = now() + ttlMs; // renovación deslizante
      persist();
      return { user: v.user };
    },
    destroy(id) {
      if (sessions.delete(id)) persist();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/server && node --test sessions.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/sessions.js habitat/server/sessions.test.js
git commit -m "feat(habitat): store de sesiones de login persistido a disco"
```

---

### Task 3: Helper de autenticación común (`server/auth.js`)

**Files:**
- Create: `habitat/server/auth.js`
- Create: `habitat/server/auth.test.js`

**Interfaces:**
- Consumes: `sessionStore.validate(id)` de Task 2.
- Produces:
  - `parseCookies(header: string | undefined): Record<string,string>` → parsea `req.headers.cookie`.
  - `COOKIE_NAME = 'habitat_session'`.
  - `isAuthenticated(req, { sessionStore, token }): boolean` → `true` si: cookie de sesión válida (renueva), **o** `Authorization: Bearer === token`, **o** `?token=` (query) `=== token`. Si `token` es vacío **y** no hay `sessionStore` con login activo, replica el comportamiento actual: `req` con token vacío ⇒ libre. Concretamente: si no hay `token` configurado y no hay cookie válida, devuelve `true` (sin auth, como hoy). Si hay `token`, exige uno de los tres.

- [ ] **Step 1: Write the failing test**

```js
// habitat/server/auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, isAuthenticated, COOKIE_NAME } from './auth.js';

const fakeReq = ({ cookie, authorization, urlToken } = {}) => ({
  headers: { ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },
  url: `/x${urlToken ? `?token=${urlToken}` : ''}`,
});
const storeOf = (validId, user = 'nico') => ({
  validate: (id) => (id === validId ? { user } : null),
});

test('parseCookies parsea pares y trimea', () => {
  assert.deepEqual(parseCookies('a=1; habitat_session=xyz'), { a: '1', habitat_session: 'xyz' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('cookie de sesión válida autentica', () => {
  const req = fakeReq({ cookie: `${COOKIE_NAME}=good` });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('good'), token: 'secret' }), true);
});

test('Bearer token correcto autentica', () => {
  const req = fakeReq({ authorization: 'Bearer secret' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), true);
});

test('?token= correcto autentica (fallback)', () => {
  const req = fakeReq({ urlToken: 'secret' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), true);
});

test('sin nada y con token configurado: rechaza', () => {
  const req = fakeReq({});
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), false);
});

test('cookie inválida + Bearer malo: rechaza', () => {
  const req = fakeReq({ cookie: `${COOKIE_NAME}=bad`, authorization: 'Bearer nope' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('good'), token: 'secret' }), false);
});

test('sin token configurado: libre (comportamiento actual)', () => {
  const req = fakeReq({});
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: '' }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/server && node --test auth.test.js`
Expected: FAIL — `Cannot find module './auth.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// habitat/server/auth.js
export const COOKIE_NAME = 'habitat_session';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Una request está autenticada si: cookie de sesión válida, o Bearer == token, o ?token= == token.
// Si no hay token configurado y no hay sesión, es libre (comportamiento histórico del panel).
export function isAuthenticated(req, { sessionStore, token } = {}) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (sid && sessionStore && sessionStore.validate(sid)) return true;
  if (!token) return true;
  const hdr = (req.headers && req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (hdr === token) return true;
  const q = new URL(req.url, 'http://x').searchParams.get('token');
  if (q === token) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/server && node --test auth.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/auth.js habitat/server/auth.test.js
git commit -m "feat(habitat): helper isAuthenticated (cookie de sesión o token)"
```

---

### Task 4: Config — usuario, hash, sesiones, cookie

**Files:**
- Modify: `habitat/server/config.js`
- Modify: `habitat/server/config.test.js`

**Interfaces:**
- Produces (en el objeto `config`): `USER` (string), `PASSWORD_HASH` (string), `SESSIONS_PATH` (string), `SESSION_TTL_MS` (number, default `86_400_000`), `COOKIE_SECURE` (bool, default `true`).

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/config.test.js` (seguir el estilo existente del archivo):

```js
test('config expone USER/PASSWORD_HASH/SESSIONS_PATH/SESSION_TTL_MS/COOKIE_SECURE con defaults', async () => {
  delete process.env.HABITAT_USER;
  delete process.env.HABITAT_PASSWORD_HASH;
  delete process.env.HABITAT_SESSION_TTL_MS;
  delete process.env.HABITAT_COOKIE_SECURE;
  const { default: cfg } = await import(`./config.js?cfg=${Math.random()}`);
  assert.equal(cfg.USER, '');
  assert.equal(cfg.PASSWORD_HASH, '');
  assert.equal(cfg.SESSION_TTL_MS, 86_400_000);
  assert.equal(cfg.COOKIE_SECURE, true);
  assert.ok(cfg.SESSIONS_PATH.endsWith('.sessions.json'));
});
```

> Nota: si `config.test.js` no existe o usa otro patrón de import, replicar el patrón vigente del archivo. `config.js` se importa una sola vez por proceso; el `?cfg=` fuerza un módulo fresco.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/server && node --test config.test.js`
Expected: FAIL — `cfg.USER` es `undefined`.

- [ ] **Step 3: Write minimal implementation**

En `habitat/server/config.js`, agregar dentro del objeto exportado (junto a `STATE_PATH`, usando el helper `bool` y `num` ya definidos arriba en el archivo):

```js
  USER: process.env.HABITAT_USER || '',
  PASSWORD_HASH: process.env.HABITAT_PASSWORD_HASH || '',
  SESSION_TTL_MS: num(process.env.HABITAT_SESSION_TTL_MS, 86_400_000),
  COOKIE_SECURE: process.env.HABITAT_COOKIE_SECURE == null ? true : bool(process.env.HABITAT_COOKIE_SECURE),
  SESSIONS_PATH: process.env.HABITAT_SESSIONS || join(HERE, '..', '.sessions.json'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/server && node --test config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/config.js habitat/server/config.test.js
git commit -m "feat(habitat): config de login (USER, PASSWORD_HASH, sesiones, cookie)"
```

---

### Task 5: Endpoints `/login`, `/logout`, `/auth/me` + anti-bruteforce

**Files:**
- Modify: `habitat/server/index.js`
- Modify: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `createSessionStore` (Task 2), `verifyPassword` (Task 1), `isAuthenticated`/`COOKIE_NAME` (Task 3), config de Task 4.
- Produces:
  - `createApp({ ..., sessionStore })` acepta un `sessionStore` inyectable (default `createSessionStore({ persistPath: config.SESSIONS_PATH, ttlMs: config.SESSION_TTL_MS })`).
  - `POST /login` `{user,password}` → 204 + `Set-Cookie` en éxito; 401 en credenciales malas; 429 si está en lockout; 404/no-op si login deshabilitado.
  - `POST /logout` → 204 y cookie vencida.
  - `GET /auth/me` → 200 `{user}` con sesión válida; 401 si no.

- [ ] **Step 1: Write the failing tests**

Agregar a `habitat/server/index.test.js`. Usar un `config` con login activo y un `sessionStore` real:

```js
import { createSessionStore } from './sessions.js';
import { hashPassword } from './password.js';

const loginConfig = {
  ...config,
  USER: 'nico',
  PASSWORD_HASH: hashPassword('clave123'),
  SESSION_TTL_MS: 86_400_000,
  COOKIE_SECURE: false, // tests sobre http plano
};

function appWithLogin() {
  const store = createStore();
  const sessionStore = createSessionStore({ ttlMs: 86_400_000 });
  const { server } = createApp({ config: loginConfig, store, sessionStore });
  return { server, sessionStore };
}

test('POST /login con credenciales correctas -> 204 + Set-Cookie habitat_session', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  assert.equal(res.status, 204);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie && cookie.includes('habitat_session='));
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Strict'));
  server.close();
});

test('POST /login con password incorrecta -> 401, sin cookie', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'mala' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
  server.close();
});

test('GET /auth/me sin cookie -> 401; con cookie de /login -> 200 {user}', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  assert.equal((await fetch(`http://127.0.0.1:${port}/auth/me`)).status, 401);
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`http://127.0.0.1:${port}/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: 'nico' });
  server.close();
});

test('POST /logout vence la cookie y /auth/me vuelve a 401', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await fetch(`http://127.0.0.1:${port}/logout`, { method: 'POST', headers: { cookie } });
  const me = await fetch(`http://127.0.0.1:${port}/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 401);
  server.close();
});

test('lockout: tras 5 fallos seguidos -> 429', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  for (let i = 0; i < 5; i++) {
    await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'nico', password: 'mala' }),
    });
  }
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  assert.equal(res.status, 429);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat/server && node --test index.test.js`
Expected: FAIL — `/login` responde 404 (estáticos) y `createApp` no acepta `sessionStore`.

- [ ] **Step 3: Wire sessionStore + imports en index.js**

En `habitat/server/index.js`:

1. Imports (junto a los demás):

```js
import { createSessionStore } from './sessions.js';
import { verifyPassword } from './password.js';
import { isAuthenticated, COOKIE_NAME } from './auth.js';
```

2. Firma de `createApp` — agregar `sessionStore` con default:

```js
export function createApp({ config, store, settingsStore = createSettings(), projectsStore, sessionStore = createSessionStore({ persistPath: config.SESSIONS_PATH, ttlMs: config.SESSION_TTL_MS }), tmux = { listSessions, newTmuxSession, killTmuxSession }, git: gitOverrides = {} }) {
```

- [ ] **Step 4: Implement login/logout/auth-me + anti-bruteforce**

Dentro de `createApp`, antes de `const server = createServer(...)`, agregar el estado y helper de cookie:

```js
  const loginEnabled = !!(config.USER && config.PASSWORD_HASH);
  const fails = new Map(); // user -> { count, lockedUntil }
  const LOCK_AFTER = 5;
  const LOCK_MS = 60_000;

  function setSessionCookie(res, id) {
    const attrs = [`${COOKIE_NAME}=${id}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${Math.floor(config.SESSION_TTL_MS / 1000)}`];
    if (config.COOKIE_SECURE) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }
  function clearSessionCookie(res) {
    const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
    if (config.COOKIE_SECURE) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }
```

Dentro del handler de `createServer`, junto a los otros `if (req.method === ...)` y **antes** del bloque de estáticos, agregar:

```js
    if (req.method === 'POST' && url.pathname === '/login') {
      if (!loginEnabled) { res.writeHead(404).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const user = body && typeof body.user === 'string' ? body.user : '';
      const password = body && typeof body.password === 'string' ? body.password : '';
      const f = fails.get(user) || { count: 0, lockedUntil: 0 };
      if (f.lockedUntil > Date.now()) { res.writeHead(429).end(); return; }
      const ok = user === config.USER && verifyPassword(password, config.PASSWORD_HASH);
      if (!ok) {
        f.count += 1;
        if (f.count >= LOCK_AFTER) { f.lockedUntil = Date.now() + LOCK_MS; f.count = 0; }
        fails.set(user, f);
        res.writeHead(401).end();
        return;
      }
      fails.delete(user);
      const id = sessionStore.create(user);
      setSessionCookie(res, id);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/logout') {
      const sid = (await import('./auth.js')).parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (sid) sessionStore.destroy(sid);
      clearSessionCookie(res);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/me') {
      if (!isAuthenticated(req, { sessionStore, token: config.TOKEN })) { res.writeHead(401).end(); return; }
      const sid = (await import('./auth.js')).parseCookies(req.headers.cookie)[COOKIE_NAME];
      const sess = sid ? sessionStore.validate(sid) : null;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: sess ? sess.user : config.USER }));
      return;
    }
```

> Nota DRY: en vez de `await import('./auth.js')` repetido, importar `parseCookies` arriba junto a `isAuthenticated` y usarlo directo. Hacerlo así:
> `import { isAuthenticated, parseCookies, COOKIE_NAME } from './auth.js';` y reemplazar las dos llamadas dinámicas por `parseCookies(req.headers.cookie)[COOKIE_NAME]`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd habitat/server && node --test index.test.js`
Expected: PASS (incluyendo los 5 nuevos de login).

- [ ] **Step 6: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoints /login /logout /auth/me con anti-bruteforce"
```

---

### Task 6: `authorize()` acepta sesión y deja de depender de `LOCAL`

**Files:**
- Modify: `habitat/server/index.js`
- Modify: `habitat/server/index.test.js`

**Interfaces:**
- Consumes: `isAuthenticated` (Task 3), `sessionStore` (Task 5).
- Produces: `authorize(req,res)` autoriza si `isAuthenticated(req, { sessionStore, token: config.TOKEN })`; ya **no** exige `LOCAL`. Responde 401 si no.

- [ ] **Step 1: Write the failing test**

Agregar a `index.test.js` (con `appWithLogin` de Task 5):

```js
test('endpoint protegido acepta cookie de sesión (sin Bearer)', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  // /sessions/order está protegido por authorize()
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ order: [] }),
  });
  assert.equal(res.status, 200);
  server.close();
});

test('endpoint protegido sin cookie ni token -> 401', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: [] }),
  });
  assert.equal(res.status, 401);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat/server && node --test index.test.js`
Expected: FAIL — el request con cookie da 403 (por el chequeo `LOCAL`, ya que la cookie no es Bearer).

- [ ] **Step 3: Reemplazar el cuerpo de `authorize()`**

En `habitat/server/index.js`, reemplazar:

```js
  function authorize(req, res) {
    if (config.TOKEN) {
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (hdr !== config.TOKEN) { res.writeHead(401).end(); return false; }
    }
    if (!LOCAL.has(req.socket.remoteAddress)) { res.writeHead(403).end(); return false; }
    return true;
  }
```

por:

```js
  // Autoriza endpoints sensibles (hooks, spawn, gestión, upload). Antes exigía loopback
  // (LOCAL); detrás de Tailscale Serve toda conexión llega como loopback, así que ese gate
  // dejó de aislar. La barrera real es la auth: cookie de sesión o token (Bearer/?token=).
  function authorize(req, res) {
    if (!isAuthenticated(req, { sessionStore, token: config.TOKEN })) { res.writeHead(401).end(); return false; }
    return true;
  }
```

Eliminar la constante `LOCAL` si quedó sin uso (verificar con grep antes de borrar).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd habitat/server && node --test index.test.js`
Expected: PASS (toda la suite, incluidos `/hooks` con Bearer que siguen pasando por el camino del token).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "refactor(habitat): authorize() acepta sesión; quita gate LOCAL inefectivo tras Serve"
```

---

### Task 7: `/ws` y `/term` aceptan la cookie de sesión

**Files:**
- Modify: `habitat/server/ws.js`
- Modify: `habitat/server/term.js`
- Modify: `habitat/server/ws.test.js`
- Modify: `habitat/server/index.js` (pasar `sessionStore` a `attachWs`/`attachTerm`)

**Interfaces:**
- Consumes: `isAuthenticated` (Task 3), `sessionStore` (Task 5).
- Produces: `attachWs(server, store, { token, sessionStore, onChat, onDismiss })` y `attachTerm(server, store, { token, sessionStore, spawnPty })` autentican el upgrade con `isAuthenticated(req, { sessionStore, token })` (cookie viaja en `req.headers.cookie`).

- [ ] **Step 1: Write the failing test**

Agregar a `habitat/server/ws.test.js` (seguir su estilo; el WS de `ws` permite pasar `headers` en el handshake):

```js
test('/ws acepta conexión con cookie de sesión válida', async () => {
  // Setup con login activo y una sesión creada a mano en el sessionStore.
  // (Ver helpers del archivo; crear app con { config: loginConfig, store, sessionStore }.)
  const sessionStore = createSessionStore({ ttlMs: 100000 });
  const id = sessionStore.create('nico');
  const { server } = createApp({ config: { ...config, USER: 'nico', PASSWORD_HASH: 'x', COOKIE_SECURE: false }, store: createStore(), sessionStore });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `habitat_session=${id}` } });
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); });
  ws.close(); server.close();
});

test('/ws rechaza sin cookie ni token', async () => {
  const { server } = createApp({ config: { ...config, USER: 'nico', PASSWORD_HASH: 'x' }, store: createStore(), sessionStore: createSessionStore({}) });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const closed = await new Promise((r) => ws.on('close', (code) => r(code)));
  assert.equal(closed, 1008);
  server.close();
});
```

> Importar `createSessionStore` en `ws.test.js`. Si el archivo aún usa `?token=secret` en sus tests existentes, esos siguen pasando (fallback de token intacto).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd habitat/server && node --test ws.test.js`
Expected: FAIL — la conexión por cookie se cierra con 1008 (ws.js todavía solo mira token).

- [ ] **Step 3: Actualizar `ws.js`**

Reemplazar el bloque de auth en `wss.on('connection', ...)`:

```js
import { isAuthenticated } from './auth.js';

export function attachWs(httpServer, store, { token, sessionStore, onChat, onDismiss } = {}) {
  // ...noServer/upgrade igual...
  wss.on('connection', (ws, req) => {
    if (!isAuthenticated(req, { sessionStore, token })) { ws.close(1008, 'unauthorized'); return; }
    ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot() }));
    // ...resto igual...
  });
```

- [ ] **Step 4: Actualizar `term.js`**

Reemplazar el bloque de auth en `wss.on('connection', ...)`:

```js
import { isAuthenticated } from './auth.js';

export function attachTerm(httpServer, store, { token, sessionStore, spawnPty = defaultSpawnPty } = {}) {
  // ...noServer/upgrade igual...
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    if (!isAuthenticated(req, { sessionStore, token })) { ws.close(1008, 'unauthorized'); return; }
    const s = store.get(url.searchParams.get('id'));
    // ...resto igual...
  });
```

- [ ] **Step 5: Pasar `sessionStore` desde `index.js`**

En `index.js`, en las llamadas a `attachWs` y `attachTerm`:

```js
  hub = attachWs(server, store, {
    token: config.TOKEN,
    sessionStore,
    onChat: (id, text) => { /* igual */ },
    onDismiss: (id) => { /* igual */ },
  });
  attachTerm(server, store, { token: config.TOKEN, sessionStore });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd habitat/server && node --test ws.test.js term.test.js index.test.js`
Expected: PASS (cookie acepta; sin nada cierra 1008; tests viejos con `?token=` siguen pasando).

- [ ] **Step 7: Commit**

```bash
git add habitat/server/ws.js habitat/server/term.js habitat/server/ws.test.js habitat/server/index.js
git commit -m "feat(habitat): /ws y /term autentican por cookie de sesión"
```

---

### Task 8: Cliente — vista de Login + gating por `/auth/me`

**Files:**
- Create: `habitat/client/src/components/LoginView.vue`
- Create: `habitat/client/src/composables/useAuth.ts`
- Create: `habitat/client/src/composables/useAuth.test.ts`
- Modify: `habitat/client/src/App.vue`

**Interfaces:**
- Produces:
  - `useAuth()` → `{ authed: Ref<boolean | null>, checkAuth(): Promise<void>, login(user, password): Promise<boolean>, logout(): Promise<void> }`. `authed === null` mientras carga; `true`/`false` tras `checkAuth`.
  - `LoginView.vue` — formulario usuario+contraseña que llama `login()` y muestra error en 401/429.

- [ ] **Step 1: Write the failing test (composable)**

```ts
// habitat/client/src/composables/useAuth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuth } from './useAuth'

beforeEach(() => { vi.restoreAllMocks() })

describe('useAuth', () => {
  it('checkAuth pone authed=true si /auth/me responde 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(true)
  })

  it('checkAuth pone authed=false si /auth/me responde 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(false)
  })

  it('login devuelve true y setea authed en 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 204, ok: true })) as any)
    const a = useAuth()
    const ok = await a.login('nico', 'clave')
    expect(ok).toBe(true)
    expect(a.authed.value).toBe(true)
  })

  it('login devuelve false en 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    expect(await a.login('nico', 'mala')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd habitat/client && npx vitest run src/composables/useAuth.test.ts`
Expected: FAIL — `Cannot find module './useAuth'`.

- [ ] **Step 3: Implement `useAuth.ts`**

```ts
// habitat/client/src/composables/useAuth.ts
import { ref } from 'vue'

// null = aún no chequeado; true/false = resultado de /auth/me.
const authed = ref<boolean | null>(null)

export function useAuth() {
  async function checkAuth() {
    try {
      const res = await fetch('/auth/me')
      authed.value = res.status === 200
    } catch {
      authed.value = false
    }
  }

  async function login(user: string, password: string): Promise<boolean> {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, password }),
    })
    const ok = res.status === 204
    if (ok) authed.value = true
    return ok
  }

  async function logout() {
    try { await fetch('/logout', { method: 'POST' }) } catch { /* ignore */ }
    authed.value = false
  }

  return { authed, checkAuth, login, logout }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd habitat/client && npx vitest run src/composables/useAuth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create `LoginView.vue`**

```vue
<!-- habitat/client/src/components/LoginView.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const { login } = useAuth()
const user = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const ok = await login(user.value, password.value)
    if (!ok) error.value = 'Usuario o contraseña incorrectos.'
  } catch {
    error.value = 'No se pudo conectar.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <h1>HÁBITAT</h1>
      <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus />
      <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password" />
      <button :disabled="busy" type="submit">{{ busy ? '…' : 'Entrar' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.login { display: flex; align-items: center; justify-content: center; min-height: 70vh; }
.card { display: flex; flex-direction: column; gap: 10px; padding: 24px; min-width: 260px; border: 1px solid var(--gold, #caa14a); border-radius: 8px; }
.card h1 { text-align: center; margin: 0 0 8px; letter-spacing: 2px; }
.card input, .card button { padding: 10px; font: inherit; }
.card button { background: var(--gold, #caa14a); color: #2a1c0a; border: none; cursor: pointer; }
.err { color: #d66; margin: 0; text-align: center; }
</style>
```

- [ ] **Step 6: Gate en `App.vue`**

Modificar `App.vue` para chequear auth antes de arrancar el socket y mostrar Login si no está autenticado:

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import { useTabAlert } from './composables/useTabAlert'
import { useAuth } from './composables/useAuth'
import HabitatLayout from './components/HabitatLayout.vue'
import SpawnMenu from './components/SpawnMenu.vue'
import SettingsView from './components/SettingsView.vue'
import LoginView from './components/LoginView.vue'

const store = useSessions()
const view = ref<'sessions' | 'settings'>('sessions')
const { authed, checkAuth, logout } = useAuth()

onMounted(checkAuth)
// Arranca el socket recién cuando hay auth (la cookie viaja sola en el upgrade).
watch(authed, (v) => { if (v === true) startSocket() })
useTabAlert()
</script>

<template>
  <LoginView v-if="authed === false" />
  <template v-else-if="authed === true">
    <header>
      <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
      <div class="count">
        <span><b>{{ store.list.length }}</b> SESIONES</span>
        <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
      </div>
      <nav class="views">
        <button class="ctl" :class="{ active: view === 'sessions' }" @click="view = 'sessions'">Sesiones</button>
        <button class="ctl" :class="{ active: view === 'settings' }" @click="view = 'settings'">⚙ Settings</button>
        <button class="ctl" @click="logout">Salir</button>
      </nav>
      <SpawnMenu />
    </header>
    <HabitatLayout v-if="view === 'sessions'" />
    <SettingsView v-else />
    <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
  </template>
</template>

<style scoped>
.views { display: flex; gap: 6px; }
.views .ctl.active { background: var(--gold); color: #2a1c0a; }
</style>
```

> Nota: `startSocket()` ya es idempotente (`started` guard), así que el `watch` no abre sockets de más.

- [ ] **Step 7: Run client tests + build**

Run: `cd habitat/client && npx vitest run && npm run build`
Expected: tests PASS; build genera `habitat/web/` sin errores de TS.

- [ ] **Step 8: Commit**

```bash
git add habitat/client/src/components/LoginView.vue habitat/client/src/composables/useAuth.ts habitat/client/src/composables/useAuth.test.ts habitat/client/src/App.vue
git commit -m "feat(habitat): vista de login en el cliente con gating por /auth/me"
```

---

### Task 9: Documentación — runbook Tailscale Serve + auth

**Files:**
- Modify: `habitat/README.md`

**Interfaces:** ninguna (docs).

- [ ] **Step 1: Agregar sección de acceso remoto y login**

En `habitat/README.md`, después de la sección "## Correr (producción)", agregar:

```markdown
## Acceso remoto desde tablet/celular (Tailscale Serve + login)

El panel sigue bindeado a loopback (`127.0.0.1:8377`). Para llegar desde una tablet
sin SSH ni exponer a internet, se publica vía **Tailscale Serve** (HTTPS dentro del tailnet):

1. Instalar la app de Tailscale en la tablet y unirla al tailnet (misma cuenta).
2. En el admin de Tailscale: habilitar **MagicDNS** y **HTTPS**.
3. En el server: `tailscale serve --bg --https=443 http://127.0.0.1:8377`
   (verificar con `tailscale serve status`).
4. Abrir en la tablet `https://<host>.<tailnet>.ts.net/`.

No hace falta tocar `HABITAT_BIND`: Serve proxea desde loopback. Como todas las conexiones
llegan a la app como loopback, la autorización de endpoints sensibles ya **no** se apoya en
la IP de origen, sino en la autenticación (abajo) + las ACLs de Tailscale.

### Login con usuario y contraseña

Por defecto el panel usa solo `HABITAT_TOKEN`. Para entrar desde el navegador con
usuario+contraseña (en vez de pegar el token en la URL), setear:

    export HABITAT_USER=nico
    export HABITAT_PASSWORD_HASH="$(cd habitat && printf 'TU_CLAVE\n' | npm run --silent hash-password | sed 's/^HABITAT_PASSWORD_HASH=//')"
    # o correr `npm run hash-password` interactivo y pegar la línea en el env del servicio

El login emite una **cookie de sesión** (`HttpOnly; Secure; SameSite=Strict`) de **1 día**
con renovación deslizante, persistida en `.sessions.json` (sobrevive reinicios). Variables:

- `HABITAT_USER`, `HABITAT_PASSWORD_HASH` — credenciales (login opt-in; si faltan, solo token).
- `HABITAT_SESSION_TTL_MS` — duración de sesión (default `86400000` = 1 día).
- `HABITAT_COOKIE_SECURE` — `false` solo para pruebas en http plano (default `true`).
- `HABITAT_SESSIONS` — ruta del archivo de sesiones (default `.sessions.json`).

`HABITAT_TOKEN` sigue válido como `Authorization: Bearer` (hooks, statusline) y `?token=`
sigue funcionando como fallback de navegador.
```

- [ ] **Step 2: Verify markdown renders**

Run: `cd habitat && sed -n '/Acceso remoto/,/fallback de navegador/p' README.md | head -5`
Expected: muestra el encabezado de la sección nueva.

- [ ] **Step 3: Commit**

```bash
git add habitat/README.md
git commit -m "docs(habitat): runbook de acceso remoto (Tailscale Serve) + login"
```

---

## Cierre (obligatorio por CLAUDE.md)

- [ ] **Sync con main y resolver conflictos**

```bash
git fetch origin && git merge origin/main
```

- [ ] **Correr toda la suite del server tocada**

Run: `cd habitat/server && node --test password.test.js sessions.test.js auth.test.js config.test.js index.test.js ws.test.js term.test.js`
Expected: PASS. (Otros módulos pueden fallar por deps pre-existentes; validar solo lo tocado.)

- [ ] **Build del cliente**

Run: `cd habitat/client && npx vitest run && npm run build`
Expected: PASS + `habitat/web/` generado.

- [ ] **Push + PR**

```bash
git push origin shepard
gh pr create --base main --head shepard --title "feat(habitat): acceso remoto desde tablet (Tailscale Serve + login con sesión)" --body "..."
```

---

## Self-review (cobertura del spec)

- Tailscale Serve / no cambiar BIND → Task 9 (docs) + decisión de diseño respetada (sin cambios de bind).
- Login usuario+contraseña → Tasks 1, 4, 5, 8.
- Cookie HttpOnly/Secure/SameSite, sesión 1 día deslizante, persistida → Tasks 2, 5.
- WebSocket autenticado por cookie (sin token en URL) → Task 7.
- `HABITAT_TOKEN` Bearer para hooks/statusline + `?token=` fallback → Task 3 (`isAuthenticated`), verificado en Tasks 5–7.
- Gate `LOCAL` removido como barrera (inefectivo tras Serve) → Task 6.
- Anti-bruteforce simple → Task 5.
- Login opt-in (sin credenciales = comportamiento actual) → Tasks 3, 5 (`loginEnabled`).
- CLI hash-password sin guardar plano → Task 1.
- Fuera de alcance (multiusuario, OAuth, Funnel, cambiar BIND/systemd) → respetado.
