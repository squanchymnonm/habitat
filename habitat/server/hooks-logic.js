import { basename } from 'node:path';
import { newSession, questFromTodos, monsterFromTodos, randomMonster } from './state.js';
import { emptyBook, setSynopsis, upsertQuests, setClaudeSummary, completeQuest,
  ensureLooseQuest, activeQuestId, openExchange, closeExchange } from './questbook.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export function staminaFromStatus(body) {
  const used = body && body.context_window && body.context_window.used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

function ensure(store, payload) {
  let s = store.get(payload.session_id);
  if (!s) {
    s = newSession(payload.session_id, {});
    s._touched = new Set();
    store.upsert(s);
  }
  if (!s._touched) s._touched = new Set();
  if (!s._questbook) s._questbook = emptyBook();
  if (s._currentPrompt == null) s._currentPrompt = '';
  return s;
}

function setStatus(s, status, action, now) {
  if (s.status !== status || !s.since) s.since = now();
  s.status = status;
  if (action != null) s.action = String(action).slice(0, 200);
}

function ensureMonster(s) {
  if (!s.monster) s.monster = randomMonster(s.action || 'trabajando');
}

// Resuelve la identidad del pod (name + tmux) desde el cwd igual que el SessionStart
// normal: bajo worktree manda el worktree (project + tmux derivados), si no el basename.
// La tmux manual (payload.tmux) sólo aplica fuera de un worktree.
function resolveIdentity(payload, deps) {
  const name = payload.cwd ? basename(payload.cwd) : null;
  let tmux = null;
  if (payload.cwd && deps.worktreeName) {
    const wt = deps.worktreeName(payload.cwd);
    if (wt) tmux = wt.tmux;
  }
  if (!tmux && payload.tmux) tmux = payload.tmux;
  return { name, tmux };
}

// El pod vivo de una tmux: la tmux es la clave única real (dos worktrees del mismo
// proyecto comparten name pero tienen tmux distinta). Matcheamos por tmux cuando la
// hay; si no, caemos al name. Devolvemos el más reciente si hubiera duplicados.
function findPodByTmux(store, { name, tmux }, exceptId) {
  const matches = store.all().filter((s) => {
    if (s.id === exceptId) return false;
    return tmux ? s.tmux === tmux : s.name === name && !s.tmux;
  });
  if (!matches.length) return null;
  return matches.sort((a, b) => (b.since || 0) - (a.since || 0))[0];
}

export function applyEvent(store, payload, deps) {
  const { readUsage, now } = deps;
  const ev = payload.hook_event_name;

  // /clear cierra la sesión vieja y abre una nueva (otro session_id) sobre la MISMA
  // tmux. No queremos un pod "caído" + uno nuevo (cerrar el caído mataría la tmux
  // compartida, y con ella la sesión nueva): reusamos el pod existente, lo rekeyeamos
  // al id nuevo y le recargamos la stamina (clear vacía el contexto).
  if (ev === 'SessionStart' && payload.source === 'clear' && payload.cwd) {
    const { name, tmux } = resolveIdentity(payload, deps);
    const prev = findPodByTmux(store, { name, tmux }, payload.session_id);
    if (prev) {
      const oldId = prev.id;
      store.remove(prev.id);
      prev.id = payload.session_id;
      prev.name = name;
      if (tmux) prev.tmux = tmux;
      prev.stamina = 100;
      prev.monster = null;
      prev.combat = { hits: 0, tokens: 0 };
      prev._lastTotal = 0;
      prev._touched = new Set();
      const pendingChar = store.takePendingChar(tmux || name);
      if (pendingChar) prev.char = pendingChar;
      if (deps.gitBranch) prev.branch = deps.gitBranch(payload.cwd) || prev.branch;
      setStatus(prev, 'idle', 'memoria despejada', now);
      if (!prev._questbook) prev._questbook = emptyBook();
      store.upsert(prev);
      // El rekey cambió el id del pod (viejo -> nuevo). El front trackea las cards por id,
      // así que hay que avisarle que borre la del id viejo; si no, queda colgada y se ve
      // como un pod duplicado (la nueva se agrega, la vieja nunca se saca).
      return { session: prev, fightResult: null, rekey: { from: oldId, to: prev.id } };
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

  switch (ev) {
    case 'SessionStart': {
      if (payload.cwd) {
        // El nombre del pod es el personaje (leaf del worktree). El proyecto real sale
        // del worktree (su carpeta padre); fuera de un worktree, proyecto = name.
        s.name = basename(payload.cwd);
        const wt = deps.worktreeName ? deps.worktreeName(payload.cwd) : null;
        if (wt) {
          s.project = wt.project;
          s.tmux = wt.tmux;
        } else {
          s.project = s.name;
        }
        if (deps.gitBranch) s.branch = deps.gitBranch(payload.cwd) || '';
      }
      // Sesión lanzada a mano dentro de tmux: el hook reporta el nombre de la tmux para
      // que el panel pueda attachear terminal/chat. El worktree (arriba) tiene prioridad.
      if (!s.tmux && payload.tmux) s.tmux = payload.tmux;
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
      s._currentPrompt = payload.prompt ? String(payload.prompt).slice(0, 200) : '';
      setSynopsis(s._questbook, s._currentPrompt);
      if (s._openExchange) {
        closeExchange(s._questbook, s._openExchange, payload.prompt || '');
        s._openExchange = null;
      }
      setStatus(s, 'working', 'procesando tu pedido', now);
      // Sin quest activa, cada prompt trae un monstruo de turno nuevo (aleatorio) y
      // arranca un combate limpio. Con quest activa la dejamos correr entre turnos.
      if (s.monster?.source !== 'todo') {
        s.monster = randomMonster(payload.prompt ? String(payload.prompt).slice(0, 80) : 'enemigo');
        s.combat = { hits: 0, tokens: 0 };
        s._touched = new Set();
      }
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
      // La stamina la maneja el statusLine (POST /status): refleja el % real de context
      // window por sesión. Acá sólo marcamos el estado "descansando"; el próximo evento
      // de statusLine actualiza el orbe con el contexto ya compactado.
      setStatus(s, 'working', 'descansando (compactando)', now);
      break;
    }
    case 'Stop': {
      const done = s.quest && s.quest.total > 0 && s.quest.done >= s.quest.total;
      setStatus(s, done ? 'done' : 'idle', done ? 'dungeon cleared' : 'a la espera', now);
      // El monstruo de turno muere al cerrar el turno; si peleó (hubo daño o golpes)
      // suelta loot. El de quest sobrevive entre turnos hasta completarse el todo.
      if (s.monster && s.monster.source === 'turn') {
        if (s.combat.tokens > 0 || s.combat.hits > 0) {
          const loot = s._touched && s._touched.size ? [...s._touched] : [s.monster.label];
          fightResult = { id: s.id, result: {
            monster: s.monster.label, hp: s.combat.tokens, hits: s.combat.hits, loot,
          } };
        }
        s.monster = null;
        s.combat = { hits: 0, tokens: 0 };
        s._touched = new Set();
      }
      const dialogueQuestId = activeQuestId(s._questbook)
        ?? ensureLooseQuest(s._questbook, { now: now() }).id;
      const claudeText = deps.readLastAssistantText
        ? deps.readLastAssistantText(payload.transcript_path, 600)
        : '';
      s._openExchange = openExchange(s._questbook, dialogueQuestId, claudeText, { now: now() });
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
        fightResult = handleTodoWrite(s, payload, now, deps);
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

function handleTodoWrite(s, payload, now, deps) {
  const todos = (payload.tool_input && payload.tool_input.todos) || [];
  const prevDone = s.quest ? s.quest.done : 0;
  const prevLabel = s.monster ? s.monster.label : null;
  s.quest = questFromTodos(todos);
  let fightResult = null;

  // Quest Book: acumular quests (no borra las que salen del plan).
  upsertQuests(s._questbook, todos, { originPrompt: s._currentPrompt, now: now() });

  // ¿se completó un todo? (subió done) -> cayó el monstruo anterior
  if (s.quest.done > prevDone && prevLabel) {
    const loot = s._touched && s._touched.size ? [...s._touched] : [prevLabel];
    fightResult = { id: s.id, result: {
      monster: prevLabel, hp: s.combat.tokens, hits: s.combat.hits, loot,
    } };
    // Quest Book: estampar monstruo + daño en la quest completada.
    completeQuest(s._questbook, prevLabel, { monster: prevLabel, damage: s.combat.tokens, hits: s.combat.hits });
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
  // Quest Book: capturar el resumen de Claude cuando una quest entra en curso.
  // Solo leemos el transcript si la quest todavía no tiene resumen (setClaudeSummary
  // es write-once: leer de nuevo sería trabajo descartado).
  if (next && deps && deps.readLastAssistantText) {
    const q = s._questbook.quests.find((x) => x.id === next.label);
    if (q && !q.claudeSummary) {
      setClaudeSummary(s._questbook, next.label, deps.readLastAssistantText(payload.transcript_path));
    }
  }
  setStatus(s, 'working', 'planificando', now);
  return fightResult;
}

function handleHit(s, payload, deps) {
  const { readUsage, now } = deps;
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
    }
  }
}
