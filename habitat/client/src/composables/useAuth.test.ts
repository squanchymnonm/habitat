import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuth } from './useAuth'

beforeEach(() => { vi.restoreAllMocks() })

describe('useAuth', () => {
  it('checkAuth pone authed=true si /auth/me responde 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(true)
  })

  it('checkAuth pone authed=false si /auth/me responde 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(false)
  })

  it('login devuelve true y setea authed en 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 204, ok: true })) as any)
    const a = useAuth()
    const ok = await a.login('nico', 'clave')
    expect(ok).toBe(true)
    expect(a.authed.value).toBe(true)
  })

  it('login devuelve false en 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    expect(await a.login('nico', 'mala')).toBe(false)
  })
})
