import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSession, createStore, hashType, monsterFromTodos, questFromTodos } from './state.js';

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
