import { basename } from 'node:path';
import { newSession, questFromTodos, monsterFromTodos } from './state.js';

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
  if (s.status !== status) s.since = now();
  s.status = status;
  if (action != null) s.action = String(action).slice(0, 200);
}

export function applyEvent(store, payload, deps) {
  const { readUsage, maxContext, now } = deps;
  const ev = payload.hook_event_name;
  const s = ensure(store, payload);
  let fightResult = null;

  const recomputeStamina = () => {
    if (!payload.transcript_path) return;
    const u = readUsage(payload.transcript_path);
    if (u) s.stamina = staminaFromContext(u.contextTokens, maxContext);
  };

  switch (ev) {
    case 'SessionStart': {
      if (payload.cwd) { s.name = basename(payload.cwd); s.project = s.name; }
      setStatus(s, 'idle', 'sesión iniciada', now);
      s.monster = null;
      break;
    }
    case 'UserPromptSubmit': {
      s._resting = false;
      setStatus(s, 'working', 'procesando tu pedido', now);
      recomputeStamina();
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
      break;
    }
    case 'SessionEnd': {
      setStatus(s, 'offline', 'sesión cerrada', now);
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
  return { session: s, fightResult };
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
  if (!s.monster) return;
  s.combat.hits++;
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
