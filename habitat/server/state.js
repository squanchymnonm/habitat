import { readFileSync, writeFileSync, renameSync } from 'node:fs';

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
    ...fields,
  };
}

export function questFromTodos(todos = []) {
  return {
    total: todos.length,
    done: todos.filter((t) => t.status === 'completed').length,
  };
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

// Campos del combate (eliminado): se descartan al cargar estado viejo y no se vuelven a escribir.
const DROPPED = ['monster', 'combat', '_touched', '_lastTotal'];

function serializeSession(s) {
  return { ...s };
}

function reviveSession(s) {
  for (const k of DROPPED) delete s[k];
  return s;
}

function stripInternal(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}
