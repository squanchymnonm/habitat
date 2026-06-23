import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createStore, newSession } from './state.js';
import { attachTerm, attachArgs } from './term.js';

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

test('attachArgs encadena set-option mouse on antes del attach, sobre el socket dedicado', () => {
  assert.deepEqual(
    attachArgs('api'),
    ['-L', 'habitat', 'set-option', '-t', 'api', 'mouse', 'on', ';', 'attach-session', '-t', 'api'],
  );
});

test('attachTerm: un PTY que tira en write/resize NO propaga (no tumba el server)', async () => {
  // Regresión: un fd de PTY muerto hacía `pty.resize` tirar EBADF; la excepción salía del
  // handler de 'message' -> uncaughtException -> caía todo el server (y todas las sesiones).
  const store = createStore();
  store.upsert(newSession('s1', { name: 'api' }));
  const server = createServer();
  const boom = () => { throw new Error('ioctl(2) failed, EBADF'); };
  const spawnPty = () => ({
    onData: () => {}, onExit: () => {}, kill: () => {},
    write: boom, resize: boom,
  });
  const hub = attachTerm(server, store, { token: '', spawnPty });
  const port = await listen(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/term?id=s1`);
  await new Promise((r) => ws.once('open', r));
  // Estos antes reventaban el proceso; ahora se tragan.
  ws.send(Buffer.from('ls\r'));
  ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  await new Promise((r) => setTimeout(r, 50));
  // Si seguimos vivos y el ws sigue abierto, el handler no propagó.
  assert.equal(ws.readyState, WebSocket.OPEN);

  ws.close(); hub.close(); server.close();
});
