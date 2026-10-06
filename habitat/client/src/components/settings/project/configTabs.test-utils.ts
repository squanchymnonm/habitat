// Stub de fetch compartido por los tests de las pestañas de config del proyecto (casos del viejo panel de config).
import { vi } from 'vitest'

export const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
export const PROJECT = {
  dir: '/root/back', name: 'back', color: '#fff', chars: [],
  related: [{ dir: '/root/docker', name: 'infra' }],
  infra: { repo: 'infra', path: '', up: 'make up', down: '' },
  envFiles: [{ repo: 'infra', path: '.env' }],
}
export type Call = { url: string; method?: string; body?: any }

export function stub(calls: Call[], over: Record<string, any> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined })
    for (const [k, v] of Object.entries(over)) if (url.startsWith(k)) return v
    if (url.startsWith('/projects/env/import')) return resp({ content: 'REAL=1' })
    if (url.startsWith('/projects/env')) return init?.method === 'PUT' ? resp({}) : resp({ content: 'A={{port:db}}' })
    if (url.startsWith('/projects/browse')) return resp({ root: 'proyectos', rel: '', breadcrumbs: [], entries: [
      { name: 'front', rel: 'front', isRepo: true, added: false }, { name: 'plain', rel: 'plain', isRepo: false, added: false }] })
    if (url === '/projects') return resp({ canSpawn: true, canManage: true, projects: [] })
    return resp({}, 404)
  }))
}
