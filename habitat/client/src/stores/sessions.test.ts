import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useSessions } from './sessions'
import type { Session } from '../types'

const mk = (id: string): Session => ({
  id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100,
})

describe('sessions store — selección', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('auto-selecciona el primero al recibir el snapshot', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b')])
    expect(s.selectedId).toBe('a')
  })

  it('reselecciona al primero si se elimina el seleccionado', () => {
    const s = useSessions()
    s.setAll([mk('a'), mk('b')])
    s.select('a')
    s.remove('a')
    expect(s.selectedId).toBe('b')
  })

  it('queda en null si no quedan sesiones', () => {
    const s = useSessions()
    s.setAll([])
    expect(s.selectedId).toBe(null)
  })

  it('al hacer upsert de la primera sesión la selecciona', () => {
    const s = useSessions()
    s.upsert(mk('z'))
    expect(s.selectedId).toBe('z')
  })
})
