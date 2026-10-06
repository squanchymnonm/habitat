import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { vi, beforeEach } from 'vitest'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', async (orig) => ({ ...(await orig<typeof import('../../composables/useLayoutMode')>()), useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {} }) }))
import AppShell from './AppShell.vue'
import { useSessions } from '../../stores/sessions'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/', component: { template: '<div/>' } },
  { path: '/s/:id', component: { template: '<div/>' } },
  { path: '/board', component: { template: '<div/>' } },
] })

beforeEach(() => { mode.value = 'landscape' })

// Regresión: con zoom de UI, `zoom` no escala las unidades de viewport; #app ya
// compensa con calc(100dvh / var(--zoom)). Si el shell usa h-dvh, se recorta abajo.
describe('AppShell', () => {
  it('ocupa el alto de #app (h-full), no el del viewport (h-dvh)', () => {
    setActivePinia(createPinia())
    useSessions().setAll([sess('a')])
    const w = mount(AppShell, { global: { plugins: [router], stubs: { TopBar: true, SessionNav: true, RouterView: true } } })
    const root = w.element as HTMLElement
    expect(root.classList.contains('h-full')).toBe(true)
    expect(root.classList.contains('h-dvh')).toBe(false)
  })
  it('en phone no hay navegación de sesiones', () => {
    mode.value = 'phone'
    setActivePinia(createPinia())
    useSessions().setAll([sess('a')])
    const w = mount(AppShell, { global: { plugins: [router], stubs: { TopBar: true, RouterView: true } } })
    expect(w.find('[data-test="session-sidebar"]').exists()).toBe(false)
    expect(w.find('[data-test="session-tabs"]').exists()).toBe(false)
  })
  it('sin sesiones no hay navegación de sesiones', () => {
    mode.value = 'landscape'
    setActivePinia(createPinia())
    useSessions().setAll([])
    const w = mount(AppShell, { global: { plugins: [router], stubs: { TopBar: true, RouterView: true } } })
    expect(w.find('[data-test="session-sidebar"]').exists()).toBe(false)
    expect(w.find('[data-test="session-tabs"]').exists()).toBe(false)
  })
})
