import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, newSession } from './state.js';
import { applyEvent, staminaFromStatus, dismissAlert } from './hooks-logic.js';
import { worktreeName } from './worktree.js';

const deps = (usage) => ({
  readUsage: () => usage,
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

test('cualquier evento con cwd reactualiza branch al moverse de branch', () => {
  const store = createStore();
  // arranca en main
  let branch = 'main';
  const d = { ...deps(null), gitBranch: () => branch };
  applyEvent(store, { session_id: 's1', cwd: '/home/u/proj', hook_event_name: 'SessionStart' }, d);
  assert.equal(store.get('s1').branch, 'main');
  // git checkout a otra branch entre eventos
  branch = 'feat/nueva';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj', hook_event_name: 'PostToolUse', tool_name: 'Bash',
  }, d);
  assert.equal(session.branch, 'feat/nueva');
});

test('branch no se pisa con vacío si gitBranch falla en un evento', () => {
  const store = createStore();
  let branch = 'main';
  const d = { ...deps(null), gitBranch: () => branch };
  applyEvent(store, { session_id: 's1', cwd: '/home/u/proj', hook_event_name: 'SessionStart' }, d);
  branch = ''; // git falló / cwd transitorio
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/proj', hook_event_name: 'PostToolUse', tool_name: 'Read',
  }, d);
  assert.equal(session.branch, 'main');
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

test('golpe acumula daño = delta de totalTokens', () => {
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
  // segundo golpe: total 1500 -> damage 500
  r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: '/t' },
    deps({ contextTokens: 50000, totalTokens: 1500 }));
  assert.equal(r.session.combat.tokens, 1500);
  assert.equal(r.session.combat.lastDamage, 500);
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

test('dismissAlert: waiting/error -> idle (manual); no toca otros estados', () => {
  const at = (status) => Object.assign(newSession('s1', {}), { status, since: 1, action: 'x' });
  const now = () => 2000;

  const w = at('waiting');
  assert.equal(dismissAlert(w, now), true);
  assert.equal(w.status, 'idle');
  assert.equal(w.action, 'quieta (manual)');
  assert.equal(w.since, 2000); // refresca el reloj del estado

  const e = at('error');
  assert.equal(dismissAlert(e, now), true);
  assert.equal(e.status, 'idle');

  for (const st of ['working', 'idle', 'done', 'offline']) {
    const s = at(st);
    assert.equal(dismissAlert(s, now), false);
    assert.equal(s.status, st); // intacto
  }
  assert.equal(dismissAlert(null, now), false); // defensivo
});

test('PreCompact marca descanso sin tocar la stamina (la maneja el statusLine)', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  store.get('s1').stamina = 42;
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'PreCompact', transcript_path: '/t' },
    deps({ contextTokens: 180000, totalTokens: 180000 }));
  assert.equal(r.session._resting, true);
  assert.equal(r.session.status, 'working');
  assert.equal(r.session.stamina, 42); // intacta: el orbe lo actualiza POST /status
});

test('Stop marca done sin tocar la stamina', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  store.get('s1').stamina = 42;
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'a', status: 'completed' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop', transcript_path: '/t' },
    deps({ contextTokens: 36000, totalTokens: 200000 }));
  assert.equal(r.session.status, 'done');
  assert.equal(r.session.stamina, 42); // intacta
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
  assert.equal(session.name, 'feature-x');
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

test('SessionStart con payload.tmux (sesión manual en tmux) setea s.tmux', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: '/home/u/rpg', hook_event_name: 'SessionStart', tmux: 'mi-sesion',
  }, deps(null));
  assert.equal(session.name, 'rpg');
  assert.equal(session.tmux, 'mi-sesion');
});

test('SessionStart bajo worktree ignora payload.tmux (gana el worktree)', () => {
  const store = createStore();
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd, hook_event_name: 'SessionStart', tmux: 'otra',
  }, { ...deps(null), worktreeName: () => ({ project: 'rpg', tmux: 'rpg-feature-x' }) });
  assert.equal(session.tmux, 'rpg-feature-x');
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

test('/clear reusa el pod (misma tmux), lo rekeyea y recarga stamina; no deja pod caído', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  // desgaste: stamina baja (100*(1-160000/200000)=20)
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', transcript_path: '/t' },
    deps({ contextTokens: 160000, totalTokens: 5000 }));
  // /clear: SessionEnd (reason clear) de la vieja + SessionStart (source clear) de la nueva, mismo cwd
  applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' }, deps(null));
  const { session, rekey } = applyEvent(store, {
    session_id: 's2', cwd: '/home/u/api', source: 'clear', hook_event_name: 'SessionStart',
  }, deps(null));

  assert.equal(store.all().length, 1, 'un solo pod, sin caídos');
  assert.equal(store.get('s1'), undefined, 'el id viejo ya no existe');
  assert.deepEqual(rekey, { from: 's1', to: 's2' }, 'rekey atómico: viejo -> nuevo');
  assert.equal(session.id, 's2', 'rekeyeado al nuevo session_id');
  assert.equal(session.name, 'api', 'mismo proyecto/tmux');
  assert.notEqual(session.status, 'offline');
  assert.equal(session.status, 'idle');
  assert.equal(session.stamina, 100, 'stamina recargada');
});

test('/clear bajo worktree reusa el pod (match por tmux, no por basename)', () => {
  const store = createStore();
  const cwd = '/home/u/habitat-worktrees/rpg/feature-x';
  const wt = () => ({ project: 'rpg', tmux: 'rpg-feature-x' });
  applyEvent(store, { session_id: 's1', cwd, hook_event_name: 'SessionStart' },
    { ...deps(null), worktreeName: wt });
  // /clear sobre el MISMO worktree: nuevo session_id, source clear
  applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' }, deps(null));
  const { session, rekey } = applyEvent(store, {
    session_id: 's2', cwd, source: 'clear', hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: wt });

  assert.equal(store.all().length, 1, 'un solo pod, sin duplicado');
  assert.equal(store.get('s1'), undefined, 'el id viejo ya no existe');
  assert.deepEqual(rekey, { from: 's1', to: 's2' }, 'rekey atómico: viejo -> nuevo');
  assert.equal(session.id, 's2', 'rekeyeado al nuevo session_id');
  assert.equal(session.tmux, 'rpg-feature-x', 'misma tmux');
});

test('/clear no roba el pod de OTRO worktree del mismo proyecto', () => {
  const store = createStore();
  const wtA = () => ({ project: 'rpg', tmux: 'rpg-feature-a' });
  const wtB = () => ({ project: 'rpg', tmux: 'rpg-feature-b' });
  applyEvent(store, { session_id: 'a1', cwd: '/home/u/habitat-worktrees/rpg/feature-a', hook_event_name: 'SessionStart' },
    { ...deps(null), worktreeName: wtA });
  applyEvent(store, { session_id: 'b1', cwd: '/home/u/habitat-worktrees/rpg/feature-b', hook_event_name: 'SessionStart' },
    { ...deps(null), worktreeName: wtB });
  // /clear en el worktree B
  applyEvent(store, { session_id: 'b1', hook_event_name: 'SessionEnd', reason: 'clear' }, deps(null));
  applyEvent(store, {
    session_id: 'b2', cwd: '/home/u/habitat-worktrees/rpg/feature-b', source: 'clear', hook_event_name: 'SessionStart',
  }, { ...deps(null), worktreeName: wtB });

  assert.equal(store.all().length, 2, 'cada worktree conserva su pod');
  assert.notEqual(store.get('a1'), undefined, 'el pod del worktree A sigue intacto');
  assert.equal(store.get('b1'), undefined, 'el id viejo de B se rekeyeó');
  assert.notEqual(store.get('b2'), undefined, 'el pod de B reusado con el id nuevo');
});

test('/clear funciona aunque SessionStart llegue antes que SessionEnd', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  // orden invertido
  const { session } = applyEvent(store, {
    session_id: 's2', cwd: '/home/u/api', source: 'clear', hook_event_name: 'SessionStart',
  }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' }, deps(null));

  assert.equal(store.all().length, 1);
  assert.equal(session.id, 's2');
  assert.equal(store.get('s1'), undefined);
  assert.equal(r.session, null, 'el SessionEnd del id viejo es no-op');
});

test('SessionEnd con reason clear no marca el pod offline', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' }, deps(null));
  assert.equal(r.session, null);
  // el pod sigue vivo, no offline
  assert.notEqual(store.get('s1'), undefined);
  assert.notEqual(store.get('s1').status, 'offline');
});

test('/clear sin pod previo (p.ej. tras reinicio) crea un pod limpio, no falla', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 's2', cwd: '/home/u/api', source: 'clear', hook_event_name: 'SessionStart',
  }, deps(null));
  assert.equal(session.id, 's2');
  assert.equal(session.name, 'api');
  assert.equal(session.status, 'idle');
});

test('SessionEnd sobre sesión inexistente no la crea (no-op)', () => {
  const store = createStore();
  const { session } = applyEvent(store, {
    session_id: 'ghost', hook_event_name: 'SessionEnd',
  }, deps(null));
  assert.equal(session, null);
  assert.equal(store.get('ghost'), undefined);
});

test('SessionStart bajo worktree: name=personaje (leaf), project=proyecto, tmux derivado', () => {
  const store = createStore();
  const WT = '/home/u/habitat-worktrees';
  const { session } = applyEvent(store, {
    session_id: 's1', cwd: `${WT}/RPG-Agents/bob`, hook_event_name: 'SessionStart',
  }, { ...deps(null), gitBranch: () => 'bob', worktreeName: (cwd) => worktreeName(WT, cwd) });
  assert.equal(session.name, 'bob');
  assert.equal(session.project, 'RPG-Agents');
  assert.equal(session.tmux, 'RPG-Agents-bob');
  assert.equal(session.branch, 'bob');
});

test('staminaFromStatus: used 4% -> stamina 96', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 4 } }), 96);
});

test('staminaFromStatus: used 25% -> stamina 75', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 25 } }), 75);
});

test('staminaFromStatus: redondea y clampa', () => {
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 4.6 } }), 95);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 120 } }), 0);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: -10 } }), 100);
});

test('staminaFromStatus: sin context_window o sin used_percentage -> null', () => {
  assert.equal(staminaFromStatus({}), null);
  assert.equal(staminaFromStatus({ context_window: {} }), null);
  assert.equal(staminaFromStatus({ context_window: { used_percentage: 'x' } }), null);
});

test('dos UserPromptSubmit seguidos dan monstruos de turno distintos', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  const a = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.equal(a.session.monster.source, 'turn');
  const t1 = a.session.monster.type;
  const b = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.notEqual(b.session.monster.type, t1, 'cada turno trae un monstruo distinto');
});

test('Stop tras pelea real (monstruo de turno) emite loot y limpia el monstruo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit', transcript_path: '/t',
    tool_input: { file_path: 'src/Auth.php' } }, deps({ contextTokens: 10, totalTokens: 3000 }));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.ok(r.fightResult, 'debe soltar loot');
  assert.equal(r.fightResult.result.hp, 3000);
  assert.equal(r.fightResult.result.hits, 1);
  assert.deepEqual(r.fightResult.result.loot, ['src/Auth.php']);
  assert.equal(r.session.monster, null, 'el monstruo de turno muere');
});

test('Stop sin pelea (turno trivial) no emite loot', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/api', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.equal(r.fightResult, null, 'turno sin tool uses no suelta loot');
  assert.equal(r.session.monster, null);
});

test('el monstruo de quest sobrevive al Stop', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea larga', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'Stop' }, deps(null));
  assert.ok(r.session.monster, 'la quest sigue viva entre turnos');
  assert.equal(r.session.monster.label, 'tarea larga');
  assert.equal(r.session.monster.source, 'todo');
});

test('UserPromptSubmit no pisa un monstruo de quest activo', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart' }, deps(null));
  applyEvent(store, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'arreglar auth', status: 'in_progress' }] } }, deps(null));
  const r = applyEvent(store, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, deps(null));
  assert.equal(r.session.monster.source, 'todo');
  assert.equal(r.session.monster.label, 'arreglar auth');
});
