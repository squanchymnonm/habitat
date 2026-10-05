import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ProjectsManager from './ProjectsManager.vue'

afterEach(() => { vi.unstubAllGlobals() })

const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const REPOS = {
  repos: [
    { name: 'habitat', nameWithOwner: 'MNONM-SOFTWARE/habitat', description: 'monitor', isPrivate: true, updatedAt: '2026-02-01', cloned: false },
    { name: 'otro', nameWithOwner: 'squanchymnonm/otro', description: '', isPrivate: false, updatedAt: '2026-01-01', cloned: true },
  ],
  errors: [{ owner: 'caido', message: 'sin acceso' }],
}

function stubServer(calls: { url: string; body?: any }[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    if (url === '/projects') return resp({ canSpawn: false, canManage: true, canClone: true, projects: [] })
    if (url === '/projects/repos') return resp(REPOS)
    if (url === '/projects/clone') return resp({ ok: true, rel: 'habitat', dir: '/root/habitat' })
    if (url.startsWith('/projects/browse')) return resp({ root: 'proyectos', rel: '', breadcrumbs: [], entries: [{ name: 'habitat', rel: 'habitat', isRepo: true, added: false }] })
    return resp({}, 404)
  }))
}

describe('ProjectsManager: clonar repo', () => {
  it('lista los repos, filtra, marca los ya clonados y muestra errores por owner', async () => {
    stubServer([])
    const w = mount(ProjectsManager)
    await flushPromises()
    await w.get('[data-test="clone-open"]').trigger('click')
    await flushPromises()
    const rows = w.findAll('[data-test="repo"]')
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining('MNONM-SOFTWARE/habitat'),
      expect.stringContaining('squanchymnonm/otro'),
    ])
    expect(rows[1].get('button').text()).toBe('ya clonado')
    expect(rows[1].get('button').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('caido: sin acceso')
    await w.get('[data-test="repo-filter"]').setValue('otro')
    expect(w.findAll('[data-test="repo"]')).toHaveLength(1)
  })

  it('al clonar abre el alta precargada con la carpeta clonada', async () => {
    const calls: { url: string; body?: any }[] = []
    stubServer(calls)
    const w = mount(ProjectsManager)
    await flushPromises()
    await w.get('[data-test="clone-open"]').trigger('click')
    await flushPromises()
    await w.findAll('[data-test="repo"]')[0].get('button').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.url === '/projects/clone')?.body).toEqual({ repo: 'MNONM-SOFTWARE/habitat' })
    expect(w.find('[data-test="repo"]').exists()).toBe(false)
    expect((w.get('.draft input').element as HTMLInputElement).value).toBe('habitat')
  })
})
