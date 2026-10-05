import { describe, it, expect, vi, afterEach } from 'vitest'
import { useProjects } from './useProjects'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('useProjects: config e .env', () => {
  it('saveConfig manda PATCH con la config y propaga el error del server', async () => {
    let init: any = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, i: any) => { if (url === '/projects' && i?.method === 'PATCH') init = i; return resp(200, {}) }))
    const { saveConfig } = useProjects()
    const cfg = { related: [{ dir: '/r/d', name: 'infra' }], infra: null, envFiles: [] }
    expect(await saveConfig('/r/back', cfg)).toEqual({ ok: true })
    expect(JSON.parse(init.body)).toEqual({ dir: '/r/back', ...cfg })
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { error: 'relacionado x: no es un repo git' })))
    expect(await saveConfig('/r/back', cfg)).toEqual({ ok: false, error: 'relacionado x: no es un repo git' })
  })

  it('getEnv e importEnv arman la query y devuelven null si falla', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp(200, { content: 'A=1' }) }))
    const { getEnv, importEnv } = useProjects()
    expect(await getEnv('/r/back', 'infra', 'docker/.env')).toBe('A=1')
    expect(urls[0]).toBe('/projects/env?dir=%2Fr%2Fback&repo=infra&path=docker%2F.env')
    await importEnv('/r/back', 'self', '.env')
    expect(urls[1]).toBe('/projects/env/import?dir=%2Fr%2Fback&repo=self&path=.env')
    vi.stubGlobal('fetch', vi.fn(async () => resp(404)))
    expect(await importEnv('/r/back', 'self', '.env')).toBeNull()
  })

  it('saveEnv devuelve las variables desconocidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { unknown: ['{{x}}'] })))
    const { saveEnv } = useProjects()
    expect(await saveEnv('/r/back', 'self', '.env', 'A={{x}}')).toEqual({ ok: false, unknown: ['{{x}}'], error: 'variables desconocidas: {{x}}' })
    vi.stubGlobal('fetch', vi.fn(async () => resp(200)))
    expect(await saveEnv('/r/back', 'self', '.env', 'A=1')).toEqual({ ok: true })
  })
})
