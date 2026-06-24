import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = {
  readUsage: () => null,
  readLastAssistantText: () => 'lo que preguntó claude',
  gitBranch: () => '',
  now: () => 1000,
  worktreeName: () => null,
};

function ev(store, payload) { return applyEvent(store, payload, deps); }

test('sin plan: el diálogo cae en la quest suelta titulada con la sinopsis', () => {
  const store = createStore();
  const id = 'd1';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'arreglá los nombres' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'sí, dale' });

  const book = store.get(id)._questbook;
  assert.equal(book.synopsis, 'arreglá los nombres');
  const loose = book.quests.find((q) => q.loose);
  assert.ok(loose, 'debe existir la quest suelta');
  assert.equal(loose.id, '__session__');
  assert.equal(loose.title, 'arreglá los nombres');
  assert.equal(loose.dialogue.length, 1);
  assert.equal(loose.dialogue[0].claude, 'lo que preguntó claude');
  assert.equal(loose.dialogue[0].you, 'sí, dale');
});

test('con plan in_progress: el diálogo del turno cae en esa quest, no en la suelta', () => {
  const store = createStore();
  const id = 'd2';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hacé la tarea' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'in_progress' }] }, transcript_path: '/x' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'perfecto' });

  const book = store.get(id)._questbook;
  const planQ = book.quests.find((q) => q.id === 'tarea A');
  assert.equal(planQ.dialogue.length, 1);
  assert.equal(planQ.dialogue[0].you, 'perfecto');
  assert.equal(book.quests.some((q) => q.loose), false, 'no se crea quest suelta si hay plan activo');
});

test('una pregunta sin responder todavía queda con you vacío', () => {
  const store = createStore();
  const id = 'd3';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'p' });
  ev(store, { hook_event_name: 'Stop', session_id: id, transcript_path: '/x' });

  const loose = store.get(id)._questbook.quests.find((q) => q.loose);
  assert.equal(loose.dialogue.length, 1);
  assert.equal(loose.dialogue[0].you, '');
});

test('el primer prompt no abre intercambio (no hay turno previo de claude)', () => {
  const store = createStore();
  const id = 'd4';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hola' });
  const book = store.get(id)._questbook;
  assert.equal(book.quests.reduce((n, q) => n + q.dialogue.length, 0), 0);
});

test('ya no se loguean eventos de combate/estado en el libro', () => {
  const store = createStore();
  const id = 'd5';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'p' });
  ev(store, { hook_event_name: 'Notification', session_id: id, message: 'te necesita' });
  ev(store, { hook_event_name: 'StopFailure', session_id: id, message: 'falló X' });
  assert.equal(store.get(id)._questbook.events.length, 0);
});

test('el libro sigue siendo interno: no aparece en el snapshot', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'hola' });
  const snap = store.snapshot().find((s) => s.id === 's2');
  assert.equal(snap._questbook, undefined);
  assert.equal(snap._openExchange, undefined);
});
