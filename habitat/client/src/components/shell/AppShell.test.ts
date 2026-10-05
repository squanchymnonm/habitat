import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppShell from './AppShell.vue'

// Regresión: con zoom de UI, `zoom` no escala las unidades de viewport; #app ya
// compensa con calc(100dvh / var(--zoom)). Si el shell usa h-dvh, se recorta abajo.
describe('AppShell', () => {
  it('ocupa el alto de #app (h-full), no el del viewport (h-dvh)', () => {
    const w = mount(AppShell, { global: { stubs: { TopBar: true, SessionNav: true, RouterView: true } } })
    const root = w.element as HTMLElement
    expect(root.classList.contains('h-full')).toBe(true)
    expect(root.classList.contains('h-dvh')).toBe(false)
  })
})
