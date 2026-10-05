import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
vi.mock('../../composables/useSessionOrder', () => ({ postOrder: vi.fn(async () => true) }))

const sess = (id: string, status = 'idle', infra?: any) =>
  ({ id, name: id, project: 'proj', branch: 'main', status, action: 'a', since: 0, stamina: 80, infra }) as any

async function mountNav(w: number, h: number, sessions = [sess('ezio', 'working'), sess('yoshi', 'waiting')]) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
  vi.resetModules()
  const { useSessions } = await import('../../stores/sessions')
  const SessionNav = (await import('./SessionNav.vue')).default
  setActivePinia(createPinia())
  const store = useSessions()
  store.setAll(sessions)
  return { w: mount(SessionNav, { global: { stubs: { teleport: true } } }), store }
}

beforeEach(() => localStorage.clear())

describe('SessionNav', () => {
  it('landscape: barra lateral con nombre y proyecto', async () => {
    const { w } = await mountNav(1440, 900)
    expect(w.find('[data-test="session-sidebar"]').exists()).toBe(true)
    expect(w.text()).toContain('ezio')
    expect(w.text()).toContain('proj')
  })
  it('portrait: pestañas arriba', async () => {
    const { w } = await mountNav(820, 1180)
    expect(w.find('[data-test="session-tabs"]').exists()).toBe(true)
  })
  it('colapsar deja sólo avatares (sin nombres) y se recuerda', async () => {
    const { w } = await mountNav(1440, 900)
    await w.get('[data-test="nav-collapse"]').trigger('click')
    expect(w.find('[data-test="session-sidebar"]').classes()).toContain('collapsed')
    expect(w.findAll('[data-test="session-name"]').length).toBe(0)
    expect(localStorage.getItem('habitat.nav.collapsed.landscape')).toBe('1')
  })
  it('click en una sesión la selecciona', async () => {
    const { w, store } = await mountNav(1440, 900)
    await w.findAll('[data-test="session-item"]')[1].trigger('click')
    expect(store.selectedId).toBe('yoshi')
  })
  it('la seleccionada queda marcada', async () => {
    const { w, store } = await mountNav(1440, 900)
    store.select('ezio'); await w.vm.$nextTick()
    expect(w.findAll('[data-test="session-item"]')[0].attributes('aria-current')).toBe('true')
  })
  // Regresión: sin el preflight de Tailwind, un <button> sin bg/border explícitos
  // hereda el estilo nativo (cara blanca, borde) — ver fix(habitat) de los triggers nuevos.
  it('sidebar (landscape): session-item y nav-collapse no dependen del estilo nativo del botón', async () => {
    const { w, store } = await mountNav(1440, 900)
    const items = w.findAll('[data-test="session-item"]')
    expect(items[1].classes()).toContain('bg-transparent') // no seleccionado
    expect(items[1].classes()).toContain('border-0')
    store.select('ezio'); await w.vm.$nextTick()
    expect(items[0].classes()).toContain('bg-surface-raised') // seleccionado: token bg, no transparent
    expect(items[0].classes()).toContain('border-0')
    const collapseBtn = w.get('[data-test="nav-collapse"]')
    expect(collapseBtn.classes()).toContain('bg-transparent')
    expect(collapseBtn.classes()).toContain('border-0')
  })
  it('tabs (portrait): session-item y nav-collapse no dependen del estilo nativo del botón', async () => {
    const { w, store } = await mountNav(820, 1180)
    const items = w.findAll('[data-test="session-item"]')
    expect(items[1].classes()).toContain('bg-background/40') // no seleccionado: token bg, no blanco nativo
    expect(items[1].classes()).toContain('border-0')
    store.select('ezio'); await w.vm.$nextTick()
    expect(items[0].classes()).toContain('bg-surface-raised')
    expect(items[0].classes()).toContain('border-0')
    const collapseBtn = w.get('[data-test="nav-collapse"]')
    expect(collapseBtn.classes()).toContain('bg-transparent')
    expect(collapseBtn.classes()).toContain('border-0')
  })
})

// Migrado de SessionPod.test.ts ("SessionPod — dot de infra"): el punto de infra
// ahora vive en SessionSidebar/SessionTabs, junto al nombre de la sesión.
describe('SessionNav — dot de infra', () => {
  it('sin infra (o sin carpeta de infra) no hay dot', async () => {
    const { w } = await mountNav(1440, 900)
    expect(w.find('[data-test="infra-dot"]').exists()).toBe(false)
  })

  it('con infra pero sin dir tampoco hay dot', async () => {
    const { w } = await mountNav(1440, 900, [sess('ezio', 'working', { stack: 'x', ports: {}, dir: '', branch: 'bob' })])
    expect(w.find('[data-test="infra-dot"]').exists()).toBe(false)
  })

  it.each([
    ['up', 'bg-state-done'],
    ['partial', 'bg-state-working'],
    [undefined, 'bg-state-idle'],
  ])('estado %s -> clase %s', async (state, cls) => {
    const { w } = await mountNav(1440, 900, [
      sess('ezio', 'working', { stack: 'x', ports: {}, dir: '/wt/infra', branch: 'bob', state }),
    ])
    const dot = w.get('[data-test="infra-dot"]')
    expect(dot.classes()).toContain(cls)
  })
})
