import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
vi.mock('../../composables/useSessionOrder', () => ({ postOrder: vi.fn(async () => true) }))

const sess = (id: string, status = 'idle', infra?: any) =>
  ({ id, name: id, project: 'proj', branch: 'main', status, action: 'a', since: 0, stamina: 80, infra }) as any

async function mountNav(w: number, h: number, sessions = [sess('ezio', 'working'), sess('yoshi', 'waiting')], path = '/') {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
  vi.resetModules()
  const { useSessions } = await import('../../stores/sessions')
  const { createHabitatRouter, syncSelectionWithRoute } = await import('../../router')
  const { createMemoryHistory } = await import('vue-router')
  const SessionNav = (await import('./SessionNav.vue')).default
  setActivePinia(createPinia())
  const store = useSessions()
  store.setAll(sessions)
  // Router real: los items de la nav navegan a /s/<id> y la selección sale de la ruta.
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push(path); await router.isReady()
  return { w: mount(SessionNav, { global: { plugins: [router], stubs: { teleport: true } } }), store, router }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

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
    const { w, store, router } = await mountNav(1440, 900)
    await w.findAll('[data-test="session-item"]')[1].trigger('click'); await settle()
    expect(store.selectedId).toBe('yoshi')
    expect(router.currentRoute.value.fullPath).toBe('/s/yoshi')
  })
  // Regresión: en /settings/* el click sólo movía el resaltado; ahora navega a la sesión.
  it.each([[1440, 900, 'sidebar'], [820, 1180, 'tabs']])('desde ajustes (%sx%s, %s): click navega a /s/<id> y la selecciona', async (wd, ht) => {
    const { w, store, router } = await mountNav(wd, ht, undefined, '/settings/general')
    expect(store.selectedId).toBe('ezio')
    await w.findAll('[data-test="session-item"]')[1].trigger('click')
    // /s/:id carga FocusRoute en lazy: esperar a que la navegación termine.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/s/yoshi'), { timeout: 5000 })
    expect(store.selectedId).toBe('yoshi')
  })
  it('click no llama a store.select más de una vez', async () => {
    const { w, store } = await mountNav(1440, 900)
    const spy = vi.spyOn(store, 'select')
    await w.findAll('[data-test="session-item"]')[1].trigger('click'); await settle()
    expect(spy).toHaveBeenCalledTimes(1)
  })
  // Regresión: con <Tooltip> (fragmento) como raíz del slot #item, vuedraggable no
  // encontraba elemento donde dejar __draggable_context y el drag tiraba excepción.
  it.each([[1440, 900], [820, 1180]])('(%sx%s) cada hijo del draggable tiene __draggable_context', async (wd, ht) => {
    const { w } = await mountNav(wd, ht)
    const items = w.findAll('[data-test="session-item"]')
    expect(items.length).toBe(2)
    for (const it of items) {
      // El hijo directo del contenedor del draggable que contiene a este item.
      let el = it.element as HTMLElement
      while (el.parentElement && !el.parentElement.classList.contains('overflow-y-auto') && !el.parentElement.classList.contains('overflow-x-auto')) el = el.parentElement
      expect((el as any).__draggable_context, 'falta __draggable_context en la raíz del item').toBeTruthy()
    }
  })
  it('tabs (portrait): colapsar oculta los nombres', async () => {
    const { w } = await mountNav(820, 1180)
    expect(w.findAll('[data-test="session-name"]').length).toBe(2)
    await w.get('[data-test="nav-collapse"]').trigger('click')
    expect(w.find('[data-test="session-tabs"]').classes()).toContain('collapsed')
    expect(w.findAll('[data-test="session-name"]').length).toBe(0)
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
