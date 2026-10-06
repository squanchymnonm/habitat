import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import SessionList from './SessionList.vue'
import { useSessions } from '../../stores/sessions'
import { createHabitatRouter, syncSelectionWithRoute } from '../../router'

const s = (id: string, status: string, action = '') => ({ id, name: id, project: 'proj', branch: 'main', status, action, since: 0, stamina: 100 }) as any

async function mountList() {
  const store = useSessions()
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push('/sessions'); await router.isReady()
  return { w: mount(SessionList, { global: { plugins: [router] } }), router, store }
}

beforeEach(() => setActivePinia(createPinia()))

describe('SessionList', () => {
  it('"te necesita" primero, el resto en el orden de la nav', async () => {
    useSessions().setAll([s('a', 'working'), s('b', 'idle'), s('c', 'waiting'), s('d', 'error')])
    const { w } = await mountList()
    expect(w.findAll('[data-test="session-row"]').map((r) => r.attributes('data-id'))).toEqual(['c', 'd', 'a', 'b'])
  })
  it('cada fila muestra nombre, proyecto, estado y acción', async () => {
    useSessions().setAll([s('ezio', 'working', 'Edit')])
    const { w } = await mountList()
    const row = w.get('[data-test="session-row"]')
    for (const t of ['ezio', 'proj', 'trabajando', 'Edit']) expect(row.text()).toContain(t)
  })
  it('tocar una fila abre el foco de esa sesión', async () => {
    useSessions().setAll([s('ezio', 'working'), s('yoshi', 'idle')])
    const { w, router, store } = await mountList()
    await w.findAll('[data-test="session-row"]')[1].trigger('click'); await flushPromises()
    // /s/:id carga FocusRoute en lazy: esperar a que la navegación termine.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/s/yoshi'), { timeout: 5000 })
    expect(store.selectedId).toBe('yoshi')
  })
  it('filas grandes y sin estilo nativo', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountList()
    expect(w.get('[data-test="session-row"]').classes()).toEqual(expect.arrayContaining(['min-h-14', 'border-0', 'cursor-pointer']))
  })
})
