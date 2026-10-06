import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode, collapsed: ref(false), toggleCollapsed: () => {}, setCollapsed: () => {} }) }))
vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import BoardView from './BoardView.vue'
import { useSessions } from '../../stores/sessions'
import { createHabitatRouter, syncSelectionWithRoute } from '../../router'

const s = (id: string, status: string, action = '') => ({ id, name: id, project: 'proj', branch: 'main', status, action, since: 0, stamina: 100 }) as any

async function mountBoard() {
  const store = useSessions()
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push('/board'); await router.isReady()
  const w = mount(BoardView, { global: { plugins: [router] }, attachTo: document.body })
  return { w, router, store }
}

beforeEach(() => { setActivePinia(createPinia()); mode.value = 'landscape' })

describe('BoardView', () => {
  it('cada sesión cae en su columna y la tarjeta muestra nombre, proyecto y acción', async () => {
    useSessions().setAll([s('ezio', 'working', 'Edit'), s('yoshi', 'waiting')])
    const { w } = await mountBoard()
    const need = w.get('[data-test="board-column-need"]')
    expect(need.text()).toContain('yoshi')
    const working = w.get('[data-test="board-column-working"]')
    expect(working.text()).toContain('ezio')
    expect(working.text()).toContain('proj')
    expect(working.text()).toContain('Edit')
    w.unmount()
  })
  it('columnas vacías colapsadas a su encabezado con el contador', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    const done = w.get('[data-test="board-column-done"]')
    expect(done.attributes('data-empty')).toBe('true')
    expect(done.text()).toContain('0')
    expect(done.findAll('[data-test="board-card"]').length).toBe(0)
    w.unmount()
  })
  it('las offline se ven atenuadas con el badge "caída"', async () => {
    useSessions().setAll([s('zelda', 'offline')])
    const { w } = await mountBoard()
    const card = w.get('[data-test="board-column-quiet"] [data-test="board-card"]')
    expect(card.classes()).toContain('opacity-60')
    expect(card.text()).toContain('caída')
    w.unmount()
  })
  it('tocar una tarjeta va al foco de esa sesión', async () => {
    useSessions().setAll([s('ezio', 'working'), s('yoshi', 'waiting')])
    const { w, router, store } = await mountBoard()
    await w.get('[data-test="board-column-need"] [data-test="board-card"]').trigger('click')
    // /s/:id carga FocusRoute en lazy (mismo caso que SessionNav.test.ts): esperar a que la navegación termine.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/s/yoshi'), { timeout: 5000 })
    expect(store.selectedId).toBe('yoshi')
    w.unmount()
  })
  it('en landscape las columnas van en fila; en portrait y phone se apilan', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    expect(w.get('[data-test="board"]').classes()).toContain('grid-cols-4')
    mode.value = 'portrait'; await flushPromises()
    expect(w.get('[data-test="board"]').classes()).not.toContain('grid-cols-4')
    w.unmount()
  })
  it('tarjetas sin estilo nativo (preflight apagado) y táctiles', async () => {
    useSessions().setAll([s('ezio', 'working')])
    const { w } = await mountBoard()
    expect(w.get('[data-test="board-card"]').classes()).toEqual(expect.arrayContaining(['border', 'border-border', 'cursor-pointer', 'min-h-10']))
    w.unmount()
  })
})
