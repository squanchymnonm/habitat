import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent } from './questbook.js';

test('emptyBook devuelve la forma vacía', () => {
  assert.deepEqual(emptyBook(), { synopsis: '', quests: [], events: [] });
});

test('setSynopsis fija una sola vez y trunca a 200', () => {
  const b = emptyBook();
  setSynopsis(b, 'objetivo original');
  setSynopsis(b, 'otro prompt');
  assert.equal(b.synopsis, 'objetivo original');
  const b2 = emptyBook();
  setSynopsis(b2, 'x'.repeat(300));
  assert.equal(b2.synopsis.length, 200);
});

test('upsertQuests agrega nuevas con contexto y no duplica', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'pending' }], { originPrompt: 'P', now: 5 });
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { originPrompt: 'OTRO', now: 9 });
  assert.equal(b.quests.length, 1);
  assert.equal(b.quests[0].id, 'a');
  assert.equal(b.quests[0].title, 'a');
  assert.equal(b.quests[0].status, 'in_progress'); // actualizó estado
  assert.equal(b.quests[0].originPrompt, 'P');      // no pisa el contexto original
  assert.equal(b.quests[0].since, 5);
});

test('upsertQuests no borra quests que salen del plan (acumulativo)', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'completed' }], { now: 1 });
  upsertQuests(b, [{ content: 'b', status: 'pending' }], { now: 2 }); // plan reescrito sin 'a'
  assert.deepEqual(b.quests.map((q) => q.id), ['a', 'b']);
  assert.equal(b.quests[0].status, 'completed');
});

test('setClaudeSummary trunca a 400 y no pisa', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { now: 1 });
  setClaudeSummary(b, 'a', 'y'.repeat(500));
  assert.equal(b.quests[0].claudeSummary.length, 400);
  setClaudeSummary(b, 'a', 'nuevo');
  assert.equal(b.quests[0].claudeSummary.length, 400); // no pisó
});

test('completeQuest estampa estado + monstruo + daño', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'in_progress' }], { now: 1 });
  completeQuest(b, 'a', { monster: 'a', damage: 1234, hits: 7 });
  assert.equal(b.quests[0].status, 'completed');
  assert.equal(b.quests[0].monster, 'a');
  assert.equal(b.quests[0].damage, 1234);
  assert.equal(b.quests[0].hits, 7);
});

test('pushEvent agrega y respeta el cap de 50', () => {
  const b = emptyBook();
  for (let i = 0; i < 55; i++) pushEvent(b, { type: 'error', label: `e${i}`, ts: i });
  assert.equal(b.events.length, 50);
  assert.equal(b.events[0].label, 'e5');   // se descartaron los 5 más viejos
  assert.equal(b.events[49].label, 'e54');
  assert.equal(b.events[0].detail, '');    // default
});
