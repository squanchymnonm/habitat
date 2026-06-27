import { describe, it, expect } from 'vitest'
import { newlyWaiting, alertActions } from './tabAlert'

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

describe('alertActions', () => {
  it('suena en foco (no notifica)', () => {
    expect(alertActions(1, false)).toEqual({ sound: true, notify: false })
  })

  it('suena y notifica en background', () => {
    expect(alertActions(2, true)).toEqual({ sound: true, notify: true })
  })

  it('sin nuevas, no hace nada', () => {
    expect(alertActions(0, false)).toEqual({ sound: false, notify: false })
    expect(alertActions(0, true)).toEqual({ sound: false, notify: false })
  })
})
