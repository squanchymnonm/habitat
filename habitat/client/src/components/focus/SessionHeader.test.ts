import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

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

beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); canSpawn.value = true })

describe('SessionHeader', () => {
  it('nombre en font-display, proyecto · rama y badge de estado', () => {
    const w = mount(SessionHeader, { props: { session: base } })
    expect(w.get('[data-test="session-name"]').classes()).toContain('font-display')
    expect(w.text()).toContain('back')
    expect(w.text()).toContain('feat/x')
    const badge = w.get('[data-test="state-badge"]')
    expect(badge.text()).toBe('te necesita')
    expect(badge.classes()).toContain('text-state-waiting')
  })
  it('stamina: ancho y color bajo 25%', async () => {
    const w = mount(SessionHeader, { props: { session: base } })
    expect(w.get('[data-test="stamina-fill"]').attributes('style')).toContain('width: 80%')
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-ok')
    await w.setProps({ session: { ...base, stamina: 10 } })
    expect(w.get('[data-test="stamina-fill"]').classes()).toContain('bg-stamina-low')
  })
  it('abrir en editor llama al server con "." y emite open-editor', async () => {
    const w = mount(SessionHeader, { props: { session: base } })
    await w.get('[data-test="open-editor"]').trigger('click')
    await flushPromises()
    expect(openInNvim).toHaveBeenCalledWith('s1', '.')
    expect(w.emitted('open-editor')).toHaveLength(1)
  })
  it('cerrar pide confirmación antes de matar la sesión', async () => {
    const w = mount(SessionHeader, { props: { session: base }, attachTo: document.body })
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
    const w = mount(SessionHeader, { props: { session: base } })
    await flushPromises()
    expect(w.find('[data-test="close-session"]').exists()).toBe(false)
    expect(w.find('[data-test="docker-down"]').exists()).toBe(false)
  })
  it('bajar docker aparece con stacks y sin infra configurada', async () => {
    dockerStatus.mockResolvedValueOnce(['back-ezio'])
    const w = mount(SessionHeader, { props: { session: base } })
    await flushPromises()
    expect(w.get('[data-test="docker-down"]').text()).toContain('1')
  })
  it('acciones sin estilo nativo (preflight apagado) y con objetivo táctil ≥40px', () => {
    const w = mount(SessionHeader, { props: { session: base } })
    for (const sel of ['[data-test="open-editor"]', '[data-test="close-session"]']) {
      expect(w.get(sel).classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer', 'min-h-10', 'min-w-10']))
    }
  })
  it('Editor y Cerrar tienen nombre accesible (en el teléfono quedan sólo con ícono)', () => {
    const w = mount(SessionHeader, { props: { session: base } })
    for (const sel of ['[data-test="open-editor"]', '[data-test="close-session"]']) {
      expect(w.get(sel).attributes('aria-label')).toBeTruthy()
      expect(w.get(sel).attributes('title')).toBeTruthy()
    }
  })
  it('muestra la acción actual y hace cuánto está activa', () => {
    const w = mount(SessionHeader, { props: { session: { ...base, since: Date.now() - 5 * 60000 } } })
    const line = w.get('[data-test="session-activity"]')
    expect(line.text()).toContain('Edit')
    expect(line.text()).toContain('activa hace 5m')
    expect(line.classes()).toEqual(expect.arrayContaining(['truncate', 'text-xs', 'text-muted']))
  })
  it('el error de nvim se limpia al cambiar de sesión', async () => {
    openInNvim.mockResolvedValueOnce({ ok: false, message: 'nvim no está' } as any)
    const w = mount(SessionHeader, { props: { session: base } })
    await w.get('[data-test="open-editor"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('nvim no está')
    await w.setProps({ session: { ...base, id: 's2' } })
    expect(w.text()).not.toContain('nvim no está')
  })
})
