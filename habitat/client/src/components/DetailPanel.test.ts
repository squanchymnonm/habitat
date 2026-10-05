import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

// La terminal real necesita xterm + websocket: para el panel alcanza con un doble.
vi.mock('../composables/useTerminal', () => ({
  canReadClipboard: () => false,
  useTerminal: () => ({
    fit: () => {}, insert: () => {}, getSelection: () => '', copySelection: () => {}, pasteClipboard: () => {},
    copyVisible: () => false, selectMode: ref(false), sendKey: () => {},
  }),
}))

import DetailPanel from './DetailPanel.vue'
import InfraBlock from './InfraBlock.vue'
import { useSessions } from '../stores/sessions'

const stubs = { QuestBook: true, FileBrowser: true, ProjectExplorer: true, EditorTerminal: true, TermKeys: true }
const session = (id: string) => ({
  id, name: id, project: 'back', branch: id, status: 'idle', action: '', since: 0, stamina: 100,
  infra: { stack: `back-${id}`, ports: {}, dir: `/wt/${id}/infra`, branch: id, state: 'up' },
}) as any

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async (u: string) => ({
    ok: true, status: 200,
    json: async () => (u === '/projects' ? { canSpawn: true, projects: [] } : u.startsWith('/infra/up') ? { ok: false, message: 'port is already allocated' } : { stacks: [] }),
  })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('DetailPanel — bloque de infra', () => {
  it('cambiar de sesión monta un InfraBlock nuevo (busy/error no se arrastran)', async () => {
    const store = useSessions()
    store.setAll([session('a'), session('b')])
    store.select('a')
    const w = mount(DetailPanel, { global: { stubs } })
    await flushPromises()
    const first = w.findComponent(InfraBlock)
    expect(first.exists()).toBe(true)
    await first.get('[data-test="infra-up"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('port is already allocated') // error de la sesión a
    store.select('b')
    await flushPromises()
    const second = w.findComponent(InfraBlock)
    expect(second.props('session').id).toBe('b')
    expect(w.text()).not.toContain('port is already allocated')
  })
})

describe('DetailPanel — stamina', () => {
  it('muestra el ancho de la stamina y usa stamina-low por debajo de 25', async () => {
    const store = useSessions()
    store.setAll([{ ...session('a'), stamina: 80 }])
    store.select('a')
    const w = mount(DetailPanel, { global: { stubs } })
    await flushPromises()
    const fill = w.get('[data-test="stamina-fill"]')
    expect(fill.attributes('style')).toContain('width: 80%')
    expect(fill.classes()).toContain('bg-stamina-ok')

    store.setAll([{ ...session('a'), stamina: 10 }])
    await flushPromises()
    const lowFill = w.get('[data-test="stamina-fill"]')
    expect(lowFill.attributes('style')).toContain('width: 10%')
    expect(lowFill.classes()).toContain('bg-stamina-low')
  })
})
