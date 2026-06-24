// Contrato de sesión (lo manda el backend por WS, derivado de los hooks de Claude Code).
// Debe quedar alineado con habitat/server/state.js + spec §5 + capa RPG §B.

export type Status = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline'

export interface Monster {
  type: string // hash del label (quest) o aleatorio (turno): elige el sprite
  isBoss: boolean
  label: string
  source?: 'todo' | 'turn' // 'todo': monstruo de quest; 'turn': monstruo de turno (uso interno del server)
}

export interface SessionQuest {
  total: number
  done: number
}

export interface Combat {
  hits: number
  tokens: number // HP oculto del monstruo (suma del daño)
  lastDamage?: number
}

export interface Session {
  id: string
  name: string
  project: string
  branch: string
  status: Status
  action: string
  since: number
  tmux?: string
  char?: string // personaje elegido al crear; si no, se deriva por hash del nombre
  // --- capa RPG ---
  stamina: number // 0..100 = context restante
  quest?: SessionQuest
  monster?: Monster | null
  combat?: Combat
}

export interface FightResult {
  monster: string
  hp: number
  hits: number
  loot: string[]
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface Settings {
  permissionMode: PermissionMode
}

export interface Project {
  dir: string
  name: string // label mostrado
  color: string
  chars?: string[]
}

// server -> client
export type ServerMessage =
  | { type: 'snapshot'; sessions: Session[] }
  | { type: 'session'; session: Session }
  | { type: 'remove'; id: string }
  | { type: 'rekey'; from: string; to: string; session: Session }
  | { type: 'fightResult'; id: string; result: FightResult }
  | { type: 'settings'; settings: Settings }
  | { type: 'projects'; projects: Project[] }
  | { type: 'reorder'; order: string[] }

// client -> server (fase 2: chat por send-keys)
export type ClientMessage = { type: 'chat'; id: string; text: string }

export const STATUS_LABEL: Record<Status, string> = {
  idle: 'quieta',
  working: 'trabajando',
  waiting: 'te necesita',
  done: 'lista',
  error: 'error',
  offline: 'caída',
}

export interface Quest {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  originPrompt: string
  claudeSummary: string
  monster: string | null
  damage: number
  hits: number
  since: number
}

export interface QuestEvent {
  type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared'
  label: string
  detail: string
  ts: number
}

export interface QuestBook {
  synopsis: string
  quests: Quest[]
  events: QuestEvent[]
}
