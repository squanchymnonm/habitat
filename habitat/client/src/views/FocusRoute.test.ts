import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

const canSpawn = ref(false)
const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../composables/useProjects', () => ({ useProjects: () => ({ canSpawn }) }))
vi.mock('../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {} }) }))
vi.mock('../components/focus/FocusView.vue', () => ({ default: { template: '<div data-test="focus-view" />', methods: { fit() {} } } }))
import FocusRoute from './FocusRoute.vue'
import { useSessions } from '../stores/sessions'
import { createHabitatRouter } from '../router'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

async function mountFocus(path = '/') {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push(path); await router.isReady()
  return { w: mount(FocusRoute, { global: { plugins: [router] } }), router }
}

beforeEach(() => { setActivePinia(createPinia()); mode.value = 'landscape' })

describe('FocusRoute — estado vacío', () => {
  it('sin sesiones y con spawn habilitado apunta al botón de nueva sesión', async () => {
    canSpawn.value = true
    useSessions().setAll([])
    const { w } = await mountFocus()
    const empty = w.get('[data-test="empty-sessions"]').text()
    expect(empty).toContain('No hay sesiones abiertas')
    expect(empty).toContain('Nueva sesión')
    expect(empty).not.toContain('mono <proyecto>')
    expect(w.find('[data-test="focus-view"]').exists()).toBe(false)
  })
  it('sin sesiones y sin spawn explica que se arrancan con mono en el server', async () => {
    canSpawn.value = false
    useSessions().setAll([])
    const { w } = await mountFocus()
    const empty = w.get('[data-test="empty-sessions"]').text()
    expect(empty).toContain('mono <proyecto>')
    expect(empty).not.toContain('Nueva sesión')
  })
  it('con sesiones muestra el foco', async () => {
    useSessions().setAll([sess('a')])
    const { w } = await mountFocus()
    expect(w.find('[data-test="empty-sessions"]').exists()).toBe(false)
    expect(w.find('[data-test="focus-view"]').exists()).toBe(true)
  })
})

describe('FocusRoute — navegación por modo', () => {
  it('en phone, #/ redirige a /sessions', async () => {
    mode.value = 'phone'
    useSessions().setAll([sess('a')])
    const { router } = await mountFocus('/')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/sessions'))
  })
  it('fuera de phone, #/ no redirige', async () => {
    mode.value = 'landscape'
    useSessions().setAll([sess('a')])
    const { router } = await mountFocus('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })
  it('en phone, un link directo /s/:id abre el foco (no redirige a la lista)', async () => {
    mode.value = 'phone'
    useSessions().setAll([sess('a')])
    const { w, router } = await mountFocus('/s/a')
    expect(w.find('[data-test="focus-view"]').exists()).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/s/a')
  })
})
