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
