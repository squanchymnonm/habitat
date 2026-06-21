import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
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
