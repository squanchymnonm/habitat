import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { createApp } from './index.js';
import { createSettings } from './settings.js';

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

const spawnConfig = (over) => ({ ...config, ALLOW_SPAWN: true, PROJECTS: ['/home/u/proj-api'], ...over });
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
  assert.deepEqual(body.projects, [{ name: 'proj-api', dir: '/home/u/proj-api' }]);
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

test('POST /spawn colisión -> 409', async () => {
  const tmux = { listSessions: async () => ['proj-api'], newTmuxSession: async () => true };
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /spawn OK -> 200 con name; invoca newTmuxSession', async () => {
  const seen = [];
  const tmux = {
    listSessions: async () => [],
    newTmuxSession: async (name, dir) => { seen.push([name, dir]); return true; },
  };
  const { server } = createApp({ config: spawnConfig(), store: createStore(), tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api');
  assert.deepEqual(seen, [['proj-api', '/home/u/proj-api']]);
  server.close();
});

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

test('POST /spawn con branch crea pod provisional pending:<tmux> en el store', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => true };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const store = createStore();
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x', char: 'Knight' }),
  });
  const prov = store.get('pending:proj-api-feature-x');
  assert.ok(prov, 'debe existir el pod provisional');
  assert.equal(prov.tmux, 'proj-api-feature-x');
  assert.equal(prov.branch, 'feature/x');
  assert.equal(prov.status, 'waiting');
  assert.equal(prov.char, 'Knight');
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

test('POST /spawn branch con prefijo - (flag smuggling) -> 400', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => true };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: '--force' }),
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

test('POST /spawn con branch + char válido -> setPendingChar(tmuxName) y 200', async () => {
  const store = createStore();
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { worktreeAdd: async () => true };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store, tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  assert.equal(store.takePendingChar('proj-api-feature-x'), 'Knight');
  server.close();
});

test('POST /spawn con char inválido -> 400', async () => {
  const { server } = createApp({ config: spawnConfig(), store: createStore() });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'NoExiste' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /spawn con char válido -> setPendingChar(name, char) y 200', async () => {
  const store = createStore();
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const { server } = createApp({ config: spawnConfig(), store, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', char: 'Knight' }),
  });
  assert.equal(r.status, 200);
  assert.equal(store.takePendingChar('proj-api'), 'Knight');
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
  const { server } = createApp({ config: spawnConfig(), store: createStore(), settingsStore, tmux });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [['proj-api', '/home/u/proj-api', { permissionMode: 'plan' }]]);
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
  const git = {
    findNestedRepos: async () => ['back', 'front'],
    containerWorktreeAdd: async (...a) => { seenContainer.push(a); return true; },
  };
  const cfg = spawnConfig({ WORKTREES_DIR: '/home/u/habitat-worktrees' });
  const { server } = createApp({ config: cfg, store: createStore(), tmux, git });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '/home/u/proj-api', branch: 'feature/x' }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.name, 'proj-api-feature-x');
  assert.deepEqual(seenContainer, [[
    '/home/u/proj-api', 'feature/x', '/home/u/habitat-worktrees/proj-api/feature-x', ['back', 'front'],
  ]]);
  assert.deepEqual(seenTmux, [['proj-api-feature-x', '/home/u/habitat-worktrees/proj-api/feature-x']]);
  server.close();
});

test('POST /spawn de contenedor: fallo de containerWorktreeAdd -> 500', async () => {
  const tmux = { listSessions: async () => [], newTmuxSession: async () => true };
  const git = { findNestedRepos: async () => ['back'], containerWorktreeAdd: async () => false };
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
