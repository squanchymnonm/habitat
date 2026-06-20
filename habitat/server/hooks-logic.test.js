import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = (usage) => ({
  readUsage: () => usage,
  maxContext: 200000,
  now: () => 1000,
});

test('SessionStart registra sesión idle y deriva name del cwd', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.id, 's1');
  assert.equal(session.status, 'idle');
  assert.equal(session.name, 'proj-api');
});

test('TodoWrite setea quest y monster', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  const { session } = applyEvent(store, {
    session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'review', status: 'pending' },
    ] },
  }, deps(null));
  assert.deepEqual(session.quest, { total: 3, done: 1 });
  assert.equal(session.monster.label, 'b');
  assert.equal(session.monster.isBoss, false);
});

test('golpe acumula daño = delta de totalTokens y baja stamina', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'b', status: 'in_progress' }] } }, deps(null));
  // primer golpe: total 1000, _lastTotal era 0 -> damage 1000
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    deps({ contextTokens: 40000, totalTokens: 1000 }));
  assert.equal(r.session.combat.hits, 1);
  assert.equal(r.session.combat.tokens, 1000);
  assert.equal(r.session.combat.lastDamage, 1000);
  assert.equal(r.session.stamina, 80); // 100*(1-40000/200000)
  // segundo golpe: total 1500 -> damage 500
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read' },
    deps({ contextTokens: 50000, totalTokens: 1500 }));
  assert.equal(r.session.combat.tokens, 1500);
  assert.equal(r.session.combat.lastDamage, 500);
  assert.equal(r.session.stamina, 75);
});

test('Write/Edit acumula loot en _touched', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'b', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'src/Auth.php' } }, deps({ contextTokens: 10, totalTokens: 10 }));
  assert.deepEqual([...r.session._touched], ['src/Auth.php']);
});

test('completar un todo emite fightResult con hp=tokens y loot', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tests', status: 'in_progress' }, { content: 'review', status: 'pending' }] } }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: 'tests/AuthTest.php' } }, deps({ contextTokens: 10, totalTokens: 8000 }));
  // ahora el primer todo pasa a completed
  const { fightResult } = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tests', status: 'completed' }, { content: 'review', status: 'in_progress' }] } }, deps(null));
  assert.ok(fightResult);
  assert.equal(fightResult.result.monster, 'tests');
  assert.equal(fightResult.result.hp, 8000);
  assert.deepEqual(fightResult.result.loot, ['tests/AuthTest.php']);
});

test('Notification -> waiting; StopFailure -> error', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'Notification', message: 'pide permiso' }, deps(null));
  assert.equal(r.session.status, 'waiting');
  assert.equal(r.session.action, 'pide permiso');
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'StopFailure', message: 'boom' }, deps(null));
  assert.equal(r.session.status, 'error');
});

test('PreCompact descansa (stamina baja); Stop con dungeon completo -> done', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreCompact' }, deps(null));
  assert.equal(r.session.stamina, 5);
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'a', status: 'completed' }] } }, deps(null));
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.session.status, 'done');
});

test('SessionEnd -> offline', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd' }, deps(null));
  assert.equal(r.session.status, 'offline');
});
