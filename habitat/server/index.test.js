import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, newSession } from './state.js';
import { createApp } from './index.js';
import { createSettings } from './settings.js';
import { PALETTE } from './palette.js';
import { createProjects } from './projects.js';
import { NAMES } from './characters.js';
import { createSessionStore } from './sessions.js';
import { hashPassword } from './password.js';
import { createEnvStore } from './env-store.js';
import { RELATED_DIR } from './session-setup.js';

const config = { PORT: 0, BIND: '127.0.0.1', TOKEN: 'secret', PREVIEW_LINES: 5, MAX_CONTEXT: 200000 };

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

// Repo git temporal con un commit inicial. Identidad explícita para no depender
// de la config global de git en la máquina que corre los tests.
function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'habitat-git-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@local');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'a.js'), 'const a = 1\n');
  git('add', '-A');
  git('commit', '-m', 'inicial');
  return { dir, git };
}

test('POST /hooks sin token -> 401', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/x' }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /hooks con token crea la sesión en el store', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/home/u/api' }),
  });
  assert.equal(res.status, 204);
  assert.equal(store.get('s1').name, 'api');
  server.close();
});

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

test('GET /preview sin token -> 401', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/preview?id=x`);
  assert.equal(res.status, 401);
  server.close();
});

test('GET path traversal -> no 200', async () => {
  const store = createStore();
  const { server } = createApp({ config, store });
  const port = await listen(server);
  // Use percent-encoded dots so fetch doesn't normalize them away
  const res = await fetch(`http://127.0.0.1:${port}/%2e%2e/server/config.js`);
  assert.notEqual(res.status, 200);
  server.close();
});

const spawnConfig = (over) => ({ ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'], WORKTREES_DIR: '/home/u/habitat-worktrees', ...over });
const fakeGit = (over = {}) => ({
  findNestedRepos: async () => [],
  remoteDefaultBranch: async () => 'origin/main',
  worktreeAdd: async () => true,
  ...over,
});
const auth = { authorization: 'Bearer secret' };

test('GET /projects refleja canSpawn (off)', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.canSpawn, false);
  server.close();
});

test('GET /projects lista la whitelist cuando está habilitado', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const body = await r.json();
  assert.equal(body.canSpawn, true);
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].dir, '/home/u/proj-api');
  assert.equal(body.projects[0].name, 'proj-api');
  assert.ok(typeof body.projects[0].color === 'string' && body.projects[0].color.startsWith('#'));
  assert.deepEqual(body.projects[0].chars, []);
  server.close();
});

test('GET /projects canManage=true con lista vacía cuando ALLOW_SPAWN y PROJECTS_ROOT están configurados', async () => {
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: '/some/projects/root', PROJECTS: [] };
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.canManage, true);
  assert.equal(body.canSpawn, false);
  assert.equal(body.projects.length, 0);
  server.close();
});

test('POST /spawn deshabilitado -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /spawn dir fuera de whitelist -> 403', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/etc' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /spawn body inválido -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: '{ no json',
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn OK worktree -> 200 con name; invoca worktreeAdd y newTmuxSession', async () => {
  const seenGit = [];
  const seenTmux = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async (n, d) => { seenTmux.push([n, d]); return true; },
  };
  const git = fakeGit({ worktreeAdd: async (...a) => { seenGit.push(a); return true; } });
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'bob' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api-bob');
  assert.deepEqual(seenGit, [['/home/u/proj-api', 'bob', 'origin/main', '/home/u/habitat-worktrees/proj-api/bob']]);
  assert.deepEqual(seenTmux, [['proj-api-bob', '/home/u/habitat-worktrees/proj-api/bob']]);
  server.close();
});

test('POST /spawn autogenera nombre cuando no se provee', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(NAMES.some((n) => body.name === `proj-api-${n}`), `${body.name} debería ser proj-api-<nombre de NAMES>`);
  server.close();
});

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

test('POST /spawn crea pod provisional con name, project, branch y char', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const store = createStore();
  const { server } = createApp({ config: spawnConfig(), store, tmux, git });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'bob', char: 'Knight' }),
  });
  const prov = store.get('pending:proj-api-bob');
  assert.ok(prov, 'debe existir el pod provisional');
  assert.equal(prov.tmux, 'proj-api-bob');
  assert.equal(prov.name, 'bob');
  assert.equal(prov.project, 'proj-api');
  assert.equal(prov.branch, 'bob');
  assert.equal(prov.status, 'waiting');
  assert.equal(prov.char, 'Knight');
  server.close();
});

test('POST /spawn base = default branch (no usa body.base)', async () => {
  const seenGit = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit({ worktreeAdd: async (...a) => { seenGit.push(a); return true; } });
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'fix', base: 'ignored' }),
  });
  assert.equal(seenGit[0][2], 'origin/main');
  server.close();
});

test('POST /spawn nombre inválido -> 400', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: '../evil' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn nombre con prefijo - (flag smuggling) -> 400', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: '--force' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn colisión -> 409', async () => {
  const tmux = { listSessions: async () => ['proj-api-bob'], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'bob' }),
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /spawn fallo de worktreeAdd -> 500', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit({ worktreeAdd: async () => false });
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'feat' }),
  });
  assert.equal(r.status, 500);
  server.close();
});

test('POST /spawn con name + char válido -> setPendingChar(tmuxName) y 200', async () => {
  const store = createStore();
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'bob', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  assert.equal(store.takePendingChar('proj-api-bob'), 'Knight');
  server.close();
});

test('POST /spawn con char inválido -> 400', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'NoExiste' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

// Regresión: con /ws y /term montados sobre el mismo http server, el upgrade a
// /term debe completar el handshake (101) y dejar que la lógica de la app corra
// (acá id desconocido -> close 1008). Si el routing de upgrade está roto, el
// handshake aborta con 400 y nunca llegamos a 1008.
test('WS /term convive con /ws: handshake completa (no 400)', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=nope&token=secret`);
    const outcome = await new Promise((r) => {
      ws.once('close', (code) => r({ kind: 'close', code }));
      ws.once('error', (err) => r({ kind: 'error', err }));
    });
    assert.equal(outcome.kind, 'close', `esperaba close del lado app, no error de handshake: ${outcome.err?.message}`);
    assert.equal(outcome.code, 1008);
  } finally {
    server.close();
  }
});

test('WS /ws sigue conectando junto a /term', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
    const snapshot = await new Promise((r, rej) => {
      ws.once('message', (d) => r(JSON.parse(d.toString())));
      ws.once('error', rej);
    });
    assert.equal(snapshot.type, 'snapshot');
    ws.close();
  } finally {
    server.close();
  }
});

test('POST /kill deshabilitado -> 403', async () => {
  const { server } = createApp({ config: { ...config, ALLOW_SPAWN: false }, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'x' }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /kill body sin id -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /kill id desconocido -> 404', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope' }),
  });
  assert.equal(r.status, 404);
  server.close();
});

test('POST /kill OK -> 200, mata tmux, remueve del store y broadcast remove', { timeout: 5000 }, async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'proj-api' }));
  const killed = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async (n) => { killed.push(n); return true; },
  };
  const { server } = createApp({ config: spawnConfig(), store, tmux });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const removeMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'remove') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's1' }),
  });
  assert.equal(res.status, 200);
  const m = await removeMsg;
  assert.equal(m.id, 's1');
  assert.equal(store.get('s1'), undefined);
  assert.ok(killed.includes('proj-api'), 'mata la sesión del agente');
  assert.ok(killed.includes('proj-api-edit'), 'mata la sesión de editor');
  ws.close();
  server.close();
});

test('GET /settings sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`);
  assert.equal(r.status, 401);
  server.close();
});

test('GET /settings devuelve el default acceptEdits', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`, { headers: auth });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.permissionMode, 'acceptEdits');
  server.close();
});

test('POST /settings con modo inválido -> 400', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/settings`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ permissionMode: 'nope' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /settings válido -> 200, persiste en el store y broadcast', { timeout: 5000 }, async () => {
  const settingsStore = createSettings();
  const { server } = createApp({ config, store: createStore(), settingsStore });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const settingsMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'settings') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/settings`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ permissionMode: 'plan' }),
  });
  assert.equal(res.status, 200);
  const m = await settingsMsg;
  assert.equal(m.settings.permissionMode, 'plan');
  assert.equal(settingsStore.get().permissionMode, 'plan');
  ws.close();
  server.close();
});

test('POST /spawn pasa el permissionMode de settings a newTmuxSession', async () => {
  const settingsStore = createSettings();
  settingsStore.set({ permissionMode: 'plan' });
  const seen = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async (name, dir, _exec, opts) => { seen.push([name, dir, opts]); return true; },
  };
  const git = fakeGit();
  const { server } = createApp({ config: spawnConfig(), store: createStore(), settingsStore, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'mario' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [['proj-api-mario', '/home/u/habitat-worktrees/proj-api/mario', { permissionMode: 'plan' }]]);
  server.close();
});

test('POST /kill de sesión por rama remueve el worktree (best-effort)', async () => {
  const seenRemove = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async () => true,
  };
  const git = {
    worktreeAdd: async () => true,
    worktreeRemove: async (...a) => { seenRemove.push(a); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const store = createStore();
  store.upsert(newSession('sid1', {
    name: 'proj-api', project: 'proj-api', tmux: 'proj-api-feature-x', branch: 'feature/x',
  }));
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid1' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seenRemove, [['/home/u/proj-api', '/home/u/habitat-worktrees/proj-api/feature-x']]);
  server.close();
});

test('POST /spawn de proyecto contenedor llama containerWorktreeAdd y abre tmux en wtPath', async () => {
  const seenTmux = [];
  const seenContainer = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async (n, d) => { seenTmux.push([n, d]); return true; } };
  const git = fakeGit({
    findNestedRepos: async () => ['back', 'front'],
    containerWorktreeAdd: async (...a) => { seenContainer.push(a); return true; },
  });
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'bob' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api-bob');
  assert.deepEqual(seenContainer, [[
    '/home/u/proj-api', 'bob', '/home/u/habitat-worktrees/proj-api/bob', ['back', 'front'],
  ]]);
  assert.deepEqual(seenTmux, [['proj-api-bob', '/home/u/habitat-worktrees/proj-api/bob']]);
  server.close();
});

test('POST /spawn de contenedor: fallo de containerWorktreeAdd -> 500', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = fakeGit({ findNestedRepos: async () => ['back'], containerWorktreeAdd: async () => false });
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', name: 'feat' }),
  });
  assert.equal(r.status, 500);
  server.close();
});

test('POST /kill de sesión contenedor remueve worktrees hijos y luego el padre', async () => {
  const seenRemove = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = {
    findNestedRepos: async () => ['back', 'front'],
    worktreeRemove: async (projectDir, path) => { seenRemove.push([projectDir, path]); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', PROJECTS: ['/home/u/Artisano'] });
  const store = createStore();
  store.upsert(newSession('sid1', {
    name: 'Artisano', project: 'Artisano', tmux: 'Artisano-feature-x', branch: 'feature/x',
  }));
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid1' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seenRemove, [
    ['/home/u/Artisano/back', '/home/u/habitat-worktrees/Artisano/feature-x/back'],
    ['/home/u/Artisano/front', '/home/u/habitat-worktrees/Artisano/feature-x/front'],
    ['/home/u/Artisano', '/home/u/habitat-worktrees/Artisano/feature-x'],
  ]);
  server.close();
});

test('POST /kill de sesión plana (no worktree) no toca el worktree', async () => {
  const seenRemove = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async () => true,
  };
  const git = {
    worktreeAdd: async () => true,
    worktreeRemove: async (...a) => { seenRemove.push(a); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const store = createStore();
  // sesión plana: tmux === project, sin rama de worktree
  store.upsert(newSession('sid2', { name: 'proj-api', project: 'proj-api', tmux: 'proj-api', branch: 'main' }));
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid2' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seenRemove, []);
  server.close();
});

test('GET /projects/browse deshabilitado (sin ALLOW_SPAWN) -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects/browse`, { headers: auth });
  assert.equal(r.status, 403);
  server.close();
});

test('GET /projects/browse lista subcarpetas del root y marca isRepo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-a'));
  mkdirSync(join(root, 'proj-a', '.git'));
  mkdirSync(join(root, 'proj-b'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/browse`, { headers: auth });
    const body = await r.json();
    assert.equal(r.status, 200);
    const names = body.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['proj-a', 'proj-b']);
    assert.equal(body.entries.find((e) => e.name === 'proj-a').isRepo, true);
    assert.equal(body.entries.find((e) => e.name === 'proj-b').isRepo, false);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /projects/browse con path=.. -> 400 (no escapa del root)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/browse?path=..`, { headers: auth });
    assert.equal(r.status, 400);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /projects agrega una carpeta del root y la lista la incluye', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-c'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const dir = join(root, 'proj-c');
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir, color: PALETTE[0], chars: ['Knight'] }),
    });
    assert.equal(r.status, 200);
    const rec = await r.json();
    assert.equal(rec.name, 'proj-c');
    assert.equal(rec.color, PALETTE[0]);
    const list = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
    assert.ok(list.projects.some((p) => p.dir === dir));
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /projects acepta dir relativo al root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  mkdirSync(join(root, 'proj-rel'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'proj-rel', color: PALETTE[0] }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).name, 'proj-rel');
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /projects con dir fuera del root -> 400', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  try {
    const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [] };
    const { server } = createApp({ config: cfg, store: createStore() });
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: '/etc', color: PALETTE[0] }),
    });
    assert.equal(r.status, 400);
    server.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DELETE /projects quita de la lista', async () => {
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'] };
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 200);
  const list = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
  assert.equal(list.projects.length, 0);
  server.close();
});

test('PATCH /projects edita el color', async () => {
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'] };
  const { server } = createApp({ config: cfg, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', color: PALETTE[5] }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).color, PALETTE[5]);
  server.close();
});

test('POST /projects sin ALLOW_SPAWN -> 403', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/projects`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/x', color: PALETTE[0] }),
  });
  assert.equal(r.status, 403);
  server.close();
});

test('POST /spawn con char fuera de la allowlist del proyecto -> 400', async () => {
  const projectsStore = createProjects();
  projectsStore.add({ dir: '/home/u/proj-api', color: PALETTE[0], chars: ['Knight'] });
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: [] };
  const { server } = createApp({ config: cfg, store: createStore(), projectsStore, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Monk' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn con char dentro de la allowlist -> 200', async () => {
  const projectsStore = createProjects();
  projectsStore.add({ dir: '/home/u/proj-api', color: PALETTE[0], chars: ['Knight'] });
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS: [], WORKTREES_DIR: '/home/u/habitat-worktrees' };
  const { server } = createApp({ config: cfg, store: createStore(), projectsStore, tmux, git: fakeGit() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  server.close();
});

test('POST /sessions/order sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: ['a'] }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /sessions/order reordena el store y difunde reorder', async () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.upsert(newSession('c'));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); }); // snapshot inicial
  const reorderMsg = new Promise((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'reorder') r(m);
  }));
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ order: ['c', 'a', 'b'] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(store.all().map((s) => s.id), ['c', 'a', 'b']);
  const m = await reorderMsg;
  assert.deepEqual(m.order, ['c', 'a', 'b']);
  ws.close();
  server.close();
});

test('POST /sessions/order con body inválido -> 400', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/sessions/order`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ order: 'no-es-array' }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('GET /questbook devuelve el libro de la sesión', async () => {
  const store = createStore();
  const s = newSession('qb1', { name: 'luigi' });
  s._questbook = { synopsis: 'objetivo', quests: [{ id: 'a', title: 'a', status: 'completed' }], events: [] };
  store.upsert(s);
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=qb1`, { headers: { ...auth } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.synopsis, 'objetivo');
  assert.equal(body.quests[0].id, 'a');
  server.close();
});

test('GET /questbook 404 si la sesión no existe', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=nope`, { headers: { ...auth } });
  assert.equal(r.status, 404);
  server.close();
});

test('GET /questbook libro vacío si la sesión no tiene _questbook', async () => {
  const store = createStore();
  store.upsert(newSession('qb2', { name: 'mario' }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/questbook?id=qb2`, { headers: { ...auth } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(body, { synopsis: '', quests: [], events: [] });
  server.close();
});

// --- Login / logout / auth/me ---

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

test('GET /auth/me con cookie válida re-emite Set-Cookie con habitat_session= y Max-Age=86400', async () => {
  const { server } = appWithLogin();
  const port = await listen(server);
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'nico', password: 'clave123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`http://127.0.0.1:${port}/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const setCookie = me.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('habitat_session='), `Set-Cookie debe incluir habitat_session=, got: ${setCookie}`);
  assert.ok(setCookie.includes('Max-Age=86400'), `Set-Cookie debe incluir Max-Age=86400, got: ${setCookie}`);
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

test('GET /git/status sin token -> 401', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1`);
  assert.equal(res.status, 401);
  server.close();
});

test('GET /git/status sin sesion -> 409', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=nope`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409);
  server.close();
});

test('GET /git/diff rechaza path fuera del root -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert(newSession('s1', { cwd: dir, name: 'proj', status: 'working' }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/diff?id=s1&file=../../etc/passwd`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action ya no está detrás de un gate (stage funciona)', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store }); // config sin ALLOW_GIT_WRITE
  const port = await listen(server);
  writeFileSync(join(dir, 'b.js'), 'const b = 2\n');
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths: ['b.js'] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// Cobertura que reemplaza a la vieja 'con gate on rechaza path fuera de root': el gate
// desapareció, pero el guard sobre `paths` (ahora contra repo.dir) sigue vigente.
test('POST /git/action rechaza paths fuera del repo -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths: ['../../etc/passwd'] }),
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/branches lista locales y remotas', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/branches?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.current, 'main');
  assert.ok(body.local.some((b) => b.name === 'main' && b.current === true));
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// Nombre ajustado: con un solo commit en el repo, "acota el limit" no se
// ejerce (pasaría igual sin clamp alguno). Esta cubre el shape de la respuesta;
// el clamp real lo cubre el test siguiente.
test('GET /git/log devuelve el historial con sha/subject/autor/fecha', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/log?id=s1&limit=9999`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].subject, 'inicial');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// El test anterior no prueba el acotado a 200: con 1 solo commit, pedir
// limit=9999 y recibir 1 pasaría igual si el endpoint pasara el 9999 crudo a
// git. Este arma un historial de 206 commits con commit-tree/update-ref
// (plumbing: reusa el mismo árbol del commit inicial y no toca el working
// tree, así no hay que pagar 205 commits reales vía `git commit`) y verifica
// que el clamp real de fullLog corta en 200.
test('GET /git/log acota a 200 aunque el historial real tenga más', async () => {
  const { dir, git } = tmpRepo();
  const tree = git('write-tree').toString().trim();
  let parent = git('rev-parse', 'HEAD').toString().trim();
  for (let i = 0; i < 205; i++) {
    parent = git('commit-tree', tree, '-p', parent, '-m', `c${i}`).toString().trim();
  }
  git('update-ref', 'refs/heads/main', parent);
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/log?id=s1&limit=9999`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.length, 200); // 206 commits reales, clampeado a 200
  assert.equal(body[0].subject, 'c204'); // el más nuevo (tip) primero
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action checkout crea y cambia de rama', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const post = (body) => fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify(body),
  });
  const c = await (await post({ action: 'branch-create', branch: 'feature/x', from: 'HEAD' })).json();
  assert.equal(c.ok, true);
  const b = await (await post({ action: 'checkout', branch: 'main' })).json();
  assert.equal(b.ok, true);
  assert.equal(b.branch, 'main');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action checkout persiste el branch de la sesión y lo difunde por WS', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server, hub } = createApp({ config, store });
  const port = await listen(server);
  // Spy sobre broadcast: sin esto, borrar el store.persist()+hub.broadcast() de
  // index.js no rompería ningún test (el store.upsert solo ya alcanza para que
  // la respuesta HTTP tenga branch:'main').
  const broadcasts = [];
  const origBroadcast = hub.broadcast.bind(hub);
  hub.broadcast = (msg) => { broadcasts.push(msg); origBroadcast(msg); };
  const before = store.get('s1');
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'checkout', branch: 'main' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  // el store en memoria refleja el branch nuevo, no sólo la respuesta HTTP
  assert.equal(store.get('s1').branch, 'main');
  // …y sobre la MISMA referencia: upsertear una copia ({ ...s, branch }) reemplaza el
  // objeto sesión entero por un snapshot potencialmente viejo y descarta lo que otro
  // handler haya escrito mientras la acción git estaba en vuelo (lost update).
  assert.equal(store.get('s1'), before, 'debe mutar la sesión, no reemplazarla por una copia');
  // se difundió por WS: la card (SessionPod) pinta session.branch del snapshot,
  // no espera al próximo hook
  assert.ok(broadcasts.some((m) => m.type === 'session' && m.session.branch === 'main'));
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action bloquea una segunda escritura concurrente sobre el mismo repo -> 409', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  writeFileSync(join(dir, 'b.js'), 'const b = 2\n');
  writeFileSync(join(dir, 'c.js'), 'const c = 3\n');
  const post = (paths) => fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths }),
  });
  // Disparadas sin esperar entre sí: ambas quedan en vuelo a la vez, así que la
  // segunda en tomar el lock del repo tiene que chocar con la primera.
  const [r1, r2] = await Promise.all([post(['b.js']), post(['c.js'])]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action con acción desconocida -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'rm-rf' }),
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// El repo temporal no tiene remoto, así que prCreate corta en su propio guard
// (base === head, porque remoteDefaultBranch cae a la rama actual) y NUNCA llega a
// invocar el binario `gh`. Lo que este test cubre es que ese camino responde 200 con
// ok:false + mensaje, en vez de reventar en 500.
test('POST /git/action pr-create sin remoto -> 200 con ok:false y mensaje (no 500)', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'pr-create' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // El repo temporal no tiene remoto: falla, pero con mensaje, no con 500.
  assert.equal(body.ok, false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('stash: push, list y pop por endpoint', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const post = (body) => fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify(body),
  });
  writeFileSync(join(dir, 'a.js'), 'const a = 99\n'); // sucia el árbol
  assert.equal((await (await post({ action: 'stash-push', message: 'wip' })).json()).ok, true);
  const list = await (await fetch(`http://127.0.0.1:${port}/git/stash?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].index, 0);
  assert.ok(list[0].message.includes('wip'));
  assert.equal((await (await post({ action: 'stash-apply', index: 0 })).json()).ok, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('stash-apply con índice no numérico -> ok:false', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stash-apply', index: 'x' }),
  });
  assert.equal((await res.json()).ok, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status con path scopea al sub-repo y devuelve repo', async () => {
  const { dir, git } = tmpRepo();
  // sub-repo anidado en back/
  const back = join(dir, 'back');
  mkdirSync(back);
  const sub = (...args) => execFileSync('git', ['-C', back, ...args], { stdio: 'pipe' });
  sub('init', '-b', 'main');
  sub('config', 'user.email', 'test@local');
  sub('config', 'user.name', 'test');
  writeFileSync(join(back, 'x.js'), 'x\n');
  sub('add', '-A');
  sub('commit', '-m', 'inicial back');
  git('add', '-A'); // el padre ignora back/ o lo trackea, da igual acá

  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1&path=back`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.repo.name, 'back');
  assert.equal(body.repo.rel, 'back');
  assert.equal(body.canWrite, undefined); // el gate se fue del payload
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status con path que escapa -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1&path=../fuera`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status en un cwd sin repo git -> 409', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'habitat-norepo-'));
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409); // el cliente lo muestra como "sin repo git acá"
  assert.equal((await res.json()).reason, 'sin-repo');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- I5: el repo está ARRIBA del cwd de la sesión ---
// Una sesión arrancada en un subdirectorio del repo sigue sin acceso (s.cwd es el
// límite del sandbox y el guard no se relaja), pero el 409 tiene que decir el motivo
// real: antes la UI mostraba "sin repo git acá" cuando SÍ había repo.
test('GET /git/status con el repo por encima del cwd de la sesión -> 409 reason repo-arriba', async () => {
  const { dir } = tmpRepo();
  const sub = join(dir, 'sub');
  mkdirSync(sub);
  const store = createStore();
  store.upsert({ id: 's1', cwd: sub, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'repo-arriba');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status sin sesión -> 409 reason sin-sesion', async () => {
  const { server } = createApp({ config, store: createStore() });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=nope`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'sin-sesion');
  server.close();
});

test('GET /tree lista todo incluyendo dotfiles y .git', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, '.env'), 'X=1');
  writeFileSync(join(dir, 'README.md'), 'hi');
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/tree?id=s1`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const names = body.entries.map((e) => e.name);
  assert.ok(names.includes('.git'));
  assert.ok(names.includes('.env'));
  assert.ok(names.includes('src'));
  assert.ok(names.includes('README.md'));
  // carpetas primero
  assert.equal(body.entries[0].isDir, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /tree sin sesión -> 409; path fuera de root -> 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const r409 = await fetch(`http://127.0.0.1:${port}/tree?id=nope`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(r409.status, 409);
  const r400 = await fetch(`http://127.0.0.1:${port}/tree?id=s1&path=../../etc`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(r400.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /editor/open llama openInEditor con base/dir/file y valida path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ed-'));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir, tmux: 'p-feat' }));
  const calls = [];
  const editor = { openInEditor: async (a) => { calls.push(a); return { ok: true, tmux: 'p-feat-edit' }; } };
  const { server } = createApp({ config, store, editor });
  const port = await listen(server);
  const h = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  const ok = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, { method: 'POST', headers: h, body: JSON.stringify({ path: 'src/a.js' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], { base: 'p-feat', dir, file: 'src/a.js', cmd: config.EDITOR });

  const bad = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, { method: 'POST', headers: h, body: JSON.stringify({ path: '../../etc/passwd' }) });
  assert.equal(bad.status, 400);

  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /editor/open rechaza symlink que escapa del cwd (guard anti-symlink)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ed-sym-'));
  mkdirSync(join(dir, 'sub'));
  const calls = [];
  const editor = { openInEditor: async (a) => { calls.push(a); return { ok: true, tmux: 'p-edit' }; } };
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir, tmux: 'p-feat' }));
  const { server } = createApp({ config, store, editor });
  const port = await listen(server);
  const h = { authorization: 'Bearer secret', 'content-type': 'application/json' };

  // Caso 1: path normal dentro del worktree -> 200, editor llamado
  const ok = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, {
    method: 'POST', headers: h, body: JSON.stringify({ path: 'sub/newfile.txt' }),
  });
  assert.equal(ok.status, 200, 'path normal debe ser 200');
  assert.equal(calls.length, 1, 'editor debe haber sido llamado una vez');

  // Caso 2: escape sintáctico (../x) -> 400, editor NO llamado nuevamente
  const badSyn = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, {
    method: 'POST', headers: h, body: JSON.stringify({ path: '../../etc/passwd' }),
  });
  assert.equal(badSyn.status, 400, 'escape sintáctico debe ser 400');
  assert.equal(calls.length, 1, 'editor NO debe ser llamado para escape sintáctico');

  // Caso 3: symlink que apunta fuera del worktree (si el entorno lo permite)
  let symlinkCreated = false;
  try {
    symlinkSync('/etc', join(dir, 'escape'));
    symlinkCreated = true;
  } catch { /* sin permisos en este entorno: omitimos */ }

  if (symlinkCreated) {
    const badSym = await fetch(`http://127.0.0.1:${port}/editor/open?id=s1`, {
      method: 'POST', headers: h, body: JSON.stringify({ path: 'escape/passwd' }),
    });
    assert.equal(badSym.status, 400, 'path via symlink externo debe ser 400');
    assert.equal(calls.length, 1, 'editor NO debe ser llamado para escape via symlink');
  }

  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('/kill también mata la sesión de editor -edit', async () => {
  const killed = [];
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: '/wt/p', tmux: 'p-feat', project: 'p', branch: 'feat' }));
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async () => true,
    killTmuxSession: async (n) => { killed.push(n); return true; },
  };
  const { server } = createApp({ config: { ...config, ALLOW_SPAWN: true, WORKTREES_DIR: '' }, store, tmux });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's1' }),
  });
  assert.equal(res.status, 200);
  assert.ok(killed.includes('p-feat'), 'mata la sesión del agente');
  assert.ok(killed.includes('p-feat-edit'), 'mata la sesión de editor');
  server.close();
});

test('GET /file devuelve texto, binario y tooLarge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-'));
  writeFileSync(join(dir, 'a.txt'), 'hola mundo');
  writeFileSync(join(dir, 'bin'), Buffer.from([0x00, 0x01, 0x02]));
  writeFileSync(join(dir, 'big'), Buffer.alloc(20));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  // cap chico para forzar tooLarge en 'big'
  const { server } = createApp({ config: { ...config, FILE_MAX_BYTES: 10 }, store });
  const port = await listen(server);
  const h = { authorization: 'Bearer secret' };

  const txt = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=a.txt`, { headers: h })).json();
  assert.equal(txt.text, 'hola mundo');

  const bin = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=bin`, { headers: h })).json();
  assert.equal(bin.binary, true);

  const big = await (await fetch(`http://127.0.0.1:${port}/file?id=s1&path=big`, { headers: h })).json();
  assert.equal(big.tooLarge, true);

  const bad = await fetch(`http://127.0.0.1:${port}/file?id=s1&path=../x`, { headers: h });
  assert.equal(bad.status, 400);

  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /tree marca isRepo en carpetas que son repos, no en .git', async () => {
  const { dir } = tmpRepo();
  mkdirSync(join(dir, 'back'));
  mkdirSync(join(dir, 'back', '.git'));
  mkdirSync(join(dir, 'docs'));
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/tree?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  const body = await res.json();
  const byName = Object.fromEntries(body.entries.map((e) => [e.name, e]));
  assert.equal(byName.back.isRepo, true);
  assert.equal(byName.docs.isRepo, false);
  assert.equal(byName['.git'].isRepo, false); // el .git del repo raíz no se marca
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- POST /files/upload -------------------------------------------------

function uploadFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'upload-'));
  const store = createStore();
  store.upsert(newSession('s1', { name: 'p', cwd: dir }));
  const { server } = createApp({ config: { ...config, ...overrides }, store });
  return { dir, store, server };
}

test('POST /files/upload dentro del cap escribe el archivo en .habitat-uploads', async () => {
  const { dir, server } = uploadFixture({ UPLOAD_MAX_BYTES: 1024 });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/files/upload?id=s1`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'x-filename': encodeURIComponent('dump.sql') },
    body: 'CREATE TABLE t (id int);',
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rel, join('.habitat-uploads', 'dump.sql'));
  assert.equal(readFileSync(join(dir, '.habitat-uploads', 'dump.sql'), 'utf8'), 'CREATE TABLE t (id int);');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /files/upload que excede el cap responde 413, sin cortar la conexión', async () => {
  const { dir, server } = uploadFixture({ UPLOAD_MAX_BYTES: 1024 });
  const port = await listen(server);
  // 4MB contra un cap de 1KB: el server tiene que contestar sin destruir el socket,
  // o el cliente (y el proxy de Tailscale delante) ve un ECONNRESET -> 502.
  const res = await fetch(`http://127.0.0.1:${port}/files/upload?id=s1`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'x-filename': 'dump.sql' },
    body: Buffer.alloc(4 * 1024 * 1024, 0x41),
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.equal(body.max, 1024);
  assert.equal(body.needsPassword, false); // sin UPLOAD_PASSWORD, reintentar no sirve
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /files/upload que excede el cap no deja archivos a medio escribir', async () => {
  const { dir, server } = uploadFixture({ UPLOAD_MAX_BYTES: 1024 });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/files/upload?id=s1`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'x-filename': 'dump.sql' },
    body: Buffer.alloc(4 * 1024 * 1024, 0x41),
  }).catch(() => {});
  assert.deepEqual(readdirSync(join(dir, '.habitat-uploads')), []);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /files/upload: con UPLOAD_PASSWORD el 413 avisa que hay bypass, y la password lo levanta', async () => {
  const { dir, server } = uploadFixture({ UPLOAD_MAX_BYTES: 1024, UPLOAD_PASSWORD: 'sec' });
  const port = await listen(server);
  const big = Buffer.alloc(4 * 1024 * 1024, 0x41);

  const sinPw = await fetch(`http://127.0.0.1:${port}/files/upload?id=s1`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'x-filename': 'dump.sql' }, body: big,
  });
  assert.equal(sinPw.status, 413);
  assert.equal((await sinPw.json()).needsPassword, true);

  const conPw = await fetch(`http://127.0.0.1:${port}/files/upload?id=s1`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'x-filename': 'dump.sql', 'x-upload-password': 'sec' },
    body: big,
  });
  assert.equal(conPw.status, 200);
  assert.equal(statSync(join(dir, '.habitat-uploads', 'dump.sql')).size, big.length);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- docker: limpieza de containers de la sesión -------------------------------------

const fakeDocker = (over = {}) => ({ downForDir: async () => [], downOrphans: async () => [], ...over });

test('POST /kill de sesión por rama baja los stacks docker antes de remover el worktree', async () => {
  const order = [];
  const seenDocker = [];
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = {
    findNestedRepos: async () => [],
    worktreeRemove: async () => { order.push('worktree'); return true; },
  };
  const docker = fakeDocker({
    downForDir: async (dir, opts) => { order.push('docker'); seenDocker.push([dir, opts]); return ['artisano-feature-x']; },
  });
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', PROJECTS: ['/home/u/Artisano'], DOCKER_CLEANUP: true });
  const store = createStore();
  store.upsert(newSession('sid1', {
    name: 'Artisano', project: 'Artisano', tmux: 'Artisano-feature-x', branch: 'feature/x',
  }));
  const { server } = createApp({ config: cfg, store, tmux, git, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid1' }),
  });
  assert.equal(r.status, 200);
  assert.equal(seenDocker.length, 1);
  assert.equal(seenDocker[0][0], '/home/u/habitat-worktrees/Artisano/feature-x');
  assert.equal(seenDocker[0][1].root, '/home/u/habitat-worktrees');
  // El docker-compose.yml vive en el worktree: hay que bajar ANTES de borrarlo.
  assert.deepEqual(order, ['docker', 'worktree']);
  server.close();
});

test('POST /kill de sesión plana no toca docker (el stack es del usuario, no de hábitat)', async () => {
  let called = false;
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = { worktreeRemove: async () => true };
  const docker = fakeDocker({ downForDir: async () => { called = true; return []; } });
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', DOCKER_CLEANUP: true });
  const store = createStore();
  store.upsert(newSession('sid2', { name: 'proj-api', project: 'proj-api', tmux: 'proj-api', branch: 'main' }));
  const { server } = createApp({ config: cfg, store, tmux, git, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid2' }),
  });
  assert.equal(r.status, 200);
  assert.equal(called, false);
  server.close();
});

test('POST /kill con DOCKER_CLEANUP off no baja containers', async () => {
  let called = false;
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = { findNestedRepos: async () => [], worktreeRemove: async () => true };
  const docker = fakeDocker({ downForDir: async () => { called = true; return []; } });
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', DOCKER_CLEANUP: false });
  const store = createStore();
  store.upsert(newSession('sid3', { name: 'p', project: 'p', tmux: 'p-x', branch: 'x' }));
  const { server } = createApp({ config: cfg, store, tmux, git, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid3' }),
  });
  assert.equal(r.status, 200);
  assert.equal(called, false);
  server.close();
});

test('POST /kill sigue devolviendo 200 si docker falla', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true, killTmuxSession: async () => true };
  const git = { findNestedRepos: async () => [], worktreeRemove: async () => true };
  const docker = fakeDocker({ downForDir: async () => { throw new Error('daemon caído'); } });
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees', DOCKER_CLEANUP: true });
  const store = createStore();
  store.upsert(newSession('sid4', { name: 'p', project: 'p', tmux: 'p-x', branch: 'x' }));
  const { server } = createApp({ config: cfg, store, tmux, git, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/kill`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid4' }),
  });
  assert.equal(r.status, 200);
  server.close();
});

test('GET /docker/status lista los stacks de la sesión sin bajarlos', async () => {
  const seen = [];
  const docker = fakeDocker({ downForDir: async (dir, opts) => { seen.push([dir, opts]); return ['artisano-x']; } });
  const store = createStore();
  store.upsert(newSession('sid1', { name: 'Artisano', project: 'Artisano', tmux: 'Artisano-x', branch: 'x' }));
  const { server } = createApp({ config: spawnConfig(), store, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/docker/status?id=sid1`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stacks: ['artisano-x'] });
  assert.equal(seen[0][0], '/home/u/habitat-worktrees/Artisano/x');
  assert.equal(seen[0][1].dryRun, true);
  server.close();
});

test('GET /docker/status de sesión plana -> stacks vacío sin consultar docker', async () => {
  let called = false;
  const docker = fakeDocker({ downForDir: async () => { called = true; return ['x']; } });
  const store = createStore();
  store.upsert(newSession('sid2', { name: 'p', project: 'p', tmux: 'p', branch: 'main' }));
  const { server } = createApp({ config: spawnConfig(), store, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/docker/status?id=sid2`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stacks: [] });
  assert.equal(called, false);
  server.close();
});

test('POST /docker/down baja los stacks de la sesión y devuelve los nombres', async () => {
  const seen = [];
  const docker = fakeDocker({ downForDir: async (dir, opts) => { seen.push([dir, opts]); return ['a', 'b']; } });
  const store = createStore();
  store.upsert(newSession('sid1', { name: 'Artisano', project: 'Artisano', tmux: 'Artisano-x', branch: 'x' }));
  const { server } = createApp({ config: spawnConfig(), store, docker });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/docker/down`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sid1' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stacks: ['a', 'b'] });
  assert.equal(seen[0][1].dryRun, false);
  server.close();
});

test('POST /docker/down id desconocido -> 404', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore(), docker: fakeDocker() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/docker/down`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope' }),
  });
  assert.equal(r.status, 404);
  server.close();
});

test('docker endpoints sin ALLOW_SPAWN -> 403', async () => {
  const { server } = createApp({ config, store: createStore(), docker: fakeDocker() });
  const port = await listen(server);
  const a = await fetch(`http://127.0.0.1:${port}/docker/status?id=x`, { headers: auth });
  const b = await fetch(`http://127.0.0.1:${port}/docker/down`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x' }),
  });
  assert.equal(a.status, 403);
  assert.equal(b.status, 403);
  server.close();
});

test('docker endpoints sin token -> 401', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore(), docker: fakeDocker() });
  const port = await listen(server);
  const a = await fetch(`http://127.0.0.1:${port}/docker/status?id=x`);
  const b = await fetch(`http://127.0.0.1:${port}/docker/down`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x' }),
  });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  server.close();
});

// --- Clonar repos de owners whitelisteados ---

function cloneSetup({ gh, owners = ['MNONM-SOFTWARE', 'squanchymnonm'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'habitat-root-'));
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: root, PROJECTS: [], CLONE_OWNERS: owners };
  const { server } = createApp({ config: cfg, store: createStore(), gh });
  return { root, server };
}
const postClone = (port, body) => fetch(`http://127.0.0.1:${port}/projects/clone`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('GET /projects expone canClone sólo con whitelist', async () => {
  const { root, server } = cloneSetup();
  try {
    const port = await listen(server);
    const body = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
    assert.equal(body.canClone, true);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
  const { root: root2, server: server2 } = cloneSetup({ owners: [] });
  try {
    const port = await listen(server2);
    const body = await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: auth })).json();
    assert.equal(body.canClone, false);
  } finally { server2.close(); rmSync(root2, { recursive: true, force: true }); }
});

test('GET /projects/repos junta los owners, marca cloned y reporta errores por owner', async () => {
  const gh = {
    repoList: async (owner) => owner === 'squanchymnonm'
      ? { ok: false, message: 'boom' }
      : { ok: true, repos: [
        { name: 'viejo', nameWithOwner: 'MNONM-SOFTWARE/viejo', description: '', isPrivate: false, updatedAt: '2025-01-01T00:00:00Z' },
        { name: 'nuevo', nameWithOwner: 'MNONM-SOFTWARE/nuevo', description: 'd', isPrivate: true, updatedAt: '2026-01-01T00:00:00Z' },
      ] },
  };
  const { root, server } = cloneSetup({ gh });
  mkdirSync(join(root, 'viejo'));
  try {
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/repos`, { headers: auth });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.repos.map((x) => [x.nameWithOwner, x.cloned]), [
      ['MNONM-SOFTWARE/nuevo', false],
      ['MNONM-SOFTWARE/viejo', true],
    ]);
    assert.deepEqual(body.errors, [{ owner: 'squanchymnonm', message: 'boom' }]);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('GET /projects/repos sin whitelist -> 403', async () => {
  const { root, server } = cloneSetup({ owners: [] });
  try {
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/projects/repos`, { headers: auth });
    assert.equal(r.status, 403);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('POST /projects/clone clona un repo whitelisteado (owner case-insensitive) en el root', async () => {
  let called;
  const gh = { repoClone: async (repo, dest) => { called = { repo, dest }; mkdirSync(dest); return { ok: true }; } };
  const { root, server } = cloneSetup({ gh });
  try {
    const port = await listen(server);
    const r = await postClone(port, { repo: 'mnonm-software/habitat' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.rel, 'habitat');
    assert.equal(called.repo, 'mnonm-software/habitat');
    assert.equal(called.dest, join(realpathSync(root), 'habitat'));
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('POST /projects/clone rechaza owners fuera de la whitelist (403) y formatos inválidos (400)', async () => {
  let called = false;
  const gh = { repoClone: async () => { called = true; return { ok: true }; } };
  const { root, server } = cloneSetup({ gh });
  try {
    const port = await listen(server);
    assert.equal((await postClone(port, { repo: 'evil/habitat' })).status, 403);
    assert.equal((await postClone(port, { repo: 'MNONM-SOFTWARE/..' })).status, 400);
    assert.equal((await postClone(port, { repo: 'MNONM-SOFTWARE/a/b' })).status, 400);
    assert.equal(called, false);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('POST /projects/clone con destino existente -> 409', async () => {
  let called = false;
  const gh = { repoClone: async () => { called = true; return { ok: true }; } };
  const { root, server } = cloneSetup({ gh });
  mkdirSync(join(root, 'habitat'));
  try {
    const port = await listen(server);
    assert.equal((await postClone(port, { repo: 'squanchymnonm/habitat' })).status, 409);
    assert.equal(called, false);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('POST /projects/clone fallido borra la carpeta a medio crear y devuelve el mensaje', async () => {
  const gh = { repoClone: async (repo, dest) => { mkdirSync(dest); writeFileSync(join(dest, 'x'), ''); return { ok: false, message: 'repo not found' }; } };
  const { root, server } = cloneSetup({ gh });
  try {
    const port = await listen(server);
    const r = await postClone(port, { repo: 'squanchymnonm/habitat' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, message: 'repo not found' });
    assert.equal(existsSync(join(root, 'habitat')), false);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('POST /projects/clone en paralelo al mismo destino -> el segundo 409', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const gh = { repoClone: async (repo, dest) => { await gate; mkdirSync(dest); return { ok: true }; } };
  const { root, server } = cloneSetup({ gh });
  try {
    const port = await listen(server);
    const first = postClone(port, { repo: 'squanchymnonm/habitat' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await postClone(port, { repo: 'squanchymnonm/habitat' })).status, 409);
    release();
    assert.equal((await first).status, 200);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

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
const jsonReq = (port, method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { ...auth, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
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

const killReq = (port, id) => fetch(`http://127.0.0.1:${port}/kill`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id }),
});

test('POST /kill con un relacionado sucio conserva su trabajo y el worktree principal', async () => {
  const f = infraSetup();
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    assert.equal((await spawnReq(port, { dir: f.back, name: 'bob' })).status, 200);
    const wt = join(f.root, 'wt', 'back', 'bob');
    const sucio = join(wt, RELATED_DIR, 'infra', 'sucio.txt');
    writeFileSync(sucio, 'wip');
    assert.equal((await killReq(port, 'pending:back-bob')).status, 200);
    assert.equal(readFileSync(sucio, 'utf8'), 'wip');
    assert.ok(existsSync(join(wt, 'README.md'))); // el principal sigue en disco
    assert.match(execFileSync('git', ['-C', f.docker, 'branch', '--list', 'bob']).toString(), /bob/);
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

test('POST /spawn libera los puertos reservados si prepareSession falla después de asignarlos', async () => {
  const f = infraSetup();
  f.cfg.PORT_RANGE = [41000, 41000]; // un solo puerto: si se filtra, el segundo spawn no puede asignar ninguno
  // Symlink colgante commiteado en el repo 'docker': al crear el worktree relacionado para
  // 'bob', ese symlink se checkoutea tal cual -> prepareSession lo detecta (lstat) y falla
  // en la fase de escritura, DESPUÉS de haber asignado el puerto 'db'.
  symlinkSync('/nonexistent-habitat-test/.env', join(f.docker, '.env'));
  execFileSync('git', ['-C', f.docker, 'add', '-A']);
  execFileSync('git', ['-C', f.docker, 'commit', '-m', 'symlink colgante']);
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const r1 = await spawnReq(port, { dir: f.back, name: 'bob' });
    assert.equal(r1.status, 500);
    assert.match((await r1.json()).error, /ruta inválida/);
    // Reapuntamos la plantilla .env a una ruta sin symlink, para que el segundo spawn
    // pueda escribir sin chocar con el mismo problema (lo único que probamos acá es que
    // el puerto 'db' que el primer intento alcanzó a reservar haya quedado libre).
    f.projectsStore.update({ dir: f.back, envFiles: [{ repo: 'infra', path: 'cfg/.env' }] });
    f.envStore.set('back', 'infra', 'cfg/.env', 'DB_PORT={{port:db}}\n');
    const r2 = await spawnReq(port, { dir: f.back, name: 'ana' });
    assert.equal(r2.status, 200);
    assert.equal(store.get('pending:back-ana').infra.ports.db, 41000);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('POST /spawn concurrentes del mismo proyecto no compiten por el mismo puerto', async () => {
  const f = infraSetup();
  const store = createStore();
  const { server } = createApp({ config: f.cfg, store, projectsStore: f.projectsStore, envStore: f.envStore, tmux: f.tmux });
  try {
    const port = await listen(server);
    const [r1, r2] = await Promise.all([
      spawnReq(port, { dir: f.back, name: 'bob' }),
      spawnReq(port, { dir: f.back, name: 'ana' }),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.notEqual(store.get('pending:back-bob').infra.ports.db, store.get('pending:back-ana').infra.ports.db);
  } finally { server.close(); rmSync(f.root, { recursive: true, force: true }); }
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

test('PATCH /projects rechaza infra/related en un proyecto contenedor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habitat-container-'));
  const container = join(root, 'proyectos', 'container');
  mkdirSync(container, { recursive: true }); // el contenedor en sí NO es un repo git
  initRepoAt(join(container, 'a'));
  initRepoAt(join(container, 'b'));
  const projectsStore = createProjects({ seed: [container] });
  const cfg = { ...config, ALLOW_SPAWN: true, PROJECTS_ROOT: join(root, 'proyectos'), PROJECTS: [] };
  const { server } = createApp({ config: cfg, store: createStore(), projectsStore, envStore: createEnvStore() });
  try {
    const port = await listen(server);
    const r = await jsonReq(port, 'PATCH', '/projects', { dir: container, infra: { repo: 'self', path: '', up: '', down: '' } });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'un proyecto contenedor no admite relacionados ni infra' });
    assert.equal(projectsStore.get(container).infra, null);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});
