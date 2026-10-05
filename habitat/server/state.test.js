import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { newSession, createStore, questFromTodos } from './state.js';

function tmpStatePath(tag) {
  return join(tmpdir(), `habitat-state-${process.pid}-${tag}.json`);
}

test('newSession aplica defaults RPG', () => {
  const s = newSession('abc', { name: 'api' });
  assert.equal(s.id, 'abc');
  assert.equal(s.name, 'api');
  assert.equal(s.status, 'idle');
  assert.equal(s.stamina, 100);
});

test('store upsert/get/remove/all', () => {
  const store = createStore();
  store.upsert(newSession('a', { name: 'a' }));
  assert.equal(store.get('a').name, 'a');
  store.upsert(newSession('a', { name: 'a2' }));
  assert.equal(store.get('a').name, 'a2');
  assert.equal(store.all().length, 1);
  store.remove('a');
  assert.equal(store.get('a'), undefined);
});

test('snapshot oculta campos internos (_)', () => {
  const store = createStore();
  store.upsert(newSession('a', { _questbook: { synopsis: '', quests: [], events: [] } }));
  const snap = store.snapshot();
  assert.equal(snap.length, 1);
  assert.equal('_questbook' in snap[0], false);
  assert.equal('stamina' in snap[0], true);
});

test('persistencia: persist() escribe y un store nuevo recarga las sesiones', () => {
  const path = tmpStatePath('reload');
  rmSync(path, { force: true });
  try {
    const a = createStore({ persistPath: path });
    a.upsert(newSession('s1', { name: 'api', status: 'working', stamina: 42 }));
    a.upsert(newSession('s2', { name: 'web' }));
    a.persist();
    assert.ok(existsSync(path), 'debería haber escrito el archivo');

    const b = createStore({ persistPath: path });
    assert.equal(b.all().length, 2);
    assert.equal(b.get('s1').name, 'api');
    assert.equal(b.get('s1').stamina, 42);
    assert.equal(b.get('s2').name, 'web');
  } finally {
    rmSync(path, { force: true });
  }
});

test('persistencia: remove() también persiste', () => {
  const path = tmpStatePath('remove');
  rmSync(path, { force: true });
  try {
    const a = createStore({ persistPath: path });
    a.upsert(newSession('s1', {}));
    a.persist();
    a.remove('s1');
    const b = createStore({ persistPath: path });
    assert.equal(b.get('s1'), undefined);
    assert.equal(b.all().length, 0);
  } finally {
    rmSync(path, { force: true });
  }
});

test('persistencia: sin persistPath funciona igual (persist es no-op)', () => {
  const store = createStore();
  store.upsert(newSession('a', {}));
  assert.doesNotThrow(() => store.persist());
  assert.equal(store.all().length, 1);
});

test('questFromTodos cuenta total y done', () => {
  const todos = [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'in_progress' },
  ];
  assert.deepEqual(questFromTodos(todos), { total: 3, done: 2 });
});

test('pending char: set y take (one-shot)', () => {
  const store = createStore();
  store.setPendingChar('api', 'Knight');
  assert.equal(store.takePendingChar('api'), 'Knight');
  assert.equal(store.takePendingChar('api'), undefined); // one-shot: el segundo take no reusa
});

test('pending char: take de inexistente -> undefined', () => {
  const store = createStore();
  assert.equal(store.takePendingChar('nope'), undefined);
});

test('reorder deja el Map en el orden pedido; sobrevivientes al final', () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.upsert(newSession('c'));
  store.reorder(['c', 'a']); // 'b' no mencionado
  assert.deepEqual(store.all().map((s) => s.id), ['c', 'a', 'b']);
});

test('reorder ignora ids inexistentes', () => {
  const store = createStore();
  store.upsert(newSession('a'));
  store.upsert(newSession('b'));
  store.reorder(['x', 'b', 'a']);
  assert.deepEqual(store.all().map((s) => s.id), ['b', 'a']);
});

test('store.getUsage default null; setUsage guarda', () => {
  const s = createStore({});
  assert.equal(s.getUsage(), null);
  s.setUsage({ pct: 40, resetAt: 123 });
  assert.deepEqual(s.getUsage(), { pct: 40, resetAt: 123 });
});

test('reviveSession descarta campos de combate persistidos', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'habitat-state-'));
  const p = join(dir, 's.json');
  writeFileSync(p, JSON.stringify([{ id: 's1', name: 'x', monster: { type: 'm', label: 'l' }, combat: { hits: 1, tokens: 2 }, _touched: ['/a'], _lastTotal: 9 }]));
  try {
    const store = createStore({ persistPath: p });
    const s = store.get('s1');
    for (const k of ['monster', 'combat', '_touched', '_lastTotal']) assert.equal(k in s, false, k);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
