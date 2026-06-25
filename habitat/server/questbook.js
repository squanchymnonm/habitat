// Lógica pura del Quest Book: acumula quests desde los todos y arma la línea de
// tiempo de eventos. Sin I/O ni imports del server: testeable en aislamiento.

const SYNOPSIS_MAX = 200;
const SUMMARY_MAX = 400;
const EVENTS_MAX = 50;
const DIALOGUE_MAX = 600;
const EXCHANGES_MAX = 100;

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
        dialogue: [],
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

export function ensureLooseQuest(book, ctx = {}) {
  const { now = 0 } = ctx;
  let q = book.quests.find((x) => x.loose);
  if (q) return q;
  q = {
    id: '__session__',
    title: book.synopsis || 'Sesión',
    status: 'in_progress',
    loose: true,
    originPrompt: book.synopsis || '',
    claudeSummary: '',
    monster: null,
    damage: 0,
    hits: 0,
    since: now,
    dialogue: [],
  };
  book.quests.push(q);
  return q;
}

export function activeQuestId(book) {
  const q = book.quests.find((x) => !x.loose && x.status === 'in_progress');
  return q ? q.id : null;
}

function totalExchanges(book) {
  return book.quests.reduce((n, q) => n + (q.dialogue ? q.dialogue.length : 0), 0);
}

export function openExchange(book, questId, claudeText, ctx = {}) {
  const { now = 0 } = ctx;
  const text = String(claudeText || '');
  if (!text) return null;
  const q = book.quests.find((x) => x.id === questId);
  if (!q) return null;
  if (!q.dialogue) q.dialogue = [];
  q.dialogue.push({ claude: text.slice(0, DIALOGUE_MAX), you: '', ts: now });
  while (totalExchanges(book) > EXCHANGES_MAX) {
    const victim = book.quests.find((x) => x.dialogue && x.dialogue.length);
    if (!victim) break;
    victim.dialogue.shift();
  }
  return { questId, index: q.dialogue.length - 1 };
}

export function closeExchange(book, ptr, youText) {
  if (!ptr) return;
  const q = book.quests.find((x) => x.id === ptr.questId);
  if (!q || !q.dialogue) return;
  const ex = q.dialogue[ptr.index];
  if (!ex || ex.you) return;
  ex.you = String(youText || '').slice(0, DIALOGUE_MAX);
}
