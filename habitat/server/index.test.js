import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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

const config = { PORT: 0, BIND: '127.0.0.1', TOKEN: 'secret', PREVIEW_LINES: 5, MAX_CONTEXT: 200000 };

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
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
  assert.deepEqual(killed, ['proj-api']);
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
