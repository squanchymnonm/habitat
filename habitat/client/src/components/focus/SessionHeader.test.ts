import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory, createWebHashHistory, type RouterHistory } from 'vue-router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
const canSpawn = ref(true)
const kill = vi.fn(async () => true)
const dockerStatus = vi.fn(async () => [] as string[])
const dockerDown = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ canSpawn, kill, dockerStatus, dockerDown, colorForProject: () => '#888888' }),
}))
const openInNvim = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjectTree', () => ({ useProjectTree: () => ({ openInNvim }) }))
vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import SessionHeader from './SessionHeader.vue'

const base = { id: 's1', name: 'ezio', project: 'back', branch: 'feat/x', status: 'waiting', action: 'Edit', since: 0, stamina: 80 } as any

// SessionHeader usa useRouter() (botón volver a la lista en phone): todos los montajes
// llevan un router de memoria con las rutas mínimas (componentes vacíos: a este test
// sólo le importa a dónde navega, no qué se renderiza ahí).
const blank = { template: '<div/>' }
function buildRouter(history: RouterHistory = createMemoryHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', component: blank },
      { path: '/s/:id', component: blank },
      { path: '/sessions', component: blank },
    ],
  })
}
async function mountHeader(props: { session: typeof base } = { session: base }, opts: Record<string, unknown> = {}) {
  const router = buildRouter()
  await router.push('/s/s1')
  await router.isReady()
  const w = mount(SessionHeader, { props, global: { plugins: [router] }, ...opts })
  return { w, router }
}

beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); canSpawn.value = true; mode.value = 'landscape' })

describe('SessionHeader', () => {
  it('nombre en font-display, proyecto · rama y badge de estado', async () => {
    const { w } = await mountHeader()
    expect(w.get('[data-test="session-name"]').classes()).toContain('font-display')
    expect(w.text()).toContain('back')
    expect(w.text()).toContain('feat/x')
    const badge = w.get('[data-test="state-badge"]')
    expect(badge.text()).toBe('te necesita')
    expect(badge.classes()).toContain('text-state-waiting')
  })
  it('stamina: ancho y color bajo 25%', async () => {
    const { w } = await mountHeader()
    expect(w.get('[data-test="stamina-fill"]').attributes('style')).toContain('width: 80%')
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-ok')
    await w.setProps({ session: { ...base, stamina: 10 } })
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-low')
  })
  it('abrir en editor llama al server con "." y emite open-editor', async () => {
    const { w } = await mountHeader()
    await w.get('[data-test="open-editor"]').trigger('click')
    await flushPromises()
    expect(openInNvim).toHaveBeenCalledWith('s1', '.')
    expect(w.emitted('open-editor')).toHaveLength(1)
  })
  it('cerrar pide confirmación antes de matar la sesión', async () => {
    const { w } = await mountHeader({ session: base }, { attachTo: document.body })
    await w.get('[data-test="close-session"]').trigger('click')
    await flushPromises()
    expect(kill).not.toHaveBeenCalled()
    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(kill).toHaveBeenCalledWith('s1')
    w.unmount()
  })
  it('sin spawn no hay cerrar ni bajar docker', async () => {
    canSpawn.value = false
    const { w } = await mountHeader()
    await flushPromises()
    expect(w.find('[data-test="close-session"]').exists()).toBe(false)
    expect(w.find('[data-test="docker-down"]').exists()).toBe(false)
  })
  it('bajar docker aparece con stacks y sin infra configurada', async () => {
    dockerStatus.mockResolvedValueOnce(['back-ezio'])
    const { w } = await mountHeader()
    await flushPromises()
    expect(w.get('[data-test="docker-down"]').text()).toContain('1')
  })
  it('acciones sin estilo nativo (preflight apagado) y con objetivo táctil ≥40px', async () => {
    const { w } = await mountHeader()
    for (const sel of ['[data-test="open-editor"]', '[data-test="close-session"]']) {
      expect(w.get(sel).classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer', 'min-h-10', 'min-w-10']))
    }
  })
  it('Editor y Cerrar tienen nombre accesible (en el teléfono quedan sólo con ícono)', async () => {
    const { w } = await mountHeader()
    for (const sel of ['[data-test="open-editor"]', '[data-test="close-session"]']) {
      expect(w.get(sel).attributes('aria-label')).toBeTruthy()
      expect(w.get(sel).attributes('title')).toBeTruthy()
    }
  })
  it('muestra la acción actual y hace cuánto está activa', async () => {
    const { w } = await mountHeader({ session: { ...base, since: Date.now() - 5 * 60000 } })
    const line = w.get('[data-test="session-activity"]')
    expect(line.text()).toContain('Edit')
    expect(line.text()).toContain('activa hace 5m')
    expect(line.classes()).toEqual(expect.arrayContaining(['truncate', 'text-xs', 'text-muted']))
  })
  it('el error de nvim se limpia al cambiar de sesión', async () => {
    openInNvim.mockResolvedValueOnce({ ok: false, message: 'nvim no está' } as any)
    const { w } = await mountHeader()
    await w.get('[data-test="open-editor"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('nvim no está')
    await w.setProps({ session: { ...base, id: 's2' } })
    expect(w.text()).not.toContain('nvim no está')
  })
  it('en phone hay botón volver a la lista; entrando directo a /s/:id reemplaza (no apila)', async () => {
    mode.value = 'phone'
    const { w, router } = await mountHeader()
    const back = w.get('[data-test="back-to-list"]')
    expect(back.attributes('aria-label')).toBe('Volver a la lista')
    expect(back.classes()).toEqual(expect.arrayContaining(['min-h-10', 'min-w-10', 'border-0']))
    const push = vi.spyOn(router, 'push'); const replace = vi.spyOn(router, 'replace'); const goBack = vi.spyOn(router, 'back')
    await back.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/sessions')
    expect(replace).toHaveBeenCalledWith('/sessions')
    expect(push).not.toHaveBeenCalled()
    expect(goBack).not.toHaveBeenCalled()
  })
  it('en phone, viniendo de /sessions, volver retrocede en el historial', async () => {
    mode.value = 'phone'
    // Historial real (hash): es el que guarda state.back.
    const router = buildRouter(createWebHashHistory())
    await router.push('/sessions'); await router.isReady()
    await router.push('/s/s1')
    expect(router.options.history.state.back).toBe('/sessions')
    const w = mount(SessionHeader, { props: { session: base }, global: { plugins: [router] } })
    const goBack = vi.spyOn(router, 'back'); const replace = vi.spyOn(router, 'replace')
    await w.get('[data-test="back-to-list"]').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/sessions'))
    expect(goBack).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    w.unmount()
  })
  it('en phone, cerrar la sesión en foco vuelve a la lista', async () => {
    mode.value = 'phone'
    const { w, router } = await mountHeader({ session: base }, { attachTo: document.body })
    await w.get('[data-test="close-session"]').trigger('click'); await flushPromises()
    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(kill).toHaveBeenCalledWith('s1')
    expect(router.currentRoute.value.path).toBe('/sessions')
    w.unmount()
  })
  it('fuera de phone, cerrar la sesión no navega a la lista', async () => {
    const { w, router } = await mountHeader({ session: base }, { attachTo: document.body })
    await w.get('[data-test="close-session"]').trigger('click'); await flushPromises()
    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(kill).toHaveBeenCalledWith('s1')
    expect(router.currentRoute.value.path).toBe('/s/s1')
    w.unmount()
  })
  it('en phone, si el kill falla no navega', async () => {
    mode.value = 'phone'
    kill.mockResolvedValueOnce(false)
    const { w, router } = await mountHeader({ session: base }, { attachTo: document.body })
    await w.get('[data-test="close-session"]').trigger('click'); await flushPromises()
    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/s/s1')
    w.unmount()
  })
  it('fuera de phone no hay botón volver', async () => {
    mode.value = 'landscape'
    const { w } = await mountHeader()
    expect(w.find('[data-test="back-to-list"]').exists()).toBe(false)
  })
  it('proyecto · rama trunca con puntos suspensivos', async () => {
    const { w } = await mountHeader()
    expect(w.get('[data-test="session-repo"]').classes()).toEqual(expect.arrayContaining(['truncate', 'min-w-0']))
  })
})
