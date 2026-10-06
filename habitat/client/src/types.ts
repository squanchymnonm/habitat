// Contrato de sesión (lo manda el backend por WS, derivado de los hooks de Claude Code).
// Debe quedar alineado con habitat/server/state.js + spec §5 + capa RPG §B.

export type Status = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline'

export interface SessionQuest {
  total: number
  done: number
}

export interface SessionInfra {
  stack: string
  ports: Record<string, number>
  dir: string | null
  branch: string
  state?: 'up' | 'partial' | 'off'
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
  infra?: SessionInfra
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface Settings {
  permissionMode: PermissionMode
}

export interface RelatedRepo { dir: string; name: string; exists?: boolean }
export interface InfraConfig { repo: string; path: string; up: string; down: string }
export interface EnvFile { repo: string; path: string }

export interface Project {
  dir: string
  name: string // label mostrado
  color: string
  chars?: string[]
  related?: RelatedRepo[]
  infra?: InfraConfig | null
  envFiles?: EnvFile[]
}

export interface Usage { pct: number; resetAt: number } // resetAt: epoch en segundos

// server -> client
export type ServerMessage =
  | { type: 'snapshot'; sessions: Session[]; usage?: Usage | null }
  | { type: 'usage'; usage: Usage | null }
  | { type: 'session'; session: Session }
  | { type: 'remove'; id: string }
  | { type: 'rekey'; from: string; to: string; session: Session }
  | { type: 'settings'; settings: Settings }
  | { type: 'projects'; projects: Project[] }
  | { type: 'reorder'; order: string[] }

// client -> server (fase 2: chat por send-keys)
export type ClientMessage =
  | { type: 'chat'; id: string; text: string }
  | { type: 'dismiss'; id: string }

export const STATUS_LABEL: Record<Status, string> = {
  idle: 'quieta',
  working: 'trabajando',
  waiting: 'te necesita',
  done: 'lista',
  error: 'error',
  offline: 'caída',
}

// Token de color (--state-*) para cada estado. offline se ve como quieta (atenuada).
export const STATE_TOKEN: Record<Status, 'working' | 'waiting' | 'done' | 'idle' | 'error'> = {
  idle: 'idle', working: 'working', waiting: 'waiting', done: 'done', error: 'error', offline: 'idle',
}

// Clase de color de texto (--state-*) para cada token, en texto de UI (SessionList, SessionSidebar).
// Clases literales (no interpoladas) para que Tailwind las detecte.
export const STATE_TEXT: Record<'working' | 'waiting' | 'done' | 'idle' | 'error', string> = {
  working: 'text-state-working', waiting: 'text-state-waiting', done: 'text-state-done', idle: 'text-muted', error: 'text-state-error',
}

export interface QuestExchange {
  claude: string
  you: string
  ts: number
}

export interface Quest {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  loose?: boolean
  originPrompt: string
  claudeSummary: string
  monster?: string | null
  damage?: number
  hits?: number
  since: number
  dialogue: QuestExchange[]
}

// Deprecado: el libro ya no genera eventos de combate. Se conserva el tipo y el
// campo opcional por compatibilidad del payload.
export interface QuestEvent {
  type: 'quest_completed' | 'boss_defeated' | 'error' | 'waiting' | 'cleared' | 'dungeon_cleared'
  label: string
  detail: string
  ts: number
}

export interface QuestBook {
  synopsis: string
  quests: Quest[]
  events?: QuestEvent[]
}
