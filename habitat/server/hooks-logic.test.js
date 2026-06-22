import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, newSession } from './state.js';
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

test('SessionStart setea branch desde deps.gitBranch(cwd)', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, { ...deps(null), gitBranch: (cwd) => (cwd === '/home/u/proj-api' ? 'feat/habitat-rpg' : '') });
  assert.equal(session.branch, 'feat/habitat-rpg');
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
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', transcript_path: '/t' },
    deps({ contextTokens: 40000, totalTokens: 1000 }));
  assert.equal(r.session.combat.hits, 1);
  assert.equal(r.session.combat.tokens, 1000);
  assert.equal(r.session.combat.lastDamage, 1000);
  assert.equal(r.session.stamina, 80); // 100*(1-40000/200000)
  // segundo golpe: total 1500 -> damage 500
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: '/t' },
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
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', transcript_path: '/t',
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

test('working sin todos asigna monstruo genérico estable', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  assert.ok(r.session.monster, 'debe haber monstruo al trabajar');
  assert.equal(r.session.monster.isBoss, false);
  const t1 = r.session.monster.type;
  const r2 = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' }, deps(null));
  assert.equal(r2.session.monster.type, t1, 'el type del genérico es estable entre golpes');
});

test('UserPromptSubmit ya muestra monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.ok(r.session.monster);
});

test('los todos tienen prioridad sobre el monstruo genérico', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null)); // genérico
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'arreglar auth', status: 'in_progress' }] } }, deps(null));
  assert.equal(r.session.monster.label, 'arreglar auth');
});

test('Stop a idle y SessionEnd limpian el monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  let r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.session.monster, null);
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' }, deps(null));
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd' }, deps(null));
  assert.equal(r.session.monster, null);
});

test('SessionStart bajo worktree setea s.tmux y project derivados', () => {
  const store = createStore();
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd, hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: () => ({ project: 'rpg', tmux: 'rpg-feature-x' }) });
  assert.equal(session.name, 'rpg');
  assert.equal(session.project, 'rpg');
  assert.equal(session.tmux, 'rpg-feature-x');
});

test('SessionStart sin worktreeName mantiene basename y sin s.tmux', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/rpg', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.name, 'rpg');
  assert.equal(session.tmux, undefined);
});

test('SessionStart bajo worktree consume pending char por s.tmux', () => {
  const store = createStore();
  store.setPendingChar('rpg-feature-x', 'Knight');
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd, hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: () => ({ project: 'rpg', tmux: 'rpg-feature-x' }) });
  assert.equal(session.char, 'Knight');
  assert.equal(store.takePendingChar('rpg-feature-x'), undefined);
});

test('SessionStart adopta el pod provisional con mismo tmux (lo quita y lo reporta)', () => {
  const store = createStore();
  store.upsert(newSession('pending:rpg-feature-x', { tmux: 'rpg-feature-x', status: 'waiting' }));
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const { session, removed } = applyEvent(store, {
    session_id: 'real-1', cwd, hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: () => ({ project: 'rpg', tmux: 'rpg-feature-x' }) });
  assert.equal(removed, 'pending:rpg-feature-x');
  assert.equal(store.get('pending:rpg-feature-x'), undefined);
  assert.equal(session.id, 'real-1');
  assert.equal(session.tmux, 'rpg-feature-x');
});

test('SessionStart sin pod provisional no reporta removed', () => {
  const store = createStore();
  const { removed } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/rpg', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(removed, null);
});

test('SessionStart consume pending char y lo asigna a s.char (one-shot)', () => {
  const store = createStore();
  store.setPendingChar('proj-api', 'Knight');
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.char, 'Knight');
  assert.equal(store.takePendingChar('proj-api'), undefined); // ya fue consumido
});

test('SessionStart sin pending char deja char undefined', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj-api', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.char, undefined);
});

test('SessionEnd sobre sesión inexistente no la crea (no-op)', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 'ghost', hook_event_name: 'SessionEnd',
  }, deps(null));
  assert.equal(session, null);
  assert.equal(store.get('ghost'), undefined);
});
