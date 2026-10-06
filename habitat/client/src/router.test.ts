import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
  it('/board muestra el tablero', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/board'); await router.isReady()
    expect(router.currentRoute.value.name).toBe('board')
  })
  it('settings acepta sección', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings/appearance'); await router.isReady()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.params.section).toBe('appearance')
  })
})

describe('router — celular', () => {
  const orig = { w: window.innerWidth, h: window.innerHeight }
  const setSize = (w: number, h: number) => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
  }
  beforeEach(() => setSize(400, 860))
  afterEach(() => setSize(orig.w, orig.h))

  it('en phone, #/ termina en /sessions (redirección en el router, antes de montar)', async () => {
    const store = useSessions()
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/'); await router.isReady()
    expect(router.currentRoute.value.fullPath).toBe('/sessions')
  })
  it('en phone, un snapshot que auto-selecciona no saca de /sessions', async () => {
    const store = useSessions()
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/'); await router.isReady()
    store.setAll([sess('a'), sess('b')])
    await new Promise((r) => setTimeout(r, 0))
    expect(store.selectedId).toBe('a')
    expect(router.currentRoute.value.fullPath).toBe('/sessions')
  })
  it('en phone, la selección no redirige el foco #/ a /s/:id aunque la ruta siga en focus', async () => {
    const store = useSessions()
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/s/a'); await router.isReady() // con la lista vacía, /s/a no se toca
    syncSelectionWithRoute(router, store)
    // Simula "la ruta todavía es focus" forzando la ubicación sin pasar por el guard.
    setSize(1440, 900); await router.replace('/'); setSize(400, 860)
    store.select('b'); await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.fullPath).toBe('/')
  })
  it('en phone, /s/:id sigue funcionando', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/s/b'); await router.isReady()
    expect(router.currentRoute.value.fullPath).toBe('/s/b')
    expect(store.selectedId).toBe('b')
  })
})
