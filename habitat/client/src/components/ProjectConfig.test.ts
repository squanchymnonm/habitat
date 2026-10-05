import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ProjectConfig from './ProjectConfig.vue'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const PROJECT = {
  dir: '/root/back', name: 'back', color: '#fff', chars: [],
  related: [{ dir: '/root/docker', name: 'infra' }],
  infra: { repo: 'infra', path: '', up: 'make up', down: '' },
  envFiles: [{ repo: 'infra', path: '.env' }],
}

function stub(calls: { url: string; method?: string; body?: any }[], over: Record<string, any> = {}) {
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

describe('ProjectConfig', () => {
  it('muestra la config actual y guarda los cambios de infra', async () => {
    const calls: any[] = []
    stub(calls)
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    expect(w.text()).toContain('infra')
    expect((w.get('[data-test="infra-repo"]').element as HTMLSelectElement).value).toBe('infra')
    await w.get('[data-test="infra-path"]').setValue('docker')
    await w.get('[data-test="save-config"]').trigger('click')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch.body).toEqual({
      dir: '/root/back', related: PROJECT.related,
      infra: { repo: 'infra', path: 'docker', up: 'make up', down: '' }, envFiles: PROJECT.envFiles,
    })
  })

  it('agrega un relacionado desde el navegador (sólo repos) con nombre = carpeta', async () => {
    const calls: any[] = []
    stub(calls)
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    await w.get('[data-test="related-add"]').trigger('click')
    await flushPromises()
    const picks = w.findAll('[data-test="related-pick"]')
    expect(picks).toHaveLength(2)
    expect(picks[1].attributes('disabled')).toBeDefined() // 'plain' no es repo
    await picks[0].trigger('click')
    expect(w.findAll('[data-test="related-row"]').map((r) => (r.get('input').element as HTMLInputElement).value)).toEqual(['infra', 'front'])
  })

  it('marca en rojo un relacionado que ya no existe', async () => {
    stub([])
    const w = mount(ProjectConfig, { props: { project: { ...PROJECT, related: [{ dir: '/root/docker', name: 'infra', exists: false }] } } })
    await flushPromises()
    expect(w.get('[data-test="related-row"]').classes()).toContain('missing')
  })

  it('edita una plantilla: carga, importa, guarda y muestra desconocidas', async () => {
    const calls: any[] = []
    stub(calls, { '/projects/env?': resp({ content: 'A={{port:db}}' }) })
    const w = mount(ProjectConfig, { props: { project: PROJECT } })
    await flushPromises()
    await w.get('[data-test="env-open"]').trigger('click')
    await flushPromises()
    const ta = w.get('[data-test="env-text"]')
    expect((ta.element as HTMLTextAreaElement).value).toBe('A={{port:db}}')
    await w.get('[data-test="env-import"]').trigger('click')
    await flushPromises()
    expect((ta.element as HTMLTextAreaElement).value).toBe('REAL=1')
    stub(calls, { '/projects/env': resp({ unknown: ['{{x}}'] }, 400) })
    await w.get('[data-test="env-save"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('variables desconocidas: {{x}}')
  })
})
