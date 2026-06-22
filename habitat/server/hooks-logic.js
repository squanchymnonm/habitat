import { basename } from 'node:path';
import { newSession, questFromTodos, monsterFromTodos, hashType } from './state.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function staminaFromContext(ctx, max) {
  return Math.max(0, Math.round(100 * (1 - ctx / max)));
}

function ensure(store, payload) {
  let s = store.get(payload.session_id);
  if (!s) {
    s = newSession(payload.session_id, {});
    s._touched = new Set();
    store.upsert(s);
  }
  if (!s._touched) s._touched = new Set();
  return s;
}

function setStatus(s, status, action, now) {
  if (s.status !== status || !s.since) s.since = now();
  s.status = status;
  if (action != null) s.action = String(action).slice(0, 200);
}

function ensureMonster(s) {
  if (!s.monster) {
    s.monster = { type: hashType(s.name || s.id), isBoss: false, label: s.action || 'trabajando' };
  }
}

// El pod vivo de una tmux: la tmux es única por nombre de proyecto (s.name), así
// que buscamos el pod de ese proyecto distinto del id nuevo (el más reciente si
// hubiera duplicados persistidos).
function findPodByTmux(store, name, exceptId) {
  const matches = store.all().filter((s) => s.name === name && s.id !== exceptId);
  if (!matches.length) return null;
  return matches.sort((a, b) => (b.since || 0) - (a.since || 0))[0];
}

export function applyEvent(store, payload, deps) {
  const { readUsage, maxContext, now } = deps;
  const ev = payload.hook_event_name;

  // /clear cierra la sesión vieja y abre una nueva (otro session_id) sobre la MISMA
  // tmux. No queremos un pod "caído" + uno nuevo (cerrar el caído mataría la tmux
  // compartida, y con ella la sesión nueva): reusamos el pod existente, lo rekeyeamos
  // al id nuevo y le recargamos la stamina (clear vacía el contexto).
  if (ev === 'SessionStart' && payload.source === 'clear' && payload.cwd) {
    const name = basename(payload.cwd);
    const prev = findPodByTmux(store, name, payload.session_id);
    if (prev) {
      store.remove(prev.id);
      prev.id = payload.session_id;
      prev.stamina = 100;
      prev.monster = null;
      prev.combat = { hits: 0, tokens: 0 };
      prev._lastTotal = 0;
      prev._touched = new Set();
      const pendingChar = store.takePendingChar(name);
      if (pendingChar) prev.char = pendingChar;
      if (deps.gitBranch) prev.branch = deps.gitBranch(payload.cwd) || prev.branch;
      setStatus(prev, 'idle', 'memoria despejada', now);
      store.upsert(prev);
      return { session: prev, fightResult: null };
    }
  }

  // SessionEnd con reason 'clear' no es un cierre real: viene seguido de un
  // SessionStart que reusa el pod. No lo marcamos offline.
  if (ev === 'SessionEnd' && payload.reason === 'clear') {
    return { session: null, fightResult: null };
  }

  // SessionEnd de una sesión que ya no existe (p.ej. la matamos desde la GUI): no la
  // recreamos sólo para marcarla offline. ensure() crearía un pod zombie.
  if (ev === 'SessionEnd' && !store.get(payload.session_id)) {
    return { session: null, fightResult: null, removed: null };
  }

  const s = ensure(store, payload);
  let fightResult = null;
  let removed = null;

  const recomputeStamina = () => {
    if (!payload.transcript_path) return;
    const u = readUsage(payload.transcript_path);
    if (u) s.stamina = staminaFromContext(u.contextTokens, maxContext);
  };

  switch (ev) {
    case 'SessionStart': {
      if (payload.cwd) {
        const wt = deps.worktreeName ? deps.worktreeName(payload.cwd) : null;
        if (wt) {
          s.name = wt.project;
          s.tmux = wt.tmux;
        } else {
          s.name = basename(payload.cwd);
        }
        s.project = s.name;
        if (deps.gitBranch) s.branch = deps.gitBranch(payload.cwd) || '';
      }
      const pendingChar = store.takePendingChar(s.tmux || s.name);
      if (pendingChar) s.char = pendingChar;
      // /spawn creó un pod provisional `pending:<tmux>` (para que aceptes la confianza
      // desde su terminal). Ahora que arrancó la sesión real, lo adoptamos: lo quitamos
      // para no dejar un pod duplicado.
      const provId = `pending:${s.tmux || s.name}`;
      if (payload.session_id !== provId && store.get(provId)) {
        store.remove(provId);
        removed = provId;
      }
      setStatus(s, 'idle', 'sesión iniciada', now);
      s.monster = null;
      break;
    }
    case 'UserPromptSubmit': {
      s._resting = false;
      setStatus(s, 'working', 'procesando tu pedido', now);
      recomputeStamina();
      ensureMonster(s);
      break;
    }
    case 'Notification': {
      setStatus(s, 'waiting', payload.message || 'te necesita', now);
      break;
    }
    case 'StopFailure': {
      setStatus(s, 'error', payload.message || 'falló', now);
      break;
    }
    case 'PreCompact': {
      s._resting = true;
      s.stamina = 5;
      setStatus(s, 'working', 'descansando (compactando)', now);
      break;
    }
    case 'Stop': {
      const done = s.quest && s.quest.total > 0 && s.quest.done >= s.quest.total;
      setStatus(s, done ? 'done' : 'idle', done ? 'dungeon cleared' : 'a la espera', now);
      s.monster = null;
      break;
    }
    case 'SessionEnd': {
      setStatus(s, 'offline', 'sesión cerrada', now);
      s.monster = null;
      break;
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      if (payload.tool_name === 'TodoWrite') {
        fightResult = handleTodoWrite(s, payload, now);
      } else {
        handleHit(s, payload, deps);
      }
      break;
    }
    default:
      break;
  }
  return { session: s, fightResult, removed };
}

function handleTodoWrite(s, payload, now) {
  const todos = (payload.tool_input && payload.tool_input.todos) || [];
  const prevDone = s.quest ? s.quest.done : 0;
  const prevLabel = s.monster ? s.monster.label : null;
  s.quest = questFromTodos(todos);
  let fightResult = null;

  // ¿se completó un todo? (subió done) -> cayó el monstruo anterior
  if (s.quest.done > prevDone && prevLabel) {
    const loot = s._touched && s._touched.size ? [...s._touched] : [prevLabel];
    fightResult = { id: s.id, result: {
      monster: prevLabel, hp: s.combat.tokens, hits: s.combat.hits, loot,
    } };
    s.combat = { hits: 0, tokens: 0 };
    s._touched = new Set();
  }

  const next = monsterFromTodos(todos);
  // si cambia el monstruo en curso, resetear combate
  if (next && (!s.monster || s.monster.label !== next.label)) {
    s.combat = { hits: 0, tokens: 0 };
    s._touched = new Set();
  }
  s.monster = next;
  setStatus(s, 'working', 'planificando', now);
  return fightResult;
}

function handleHit(s, payload, deps) {
  const { readUsage, maxContext, now } = deps;
  setStatus(s, 'working', payload.tool_name || 'trabajando', now);
  if (EDIT_TOOLS.has(payload.tool_name) && payload.tool_input && payload.tool_input.file_path) {
    s._touched.add(payload.tool_input.file_path);
  }
  ensureMonster(s);
  s.combat.hits++;
  if (payload.transcript_path) {
    const u = readUsage(payload.transcript_path);
    if (u) {
      const damage = Math.max(0, u.totalTokens - s._lastTotal);
      s.combat.tokens += damage;
      s.combat.lastDamage = damage;
      s._lastTotal = u.totalTokens;
      s._resting = false;
      s.stamina = staminaFromContext(u.contextTokens, maxContext);
    }
  }
}
