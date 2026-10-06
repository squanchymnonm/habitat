import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import type { BrowseResult, RepoList } from '../../composables/useProjects'
import type { Project } from '../../types'
import { PALETTE } from '../../palette'
import { CHARACTERS } from '../../sprites'

const projects = ref<Project[]>([])
const canManage = ref(true)
const canClone = ref(true)
const error = ref('')
const browse = vi.fn<(rel: string) => Promise<BrowseResult | null>>()
const listRepos = vi.fn<() => Promise<RepoList | null>>()
const cloneRepo = vi.fn<(repo: string) => Promise<{ ok: true; rel: string } | { ok: false; message: string }>>()
const addProject = vi.fn<(p: { dir: string; label?: string; color: string; chars?: string[] }) => Promise<boolean>>()

vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ projects, canManage, canClone, error, browse, listRepos, cloneRepo, addProject }),
}))

import ProjectsSettings from './ProjectsSettings.vue'
import { createHabitatRouter } from '../../router'

const REPOS: RepoList = {
  repos: [
    { name: 'habitat', nameWithOwner: 'MNONM-SOFTWARE/habitat', description: 'monitor', isPrivate: true, updatedAt: '2026-02-01', cloned: false },
    { name: 'otro', nameWithOwner: 'squanchymnonm/otro', description: '', isPrivate: false, updatedAt: '2026-01-01', cloned: true },
  ],
  errors: [{ owner: 'caido', message: 'sin acceso' }],
}

async function mountSettings() {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push('/settings/projects')
  await router.isReady()
  return mount(ProjectsSettings, { global: { plugins: [router] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  projects.value = []
  canManage.value = true
  canClone.value = true
  error.value = ''
  browse.mockResolvedValue(null)
  listRepos.mockResolvedValue(null)
  addProject.mockResolvedValue(true)
})

describe('ProjectsSettings: lista y navegación', () => {
  it('cada proyecto linkea a su página', async () => {
    projects.value = [{ dir: '/home/u/proyectos/back', name: 'Back', color: '#61afef' }]
    const w = await mountSettings()
    const a = w.get('[data-test="project-open"]')
    expect(a.attributes('href')).toContain('/settings/projects/back/general')
    expect(w.get('[data-test="project-row"]').text()).toContain('Back')
  })

  it('alta: elegir carpeta, nombre, color y personajes', async () => {
    browse.mockResolvedValue({
      root: 'proyectos', rel: '', breadcrumbs: [],
      entries: [{ name: 'front', rel: 'front', isRepo: false, added: false }],
    })
    const w = await mountSettings()
    await w.get('[data-test="add-open"]').trigger('click')
    await flushPromises()
    await w.get('[data-test="browse-pick"]').trigger('click')
    await w.get('[data-test="draft-name"]').setValue('Front')
    await w.findAll('[data-test="draft-color"]')[1].trigger('click')
    await w.findAll('[data-test="draft-char"]')[0].trigger('click')
    await w.get('[data-test="draft-submit"]').trigger('click')
    await flushPromises()
    expect(addProject).toHaveBeenCalledWith({
      dir: 'front',
      label: 'Front',
      color: PALETTE[1],
      chars: [CHARACTERS[0]],
    })
  })
})

describe('ProjectsSettings: clonar repo', () => {
  it('lista los repos, filtra, marca los ya clonados y muestra errores por owner', async () => {
    listRepos.mockResolvedValue(REPOS)
    const w = await mountSettings()
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
    listRepos.mockResolvedValue(REPOS)
    cloneRepo.mockResolvedValue({ ok: true, rel: 'habitat' })
    browse.mockResolvedValue({ root: 'proyectos', rel: '', breadcrumbs: [], entries: [] })
    const w = await mountSettings()
    await w.get('[data-test="clone-open"]').trigger('click')
    await flushPromises()
    await w.findAll('[data-test="repo"]')[0].get('button').trigger('click')
    await flushPromises()
    expect(cloneRepo).toHaveBeenCalledWith('MNONM-SOFTWARE/habitat')
    expect(w.find('[data-test="repo"]').exists()).toBe(false)
    expect((w.get('[data-test="draft-name"]').element as HTMLInputElement).value).toBe('habitat')
  })
})
