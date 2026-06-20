export function hashType(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'm' + (h % 100000).toString(36);
}

export function newSession(id, fields = {}) {
  return {
    id,
    name: '',
    project: '',
    branch: '',
    status: 'idle',
    action: '',
    since: 0,
    stamina: 100,
    quest: undefined,
    monster: null,
    combat: { hits: 0, tokens: 0 },
    _lastTotal: 0,
    ...fields,
  };
}

export function questFromTodos(todos = []) {
  return {
    total: todos.length,
    done: todos.filter((t) => t.status === 'completed').length,
  };
}

export function monsterFromTodos(todos = []) {
  const idx = todos.findIndex((t) => t.status === 'in_progress');
  if (idx === -1) return null;
  const label = todos[idx].content || todos[idx].activeForm || '';
  return { type: hashType(label), isBoss: idx === todos.length - 1, label };
}

export function createStore() {
  const map = new Map();
  return {
    get: (id) => map.get(id),
    all: () => [...map.values()],
    upsert: (session) => { map.set(session.id, session); return session; },
    remove: (id) => { map.delete(id); },
    snapshot: () => [...map.values()].map(stripInternal),
  };
}

function stripInternal(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}
