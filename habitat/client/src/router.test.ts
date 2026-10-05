import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { createHabitatRouter, syncSelectionWithRoute } from './router'
import { useSessions } from './stores/sessions'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

beforeEach(() => setActivePinia(createPinia()))

describe('router', () => {
  it('/s/:id selecciona la sesión', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/s/b'); await router.isReady()
    expect(store.selectedId).toBe('b')
  })
  it('seleccionar en el store actualiza la ruta', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/'); await router.isReady()
    store.select('b'); await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.fullPath).toBe('/s/b')
  })
  it('id inexistente redirige a /', async () => {
    const store = useSessions(); store.setAll([sess('a')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/s/zzz'); await router.isReady(); await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('/board redirige a / (el tablero llega en el PR 3)', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/board'); await router.isReady()
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('settings acepta sección', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings/appearance'); await router.isReady()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.params.section).toBe('appearance')
  })
})
