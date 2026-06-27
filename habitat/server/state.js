import { readFileSync, writeFileSync, renameSync } from 'node:fs';

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
    cwd: '',
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
  return { type: hashType(label), isBoss: idx === todos.length - 1, label, source: 'todo' };
}

// Monstruo "de turno": el que aparece cuando la sesión no usa todos. Sprite aleatorio
// (el cliente mapea cualquier `type` a un sprite vía hash), nunca boss. Nace en
// UserPromptSubmit y muere en Stop.
export function randomMonster(label = '') {
  return { type: 't' + Math.random().toString(36).slice(2, 8), isBoss: false, label, source: 'turn' };
}

// El store vive en memoria, pero opcionalmente se respalda en disco para que un
// reinicio del server no vacíe la GUI: las sesiones idle no vuelven a anunciarse
// solas (los hooks sólo disparan con actividad), así que sin esto desaparecen.
export function createStore({ persistPath } = {}) {
  const map = new Map();
  // Personaje elegido en /spawn, keyed por nombre de proyecto. SessionStart lo consume
  // (one-shot). En memoria: la ventana spawn->SessionStart es de ~1-2s, no se persiste.
  const pendingChars = new Map();

  if (persistPath) {
    try {
      const raw = readFileSync(persistPath, 'utf8');
      for (const s of JSON.parse(raw)) map.set(s.id, reviveSession(s));
    } catch { /* sin archivo aún, o corrupto: arrancamos vacío */ }
  }

  function persist() {
    if (!persistPath) return;
    const data = JSON.stringify([...map.values()].map(serializeSession));
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, persistPath); // escritura atómica: nunca dejamos un JSON a medias
  }

  let usage = null;

  return {
    get: (id) => map.get(id),
    all: () => [...map.values()],
    upsert: (session) => { map.set(session.id, session); return session; },
    remove: (id) => { map.delete(id); persist(); },
    reorder: (ids) => {
      // Reconstruye el Map en el orden pedido. Las sesiones existentes que no estén en
      // `ids` (carrera con un alta reciente) quedan al final. Ids inexistentes se ignoran.
      const next = new Map();
      for (const id of ids) if (map.has(id)) next.set(id, map.get(id));
      for (const [id, s] of map) if (!next.has(id)) next.set(id, s);
      map.clear();
      for (const [id, s] of next) map.set(id, s);
      persist();
    },
    snapshot: () => [...map.values()].map(stripInternal),
    persist,
    setPendingChar: (name, char) => { pendingChars.set(name, char); },
    takePendingChar: (name) => { const c = pendingChars.get(name); pendingChars.delete(name); return c; },
    getUsage: () => usage,
    setUsage: (u) => { usage = u; },
  };
}

// _touched es un Set en memoria; JSON no lo serializa, así que va y vuelve como array.
function serializeSession(s) {
  const out = { ...s };
  if (s._touched instanceof Set) out._touched = [...s._touched];
  return out;
}

function reviveSession(s) {
  if (Array.isArray(s._touched)) s._touched = new Set(s._touched);
  return s;
}

function stripInternal(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}
