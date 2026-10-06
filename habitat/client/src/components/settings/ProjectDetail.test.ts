import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import type { Project } from '../../types'
import { PALETTE } from '../../palette'

const projects = ref<Project[]>([])
const error = ref('')
const updateProject = vi.fn<(p: { dir: string; label?: string; color?: string; chars?: string[] }) => Promise<boolean>>()
const removeProject = vi.fn<(dir: string) => Promise<boolean>>()
const saveConfig = vi.fn()
const browse = vi.fn()
const getEnv = vi.fn()
const importEnv = vi.fn()
const saveEnv = vi.fn()

vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ projects, error, updateProject, removeProject, saveConfig, browse, getEnv, importEnv, saveEnv }),
}))

import ProjectDetail from './ProjectDetail.vue'
import { createHabitatRouter } from '../../router'

async function mountAt(path: string) {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const w = mount(ProjectDetail, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  vi.clearAllMocks()
  projects.value = [{ dir: '/p/back', name: 'Back', color: '#61afef', related: [], infra: null, envFiles: [] }]
  error.value = ''
  updateProject.mockResolvedValue(true)
  removeProject.mockResolvedValue(true)
})

describe('ProjectDetail', () => {
  it('muestra el proyecto por su carpeta y la pestaña de la URL', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    expect(w.get('[data-test="project-title"]').text()).toBe('Back')
    const tabs = w.findAll('[data-test="project-tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['General', 'Relacionados', 'Infra', 'Archivos .env'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[2].attributes('aria-selected')).toBe('false')
    expect(w.find('[data-test="project-label"]').exists()).toBe(true)
    // General no tiene el guardado de configuración.
    expect(w.find('[data-test="save-config"]').exists()).toBe(false)
    w.unmount()
  })

  it('cambiar de pestaña actualiza la URL', async () => {
    const { w, router } = await mountAt('/settings/projects/back/general')
    const infra = w.findAll('[data-test="project-tab"]').find((t) => t.text() === 'Infra')!
    await infra.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/settings/projects/back/infra'))
    await flushPromises()
    expect(w.findAll('[data-test="project-tab"]')[2].attributes('aria-selected')).toBe('true')
    expect(w.find('[data-test="infra-repo"]').exists()).toBe(true)
    expect(w.find('[data-test="save-config"]').exists()).toBe(true)
    w.unmount()
  })

  it('sin pestaña en la URL abre General', async () => {
    const { w } = await mountAt('/settings/projects/back')
    expect(w.findAll('[data-test="project-tab"]')[0].attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('proyecto inexistente: aviso y link a la lista', async () => {
    const { w } = await mountAt('/settings/projects/nada/general')
    expect(w.text()).toContain('Proyecto no encontrado')
    expect(w.find('[data-test="project-tab"]').exists()).toBe(false)
    expect(w.find('a[href="/settings/projects"]').exists()).toBe(true)
    w.unmount()
  })

  it('quitar pide confirmación y vuelve a la lista', async () => {
    const { w, router } = await mountAt('/settings/projects/back/general')
    await w.get('[data-test="project-remove"]').trigger('click')
    await flushPromises()
    expect(removeProject).not.toHaveBeenCalled()
    const ok = document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement
    expect(ok).not.toBeNull()
    ok.click()
    await flushPromises()
    expect(removeProject).toHaveBeenCalledWith('/p/back')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/settings/projects'))
    w.unmount()
  })

  it('cambiar el color guarda con updateProject', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    const swatches = w.findAll('[data-test="project-color"]')
    expect(swatches).toHaveLength(PALETTE.length)
    await swatches[1].trigger('click')
    expect(updateProject).toHaveBeenCalledWith({ dir: '/p/back', color: PALETTE[1] })
    w.unmount()
  })

  it('el label guarda con updateProject y los personajes también', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    const label = w.get('[data-test="project-label"]')
    await label.setValue('Backend')
    await label.trigger('change')
    expect(updateProject).toHaveBeenCalledWith({ dir: '/p/back', label: 'Backend' })
    await w.findAll('[data-test="project-char"]')[0].trigger('click')
    expect(updateProject).toHaveBeenLastCalledWith({ dir: '/p/back', chars: ['Boy'] })
    w.unmount()
  })
})
