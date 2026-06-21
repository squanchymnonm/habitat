import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachTerm } from './term.js';

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

// PTY falso: registra writes/resizes y permite empujar data hacia el cliente.
function fakePtyFactory(log) {
  return (target, opts) => {
    log.target = target;
    log.opts = opts;
    let onData = () => {};
    log.push = (s) => onData(s);
    return {
      onData: (cb) => { onData = cb; },
      onExit: () => {},
      write: (d) => log.writes.push(d),
      resize: (c, r) => log.resizes.push([c, r]),
      kill: () => { log.killed = true; },
    };
  };
}

test('attachTerm: stdout del pty llega al cliente; input binario va a write; resize va a resize', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const log = { writes: [], resizes: [] };
  const hub = attachTerm(server, store, { token: '', spawnPty: fakePtyFactory(log) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1`);
  await new Promise((r) => ws.once('open', r));
  assert.equal(log.target, 'api'); // attacheó a la sesión por nombre

  // pty -> cliente
  const got = new Promise((r) => ws.once('message', (d) => r(d.toString())));
  log.push('hola\r\n');
  assert.equal(await got, 'hola\r\n');

  // cliente (binario) -> pty.write
  ws.send(Buffer.from('ls\r'));
  // cliente (texto json) -> pty.resize
  ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(log.writes.join(''), 'ls\r');
  assert.deepEqual(log.resizes, [[80, 24]]);

  ws.close(); hub.close(); server.close();
});

test('attachTerm: token inválido cierra con 1008', async () => {
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const hub = attachTerm(server, store, { token: 'secret', spawnPty: fakePtyFactory({ writes: [], resizes: [] }) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1&token=wrong`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});

test('attachTerm: id desconocido cierra con 1008', async () => {
  const store = createStore();
  const server = createServer();
  const hub = attachTerm(server, store, { token: '', spawnPty: fakePtyFactory({ writes: [], resizes: [] }) });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=nope`);
  const code = await new Promise((r) => ws.once('close', (c) => r(c)));
  assert.equal(code, 1008);

  hub.close(); server.close();
});
