import { describe, it, expect, vi, afterEach } from 'vitest'
import { useProjects } from './useProjects'

afterEach(() => { vi.unstubAllGlobals() })

const resp = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('useProjects: clonar repos', () => {
  it('listRepos devuelve repos y errores por owner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, {
      repos: [{ name: 'r', nameWithOwner: 'o/r', description: '', isPrivate: false, updatedAt: '', cloned: false }],
      errors: [{ owner: 'x', message: 'boom' }],
    })))
    const { listRepos } = useProjects()
    const r = await listRepos()
    expect(r?.repos[0].nameWithOwner).toBe('o/r')
    expect(r?.errors).toEqual([{ owner: 'x', message: 'boom' }])
  })

  it('listRepos devuelve null si el server falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(403)))
    const { listRepos } = useProjects()
    expect(await listRepos()).toBeNull()
  })

  it('cloneRepo manda el repo y devuelve el rel clonado', async () => {
    let body: any = null
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body)
      return resp(200, { ok: true, rel: 'r', dir: '/root/r' })
    }))
    const { cloneRepo } = useProjects()
    const r = await cloneRepo('o/r')
    expect(body).toEqual({ repo: 'o/r' })
    expect(r).toEqual({ ok: true, rel: 'r' })
  })

  it('cloneRepo traduce 409/403 y propaga el mensaje de gh', async () => {
    const { cloneRepo } = useProjects()
    vi.stubGlobal('fetch', vi.fn(async () => resp(409)))
    expect(await cloneRepo('o/r')).toMatchObject({ ok: false, message: expect.stringMatching(/ya existe/) })
    vi.stubGlobal('fetch', vi.fn(async () => resp(403)))
    expect(await cloneRepo('o/r')).toMatchObject({ ok: false, message: expect.stringMatching(/permitido/) })
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { ok: false, message: 'repo not found' })))
    expect(await cloneRepo('o/r')).toEqual({ ok: false, message: 'repo not found' })
  })
})
