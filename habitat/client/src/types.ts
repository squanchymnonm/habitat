// Contrato de sesión (lo manda el backend por WS, derivado de los hooks de Claude Code).
// Debe quedar alineado con habitat/server/state.js + spec §5 + capa RPG §B.

export type Status = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline'

export interface Monster {
  type: string // hash del label (quest) o aleatorio (turno): elige el sprite
  isBoss: boolean
  label: string
  source?: 'todo' | 'turn' // 'todo': monstruo de quest; 'turn': monstruo de turno (uso interno del server)
}

export interface Quest {
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
  quest?: Quest
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

// server -> client
export type ServerMessage =
  | { type: 'snapshot'; sessions: Session[] }
  | { type: 'session'; session: Session }
  | { type: 'remove'; id: string }
  | { type: 'fightResult'; id: string; result: FightResult }
  | { type: 'settings'; settings: Settings }

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
