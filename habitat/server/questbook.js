// Lógica pura del Quest Book: acumula quests desde los todos y arma la línea de
// tiempo de eventos. Sin I/O ni imports del server: testeable en aislamiento.

const SYNOPSIS_MAX = 200;
const SUMMARY_MAX = 400;
const EVENTS_MAX = 50;

export function emptyBook() {
  return { synopsis: '', quests: [], events: [] };
}

export function setSynopsis(book, prompt) {
  if (book.synopsis) return; // solo la primera vez
  book.synopsis = String(prompt || '').slice(0, SYNOPSIS_MAX);
}

export function upsertQuests(book, todos, ctx = {}) {
  const { originPrompt = '', now = 0 } = ctx;
  for (const t of todos || []) {
    const id = t && t.content;
    if (!id) continue;
    const existing = book.quests.find((q) => q.id === id);
    if (existing) {
      if (t.status != null) existing.status = t.status;
    } else {
      book.quests.push({
        id,
        title: id,
        status: t.status || 'pending',
        originPrompt: String(originPrompt || '').slice(0, SYNOPSIS_MAX),
        claudeSummary: '',
        monster: null,
        damage: 0,
        hits: 0,
        since: now,
      });
    }
  }
}

export function setClaudeSummary(book, questId, text) {
  const q = book.quests.find((x) => x.id === questId);
  if (!q || q.claudeSummary) return; // no pisa
  q.claudeSummary = String(text || '').slice(0, SUMMARY_MAX);
}

export function completeQuest(book, questId, { monster = null, damage = 0, hits = 0 } = {}) {
  const q = book.quests.find((x) => x.id === questId);
  if (!q) return;
  q.status = 'completed';
  q.monster = monster;
  q.damage = damage;
  q.hits = hits;
}

export function pushEvent(book, event) {
  book.events.push({
    type: event.type,
    label: String(event.label || '').slice(0, SYNOPSIS_MAX),
    detail: String(event.detail || '').slice(0, SYNOPSIS_MAX),
    ts: event.ts || 0,
  });
  if (book.events.length > EVENTS_MAX) book.events = book.events.slice(-EVENTS_MAX);
}
