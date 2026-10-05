import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { allocatePorts, usedPorts, probePort } from './ports.js';

test('allocatePorts asigna en orden, salteando usados y ocupados', async () => {
  const busy = new Set([20002]);
  const probe = async (p) => !busy.has(p);
  const r = await allocatePorts(['app', 'db', 'web'], { range: [20000, 20010], used: new Set([20000]), probe });
  assert.deepEqual(r, { ok: true, ports: { app: 20001, db: 20003, web: 20004 } });
});

test('allocatePorts sin nombres no prueba nada', async () => {
  const r = await allocatePorts([], { range: [20000, 20000], probe: async () => { throw new Error('no'); } });
  assert.deepEqual(r, { ok: true, ports: {} });
});

test('allocatePorts falla con el rango agotado', async () => {
  const r = await allocatePorts(['a', 'b'], { range: [20000, 20000], probe: async () => true });
  assert.deepEqual(r, { ok: false, error: 'no hay puertos libres en 20000-20000' });
});

test('usedPorts junta los puertos de las sesiones con infra', () => {
  const s = [{ infra: { ports: { app: 1, db: 2 } } }, {}, { infra: { ports: {} } }];
  assert.deepEqual([...usedPorts(s)].sort(), [1, 2]);
});

test('probePort detecta un puerto ocupado', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '0.0.0.0', r));
  const { port } = srv.address();
  assert.equal(await probePort(port), false);
  await new Promise((r) => srv.close(r));
  assert.equal(await probePort(port), true);
});
