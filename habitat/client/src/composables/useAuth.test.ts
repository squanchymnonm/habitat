import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuth } from './useAuth'

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('location', { search: '' }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('useAuth', () => {
  it('checkAuth pone authed=true si /auth/me responde 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(true)
  })

  it('checkAuth manda el token de la query a /auth/me (back-compat sin login)', async () => {
    vi.stubGlobal('location', { search: '?token=secreto' })
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true }))
    vi.stubGlobal('fetch', fetchMock as any)
    const a = useAuth()
    await a.checkAuth()
    expect(fetchMock).toHaveBeenCalledWith('/auth/me', { headers: { authorization: 'Bearer secreto' } })
  })

  it('checkAuth pone authed=false si /auth/me responde 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.authed.value).toBe(false)
  })

  it('login devuelve true, setea authed y trae el usuario (vuelve a llamar checkAuth)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 204, ok: true }) // /login
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ user: 'nico' }) }) // checkAuth → /auth/me
    vi.stubGlobal('fetch', fetchMock as any)
    const a = useAuth()
    const ok = await a.login('nico', 'clave')
    expect(ok).toBe(true)
    expect(a.authed.value).toBe(true)
    expect(a.user.value).toBe('nico')
  })

  it('login ok + /auth/me falla por red: authed sigue en true, sólo user queda null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 204, ok: true }) // /login
      .mockRejectedValueOnce(new Error('network')) // /auth/me
    vi.stubGlobal('fetch', fetchMock as any)
    const a = useAuth()
    const ok = await a.login('nico', 'clave')
    expect(ok).toBe(true)
    expect(a.authed.value).toBe(true)
    expect(a.user.value).toBe(null)
  })

  it('login devuelve false en 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    expect(await a.login('nico', 'mala')).toBe(false)
  })

  it('checkAuth pone user con el que viene en /auth/me', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ user: 'mnonm' }) })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.user.value).toBe('mnonm')
  })

  it('checkAuth pone user=null si /auth/me no manda user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ user: null }) })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.user.value).toBe(null)
  })

  it('checkAuth pone user=null en 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.user.value).toBe(null)
  })

  it('logout deja user en null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ user: 'mnonm' }) })) as any)
    const a = useAuth()
    await a.checkAuth()
    expect(a.user.value).toBe('mnonm')
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 204 })) as any)
    await a.logout()
    expect(a.user.value).toBe(null)
  })
})
