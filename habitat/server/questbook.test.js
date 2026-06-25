import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest, pushEvent,
  ensureLooseQuest, activeQuestId, openExchange, closeExchange,
} from './questbook.js';

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

test('upsertQuests inicializa dialogue vacío', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'a', status: 'pending' }], { now: 1 });
  assert.deepEqual(b.quests[0].dialogue, []);
});

test('ensureLooseQuest crea una vez y reusa, titulada con la sinopsis', () => {
  const b = emptyBook();
  setSynopsis(b, 'mi pedido inicial');
  const q1 = ensureLooseQuest(b, { now: 7 });
  const q2 = ensureLooseQuest(b, { now: 9 });
  assert.equal(q1.id, '__session__');
  assert.equal(q1.loose, true);
  assert.equal(q1.title, 'mi pedido inicial');
  assert.equal(q1.status, 'in_progress');
  assert.equal(b.quests.length, 1);  // no duplica
  assert.equal(q2, q1);              // misma referencia
});

test('ensureLooseQuest sin sinopsis usa "Sesión"', () => {
  const b = emptyBook();
  assert.equal(ensureLooseQuest(b, { now: 1 }).title, 'Sesión');
});

test('activeQuestId devuelve la quest de plan in_progress, ignorando la suelta', () => {
  const b = emptyBook();
  ensureLooseQuest(b, { now: 1 });               // loose, in_progress, NO debe ganar
  assert.equal(activeQuestId(b), null);
  upsertQuests(b, [{ content: 'tarea X', status: 'in_progress' }], { now: 2 });
  assert.equal(activeQuestId(b), 'tarea X');
});

test('openExchange agrega con you vacío y devuelve puntero; closeExchange rellena', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'lo que dijo claude', { now: 5 });
  assert.deepEqual(ptr, { questId: '__session__', index: 0 });
  assert.equal(q.dialogue[0].claude, 'lo que dijo claude');
  assert.equal(q.dialogue[0].you, '');
  assert.equal(q.dialogue[0].ts, 5);
  closeExchange(b, ptr, 'lo que respondí');
  assert.equal(q.dialogue[0].you, 'lo que respondí');
});

test('openExchange devuelve null si no hay texto o la quest no existe', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  assert.equal(openExchange(b, q.id, '', { now: 1 }), null);
  assert.equal(openExchange(b, 'noexiste', 'hola', { now: 1 }), null);
});

test('openExchange y closeExchange truncan a 600', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'c'.repeat(800), { now: 1 });
  assert.equal(q.dialogue[0].claude.length, 600);
  closeExchange(b, ptr, 'y'.repeat(800));
  assert.equal(q.dialogue[0].you.length, 600);
});

test('closeExchange no pisa un intercambio ya cerrado', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 1 });
  const ptr = openExchange(b, q.id, 'pregunta', { now: 1 });
  closeExchange(b, ptr, 'primera');
  closeExchange(b, ptr, 'segunda');
  assert.equal(q.dialogue[0].you, 'primera');
});

test('openExchange respeta el cap global de 100 descartando el más viejo', () => {
  const b = emptyBook();
  const q = ensureLooseQuest(b, { now: 0 });
  let ptr;
  for (let i = 0; i < 105; i++) ptr = openExchange(b, q.id, `c${i}`, { now: i });
  assert.equal(q.dialogue.length, 100);
  assert.equal(q.dialogue[0].claude, 'c5');   // se descartaron los 5 más viejos
  assert.equal(q.dialogue[99].claude, 'c104');
  // el puntero devuelto sigue apuntando al recién agregado pese al recorte
  assert.equal(q.dialogue[ptr.index].claude, 'c104');
});

test('el cap global recorta la quest más vieja, no la que recibe el intercambio', () => {
  const b = emptyBook();
  upsertQuests(b, [{ content: 'A', status: 'in_progress' }], { now: 0 }); // quest vieja
  upsertQuests(b, [{ content: 'B', status: 'pending' }], { now: 1 });     // quest nueva
  const A = b.quests.find((q) => q.id === 'A');
  const B = b.quests.find((q) => q.id === 'B');
  // 60 intercambios en A
  for (let i = 0; i < 60; i++) openExchange(b, 'A', `a${i}`, { now: i });
  // 60 más en B -> total 120, supera el cap de 100; deben caer 20 de A (la más vieja)
  let ptr;
  for (let i = 0; i < 60; i++) ptr = openExchange(b, 'B', `b${i}`, { now: 100 + i });
  const total = b.quests.reduce((n, q) => n + q.dialogue.length, 0);
  assert.equal(total, 100);            // cap global respetado sumando A+B
  assert.equal(A.dialogue.length, 40); // se recortaron 20 de A
  assert.equal(B.dialogue.length, 60); // B intacta (recibe los intercambios)
  assert.equal(A.dialogue[0].claude, 'a20'); // los 20 más viejos de A se fueron
  assert.equal(B.dialogue[ptr.index].claude, 'b59'); // el puntero de B sigue válido
});
