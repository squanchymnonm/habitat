import { describe, it, expect } from 'vitest'
import { newlyWaiting } from './tabAlert'

describe('newlyWaiting', () => {
  it('devuelve los ids nuevos que no estaban antes', () => {
    const prev = new Set(['a'])
    const current = new Set(['a', 'b', 'c'])
    expect(newlyWaiting(prev, current)).toEqual(['b', 'c'])
  })

  it('no devuelve nada si no hay nuevos', () => {
    expect(newlyWaiting(new Set(['a', 'b']), new Set(['a']))).toEqual([])
    expect(newlyWaiting(new Set(['a']), new Set(['a']))).toEqual([])
  })

  it('desde vacío devuelve todos los actuales', () => {
    expect(newlyWaiting(new Set(), new Set(['x', 'y']))).toEqual(['x', 'y'])
  })
})
