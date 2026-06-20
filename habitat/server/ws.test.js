import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachWs } from './ws.js';

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
