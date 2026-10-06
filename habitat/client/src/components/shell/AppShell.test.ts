import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppShell from './AppShell.vue'

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/', component: { template: '<div/>' } },
  { path: '/s/:id', component: { template: '<div/>' } },
  { path: '/board', component: { template: '<div/>' } },
] })

// Regresión: con zoom de UI, `zoom` no escala las unidades de viewport; #app ya
// compensa con calc(100dvh / var(--zoom)). Si el shell usa h-dvh, se recorta abajo.
describe('AppShell', () => {
  it('ocupa el alto de #app (h-full), no el del viewport (h-dvh)', () => {
    setActivePinia(createPinia())
    const w = mount(AppShell, { global: { plugins: [router], stubs: { TopBar: true, SessionNav: true, RouterView: true } } })
    const root = w.element as HTMLElement
    expect(root.classList.contains('h-full')).toBe(true)
    expect(root.classList.contains('h-dvh')).toBe(false)
  })
})
