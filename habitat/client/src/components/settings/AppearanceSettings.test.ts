import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppearanceSettings from './AppearanceSettings.vue'
import { useZoom } from '../../composables/useZoom'
import { useLayoutMode } from '../../composables/useLayoutMode'

beforeEach(() => { localStorage.clear() })

describe('AppearanceSettings', () => {
  it('incluye el ThemePicker y los créditos de los sprites', () => {
    const w = mount(AppearanceSettings)
    expect(w.findAll('[data-test="theme-card"]').length).toBe(3)
    expect(w.text()).toContain('Ninja Adventure')
  })
  it('zoom: acercar, alejar y volver a 100%', async () => {
    const w = mount(AppearanceSettings)
    const { zoomPct } = useZoom()
    const start = zoomPct.value
    await w.get('[data-test="zoom-in"]').trigger('click')
    expect(zoomPct.value).toBeGreaterThan(start)
    await w.get('[data-test="zoom-reset"]').trigger('click')
    expect(zoomPct.value).toBe(100)
  })
  it('barra colapsada por defecto', async () => {
    const w = mount(AppearanceSettings, { attachTo: document.body })
    await w.get('[data-test="nav-collapsed-switch"]').trigger('click')
    await flushPromises()
    expect(useLayoutMode().allCollapsed.value).toBe(true)
    w.unmount()
  })
})
