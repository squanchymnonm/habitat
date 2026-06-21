import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createStore } from './state.js';
import { createApp } from './index.js';

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

// Simula el ciclo real: el server recibe un hook y lo persiste; al "reiniciar"
// (un store nuevo desde el mismo archivo) la sesión sigue en la GUI.
test('un hook persiste y sobrevive al reinicio del server', async () => {
  const path = join(tmpdir(), `habitat-persist-e2e-${process.pid}.json`);
  rmSync(path, { force: true });
  const config = { PORT: 0, BIND: '127.0.0.1', TOKEN: 'secret', PREVIEW_LINES: 5, MAX_CONTEXT: 200000, STATE_PATH: path };
  try {
    const store = createStore({ persistPath: path });
    const { server } = createApp({ config, store });
    const port = await listen(server);
    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/home/u/api' }),
    });
    assert.equal(res.status, 204);
    server.close();

    // "reinicio": store nuevo desde el mismo archivo
    const reloaded = createStore({ persistPath: path });
    assert.equal(reloaded.get('s1')?.name, 'api');
    assert.equal(reloaded.snapshot().length, 1);
  } finally {
    rmSync(path, { force: true });
  }
});
