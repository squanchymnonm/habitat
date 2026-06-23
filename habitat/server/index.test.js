import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { createApp } from './index.js';

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
