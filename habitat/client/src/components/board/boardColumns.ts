import type { Session, Status } from '../../types'

// Tablero: columnas automáticas según el estado de cada sesión (spec §Tablero).
export type ColumnId = 'need' | 'working' | 'done' | 'quiet'
export interface BoardColumnData { id: ColumnId; title: string; sessions: Session[] }

const COLUMNS: { id: ColumnId; title: string; statuses: Status[] }[] = [
  { id: 'need', title: 'Te necesita', statuses: ['waiting', 'error'] },
  { id: 'working', title: 'Trabajando', statuses: ['working'] },
  { id: 'done', title: 'Lista', statuses: ['done'] },
  { id: 'quiet', title: 'Quietas', statuses: ['idle', 'offline'] },
]

export function boardColumns(list: Session[]): BoardColumnData[] {
  return COLUMNS.map(({ id, title, statuses }) => ({ id, title, sessions: list.filter((s) => statuses.includes(s.status)) }))
}
