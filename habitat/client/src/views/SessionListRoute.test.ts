import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('phone')
vi.mock('../composables/useLayoutMode', async (orig) => ({
  ...(await orig<typeof import('../composables/useLayoutMode')>()),
  useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {} }),
}))
vi.mock('../components/sessions/SessionList.vue', () => ({ default: { template: '<div data-test="session-list" />' } }))
import SessionListRoute from './SessionListRoute.vue'
import { useSessions } from '../stores/sessions'
import { createHabitatRouter } from '../router'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

async function mountList() {
  const router = createHabitatRouter(createMemoryHistory())
  await router.push('/sessions'); await router.isReady()
  return { w: mount(SessionListRoute, { global: { plugins: [router] } }), router }
}

beforeEach(() => { setActivePinia(createPinia()); mode.value = 'phone' })

describe('SessionListRoute — navegación por modo', () => {
  it('en phone muestra la lista y se queda en /sessions', async () => {
    useSessions().setAll([sess('a')])
    const { w, router } = await mountList()
    expect(w.find('[data-test="session-list"]').exists()).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/sessions')
  })
  it('fuera de phone redirige al foco de la sesión elegida', async () => {
    mode.value = 'landscape'
    const store = useSessions(); store.setAll([sess('a'), sess('b')]); store.select('b')
    const { router } = await mountList()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/s/b'), { timeout: 5000 })
  })
  it('fuera de phone y sin selección redirige a /', async () => {
    mode.value = 'landscape'
    useSessions().setAll([])
    const { router } = await mountList()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'), { timeout: 5000 })
  })
  it('rotar de phone a portrait en /sessions vuelve al foco elegido', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')]); store.select('a')
    const { router } = await mountList()
    expect(router.currentRoute.value.fullPath).toBe('/sessions')
    mode.value = 'portrait'
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/s/a'), { timeout: 5000 })
  })
})
