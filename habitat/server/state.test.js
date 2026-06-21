import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { newSession, createStore, hashType, monsterFromTodos, questFromTodos } from './state.js';

function tmpStatePath(tag) {
  return join(tmpdir(), `habitat-state-${process.pid}-${tag}.json`);
}

test('newSession aplica defaults RPG', () => {
  const s = newSession('abc', { name: 'api' });
  assert.equal(s.id, 'abc');
  assert.equal(s.name, 'api');
  assert.equal(s.status, 'idle');
  assert.equal(s.stamina, 100);
  assert.equal(s.monster, null);
  assert.deepEqual(s.combat, { hits: 0, tokens: 0 });
  assert.equal(s._lastTotal, 0);
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
  store.upsert(newSession('a', {}));
  const snap = store.snapshot();
  assert.equal(snap.length, 1);
  assert.equal('_lastTotal' in snap[0], false);
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

test('persistencia: _touched (Set) sobrevive el round-trip como Set', () => {
  const path = tmpStatePath('set');
  rmSync(path, { force: true });
  try {
    const a = createStore({ persistPath: path });
    const s = newSession('s1', {});
    s._touched = new Set(['/a.js', '/b.js']);
    a.upsert(s);
    a.persist();

    const b = createStore({ persistPath: path });
    const loaded = b.get('s1');
    assert.ok(loaded._touched instanceof Set, '_touched debe rehidratarse como Set');
    assert.equal(loaded._touched.size, 2);
    assert.ok(loaded._touched.has('/a.js'));
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

test('hashType es estable y no vacío', () => {
  assert.equal(hashType('crear modelo User'), hashType('crear modelo User'));
  assert.ok(hashType('x').length > 0);
  assert.notEqual(hashType('a'), hashType('b'));
});

test('monsterFromTodos toma el in_progress y marca boss en el último', () => {
  const todos = [
    { content: 'plan', status: 'completed' },
    { content: 'modelo', status: 'in_progress' },
    { content: 'review', status: 'pending' },
  ];
  const m = monsterFromTodos(todos);
  assert.equal(m.label, 'modelo');
  assert.equal(m.isBoss, false);
  assert.equal(typeof m.type, 'string');

  const last = [
    { content: 'a', status: 'completed' },
    { content: 'review', status: 'in_progress' },
  ];
  assert.equal(monsterFromTodos(last).isBoss, true);
});

test('monsterFromTodos sin in_progress devuelve null', () => {
  assert.equal(monsterFromTodos([{ content: 'a', status: 'completed' }]), null);
  assert.equal(monsterFromTodos([]), null);
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
