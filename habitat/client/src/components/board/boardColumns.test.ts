import { describe, it, expect } from 'vitest'
import { boardColumns } from './boardColumns'

const s = (id: string, status: string) => ({ id, name: id, project: 'p', branch: '', status, action: '', since: 0, stamina: 100 }) as any

describe('boardColumns', () => {
  it('cuatro columnas en orden, con el estado correcto en cada una', () => {
    const cols = boardColumns([s('a', 'idle'), s('b', 'waiting'), s('c', 'working'), s('d', 'error'), s('e', 'done'), s('f', 'offline')])
    expect(cols.map((c) => c.id)).toEqual(['need', 'working', 'done', 'quiet'])
    expect(cols.map((c) => c.title)).toEqual(['Te necesita', 'Trabajando', 'Lista', 'Quietas'])
    expect(cols[0].sessions.map((x) => x.id)).toEqual(['b', 'd'])
    expect(cols[1].sessions.map((x) => x.id)).toEqual(['c'])
    expect(cols[2].sessions.map((x) => x.id)).toEqual(['e'])
    expect(cols[3].sessions.map((x) => x.id)).toEqual(['a', 'f'])
  })
  it('sin sesiones devuelve las cuatro columnas vacías', () => {
    expect(boardColumns([]).every((c) => c.sessions.length === 0)).toBe(true)
  })
})
