import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
const canSpawn = ref(true)
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn }) }))
import ToolTabs from './ToolTabs.vue'
import { useFocusTools, resetFocusTools } from '../../composables/useFocusTools'

const sess = (infra?: object) => ({ id: 's1', name: 'ezio', project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100, infra }) as any

beforeEach(() => { resetFocusTools(); mode.value = 'landscape'; canSpawn.value = true })

describe('ToolTabs', () => {
  it('Infra sólo con infra configurada', () => {
    const labels = (s: any) => mount(ToolTabs, { props: { session: s } }).findAll('[data-test="tool-tab"]').map((b) => b.text())
    expect(labels(sess())).toEqual(['Terminal', 'Git', 'Archivos', 'Quest'])
    expect(labels(sess({ dir: '/wt/infra', stack: 'x', ports: {}, branch: 'b' }))).toEqual(['Terminal', 'Git', 'Archivos', 'Infra', 'Quest'])
  })
  it('elegir una pestaña la activa para esa sesión', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    expect(useFocusTools(ref('s1')).active.value).toBe('git')
    expect(w.findAll('[data-test="tool-tab"]')[1].attributes('aria-selected')).toBe('true')
  })
  it('fijar al costado sólo en landscape y no para Terminal', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(false) // Terminal activa
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(true)
    mode.value = 'portrait'
    await w.vm.$nextTick()
    expect(w.find('[data-test="pin-tool"]').exists()).toBe(false)
  })
  it('fijar deja la herramienta en el panel y desfija al cambiar de modo', async () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    await w.findAll('[data-test="tool-tab"]')[1].trigger('click')
    await w.get('[data-test="pin-tool"]').trigger('click')
    const t = useFocusTools(ref('s1'))
    expect(t.pinned.value).toBe('git')
    mode.value = 'portrait'
    await w.vm.$nextTick()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('git')
  })
  it('pestañas sin estilo nativo (preflight apagado)', () => {
    const w = mount(ToolTabs, { props: { session: sess() } })
    expect(w.findAll('[data-test="tool-tab"]')[0].classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer']))
  })
})
