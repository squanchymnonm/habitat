import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import type { Project } from '../../types'
import { PALETTE } from '../../palette'

const projects = ref<Project[]>([])
const error = ref('')
const loaded = ref(true)
const updateProject = vi.fn<(p: { dir: string; label?: string; color?: string; chars?: string[] }) => Promise<boolean>>()
const removeProject = vi.fn<(dir: string) => Promise<boolean>>()
const saveConfig = vi.fn()
const browse = vi.fn()
const getEnv = vi.fn()
const importEnv = vi.fn()
const saveEnv = vi.fn()

vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ projects, loaded, error, updateProject, removeProject, saveConfig, browse, getEnv, importEnv, saveEnv }),
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
  loaded.value = true
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

  it('mientras la lista no llegó muestra "Cargando…", no "no encontrado"', async () => {
    projects.value = []
    loaded.value = false
    const { w } = await mountAt('/settings/projects/back/infra')
    expect(w.text()).toContain('Cargando…')
    expect(w.text()).not.toContain('Proyecto no encontrado')
    projects.value = [{ dir: '/p/back', name: 'Back', color: '#61afef', related: [], infra: null, envFiles: [] }]
    loaded.value = true
    await flushPromises()
    expect(w.get('[data-test="project-title"]').text()).toBe('Back')
    expect(w.find('[data-test="infra-repo"]').exists()).toBe(true)
    w.unmount()
  })

  it('el borrador es por proyecto: cambiar de proyecto no arrastra lo editado', async () => {
    projects.value = [
      { dir: '/p/back', name: 'Back', color: '#61afef', related: [], infra: null, envFiles: [] },
      { dir: '/p/front', name: 'Front', color: '#e06c75', related: [], infra: { repo: 'self', path: 'ops', up: '', down: '' }, envFiles: [] },
    ]
    const { w, router } = await mountAt('/settings/projects/back/infra')
    await w.get('[data-test="infra-repo"]').setValue('self')
    await w.get('[data-test="infra-path"]').setValue('editado')
    await router.push('/settings/projects/front/infra')
    await flushPromises()
    expect((w.get('[data-test="infra-path"]').element as HTMLInputElement).value).toBe('ops')
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

  it('clics seguidos en personajes no se pisan aunque la lista no se haya recargado', async () => {
    updateProject.mockReturnValue(new Promise(() => {})) // el server nunca contesta
    const { w } = await mountAt('/settings/projects/back/general')
    const chars = w.findAll('[data-test="project-char"]')
    await chars[0].trigger('click')
    await chars[1].trigger('click')
    expect(updateProject).toHaveBeenLastCalledWith({ dir: '/p/back', chars: ['Boy', 'Cavegirl'] })
    expect(chars[1].attributes('aria-pressed')).toBe('true')
    w.unmount()
  })

  it('un cambio de label que llega del server no pisa lo que se está escribiendo', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    const label = w.get('[data-test="project-label"]')
    await label.setValue('Escribiendo')
    projects.value = [{ ...projects.value[0], name: 'Otro' }]
    await flushPromises()
    expect((label.element as HTMLInputElement).value).toBe('Escribiendo')
    w.unmount()
  })

  it('un cambio de label del server se refleja si no se estaba editando', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    projects.value = [{ ...projects.value[0], name: 'Otro' }]
    await flushPromises()
    expect((w.get('[data-test="project-label"]').element as HTMLInputElement).value).toBe('Otro')
    w.unmount()
  })
})
