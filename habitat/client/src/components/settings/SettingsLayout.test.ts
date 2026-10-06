import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', async (orig) => ({
  ...(await orig<typeof import('../../composables/useLayoutMode')>()),
  useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {}, allCollapsed: ref(false), setCollapsedAll: () => {} }),
}))
vi.mock('../ProjectsManager.vue', () => ({ default: { template: '<div data-test="projects-stub" />' } }))
vi.mock('./ProjectsSettings.vue', () => ({ default: { template: '<div data-test="projects-settings-stub" />' } }))
import SettingsLayout from './SettingsLayout.vue'
import { createHabitatRouter } from '../../router'

async function mountAt(path: string) {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push(path); await router.isReady()
  return { w: mount(SettingsLayout, { global: { plugins: [router] } }), router }
}

beforeEach(() => { mode.value = 'landscape' })

describe('SettingsLayout', () => {
  it('la nav lista las secciones en orden, con Apariencia activa en /settings/appearance', async () => {
    const { w } = await mountAt('/settings/appearance')
    const links = w.findAll('[data-test="settings-link"]')
    expect(links.map((l) => l.text())).toEqual(['General', 'Apariencia', 'Proyectos', 'Cuenta'])
    expect(links[1].attributes('aria-current')).toBe('page')
    expect(links[0].attributes('aria-current')).toBeUndefined()
    expect(w.find('[data-test="theme-card"]').exists()).toBe(true)
  })

  it('en /settings/account muestra AccountSettings', async () => {
    const { w } = await mountAt('/settings/account')
    expect(w.find('[data-test="account-user"]').exists()).toBe(true)
  })

  it('en /settings/projects muestra ProjectsSettings', async () => {
    const { w } = await mountAt('/settings/projects')
    expect(w.find('[data-test="projects-settings-stub"]').exists()).toBe(true)
    expect(w.find('[data-test="projects-stub"]').exists()).toBe(false)
  })

  it('en la página de un proyecto muestra ProjectsManager (legacy, hasta la Task 4) con Proyectos activo', async () => {
    const { w } = await mountAt('/settings/projects/back/general')
    expect(w.find('[data-test="projects-stub"]').exists()).toBe(true)
    expect(w.find('[data-test="projects-settings-stub"]').exists()).toBe(false)
    const links = w.findAll('[data-test="settings-link"]')
    expect(links[2].attributes('aria-current')).toBe('page')
  })

  it('en landscape la nav es flex-col y en portrait no', async () => {
    mode.value = 'landscape'
    const { w: wLandscape } = await mountAt('/settings/appearance')
    expect(wLandscape.get('[data-test="settings-nav"]').classes()).toContain('flex-col')
    mode.value = 'portrait'
    const { w: wPortrait } = await mountAt('/settings/appearance')
    expect(wPortrait.get('[data-test="settings-nav"]').classes()).not.toContain('flex-col')
  })
})
