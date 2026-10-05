import { describe, it, expect, vi, afterEach } from 'vitest'
import { useProjects } from './useProjects'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

describe('useProjects.dockerDown', () => {
  it('devuelve los stacks bajados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ stacks: ['a', 'b'] })))
    expect(await useProjects().dockerDown('s1')).toEqual({ ok: true, stacks: ['a', 'b'] })
  })

  it('409: avisa que hay una operación de infra en curso en vez de callar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 409)))
    expect(await useProjects().dockerDown('s1')).toEqual({ ok: false, message: 'ocupado: hay una operación de infra en curso' })
  })

  it('otro error o sin red: mensaje genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)))
    expect(await useProjects().dockerDown('s1')).toEqual({ ok: false, message: 'no se pudo bajar la infra' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await useProjects().dockerDown('s1')).toEqual({ ok: false, message: 'no se pudo bajar la infra' })
  })
})
