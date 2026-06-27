import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachWs } from './ws.js';
import { createSessionStore } from './sessions.js';
import { createApp } from './index.js';

const config = { TOKEN: '', USER: '', PASSWORD_HASH: '', COOKIE_SECURE: false, SESSION_TTL_MS: 86400000 };

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}
function nextMsg(ws) {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))));
}

test('al conectar manda snapshot; broadcast llega', async () => {
  const store = createStore();
  store.upsert(newSession('a', { name: 'api' }));
  const server = createServer();
  const hub = attachWs(server, store, { token: '' });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgPromise = nextMsg(ws);
  await new Promise((r) => ws.once('open', r));
  const snap = await msgPromise;
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.sessions[0].name, 'api');

  const p = nextMsg(ws);
  hub.broadcast({ type: 'session', session: { id: 'b' } });
  const m = await p;
  assert.equal(m.type, 'session');
  assert.equal(m.session.id, 'b');

  ws.close(); hub.close(); server.close();
});

test('un mensaje chat del cliente invoca onChat(id, text)', async () => {
  const store = createStore();
  const server = createServer();
  const seen = [];
  const hub = attachWs(server, store, { token: '', onChat: (id, text) => seen.push([id, text]) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const snapPromise = nextMsg(ws); // adjuntar listener antes del open (evita perder el snapshot)
  await new Promise((r) => ws.once('open', r));
  await snapPromise; // descartar snapshot
  ws.send(JSON.stringify({ type: 'chat', id: 's1', text: 'hola' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, [['s1', 'hola']]);

  ws.close(); hub.close(); server.close();
});

test('un mensaje dismiss del cliente invoca onDismiss(id)', async () => {
  const store = createStore();
  const server = createServer();
  const seen = [];
  const hub = attachWs(server, store, { token: '', onDismiss: (id) => seen.push(id) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const snapPromise = nextMsg(ws);
  await new Promise((r) => ws.once('open', r));
  await snapPromise; // descartar snapshot
  ws.send(JSON.stringify({ type: 'dismiss', id: 's1' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ['s1']);

  ws.close(); hub.close(); server.close();
});

test('token inválido cierra la conexión', async () => {
  const store = createStore();
  const server = createServer();
  const hub = attachWs(server, store, { token: 'secret' });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});

test('/ws acepta conexión con cookie de sesión válida', async () => {
  const sessionStore = createSessionStore({ ttlMs: 100000 });
  const id = sessionStore.create('nico');
  const { server } = createApp({ config: { ...config, USER: 'nico', PASSWORD_HASH: 'x', COOKIE_SECURE: false }, store: createStore(), sessionStore });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `habitat_session=${id}` } });
  await new Promise((r, rej) => { ws.once('message', () => r()); ws.once('error', rej); });
  ws.close(); server.close();
});

test('/ws rechaza sin cookie ni token', async () => {
  // TOKEN: 'secret' activa la guardia de auth; la conexión sin cookie ni token → 1008.
  const { server } = createApp({ config: { ...config, TOKEN: 'secret', USER: 'nico', PASSWORD_HASH: 'x' }, store: createStore(), sessionStore: createSessionStore({}) });
  const port = await listen(server);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const closed = await new Promise((r) => ws.on('close', (code) => r(code)));
  assert.equal(closed, 1008);
  server.close();
});
