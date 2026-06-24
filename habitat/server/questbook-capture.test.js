import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './state.js';
import { applyEvent } from './hooks-logic.js';

const deps = {
  readUsage: () => null,
  readLastAssistantText: () => 'resumen de claude',
  gitBranch: () => '',
  now: () => 1000,
  worktreeName: () => null,
};

function ev(store, payload) { return applyEvent(store, payload, deps); }

test('una secuencia prompt -> todo(in_progress) -> todo(completed) llena el libro', () => {
  const store = createStore();
  const id = 's1';
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'arreglá los nombres' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'in_progress' }] }, transcript_path: '/x' });
  ev(store, { hook_event_name: 'PostToolUse', session_id: id, tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'tarea A', status: 'completed' }] }, transcript_path: '/x' });

  const book = store.get(id)._questbook;
  assert.equal(book.synopsis, 'arreglá los nombres');
  assert.equal(book.quests.length, 1);
  const q = book.quests[0];
  assert.equal(q.id, 'tarea A');
  assert.equal(q.status, 'completed');
  assert.equal(q.originPrompt, 'arreglá los nombres');
  assert.equal(q.claudeSummary, 'resumen de claude');
  assert.equal(q.monster, 'tarea A');
  assert.ok(q.hits >= 0);
  assert.ok(book.events.some((e) => e.type === 'quest_completed' && e.label === 'tarea A'));
});

test('el libro es interno: no aparece en el snapshot del store', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'hola' });
  const snap = store.snapshot().find((s) => s.id === 's2');
  assert.equal(snap._questbook, undefined);
  assert.equal(snap._currentPrompt, undefined);
});

test('eventos de error y waiting se loguean', () => {
  const store = createStore();
  ev(store, { hook_event_name: 'UserPromptSubmit', session_id: 's3', prompt: 'p' });
  ev(store, { hook_event_name: 'Notification', session_id: 's3', message: 'te necesita' });
  ev(store, { hook_event_name: 'StopFailure', session_id: 's3', message: 'falló X' });
  const types = store.get('s3')._questbook.events.map((e) => e.type);
  assert.ok(types.includes('waiting'));
  assert.ok(types.includes('error'));
});
