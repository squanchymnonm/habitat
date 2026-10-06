import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.resetModules() })

describe('ThemePicker', () => {
  it('una tarjeta por tema, marca el activo y aplica en vivo', async () => {
    const { applyStoredTheme } = await import('../../composables/useTheme')
    applyStoredTheme()
    const ThemePicker = (await import('./ThemePicker.vue')).default
    const w = mount(ThemePicker)
    const cards = w.findAll('[data-test="theme-card"]')
    expect(cards.map((c) => c.text())).toEqual(['Forja refinada', 'Pizarra pixel', 'Noche de taberna'])
    expect(cards[0].attributes('aria-pressed')).toBe('true')
    await cards[2].trigger('click')
    expect(document.documentElement.dataset.theme).toBe('taberna')
    expect(localStorage.getItem('habitat.theme')).toBe('taberna')
    expect(w.findAll('[data-test="theme-card"]')[2].attributes('aria-pressed')).toBe('true')
  })
  it('tarjetas táctiles y sin estilo nativo', async () => {
    const ThemePicker = (await import('./ThemePicker.vue')).default
    const cls = mount(ThemePicker).findAll('[data-test="theme-card"]')[0].classes()
    expect(cls).toEqual(expect.arrayContaining(['min-h-10', 'cursor-pointer', 'font-[inherit]']))
  })
})
