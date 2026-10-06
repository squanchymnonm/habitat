import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const selectMode = ref(false)
const term = {
  fit: vi.fn(), insert: vi.fn(), getSelection: vi.fn(() => 'sel'), copySelection: vi.fn(), pasteClipboard: vi.fn(),
  copyVisible: vi.fn(() => true), selectMode, sendKey: vi.fn(),
}
vi.mock('../../composables/useTerminal', () => ({ canReadClipboard: () => true, useTerminal: () => term }))
const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', async (orig) => ({ ...(await orig<typeof import('../../composables/useLayoutMode')>()), useLayoutMode: () => ({ mode }) }))
const termKeysEnabled = ref(false)
vi.mock('../../composables/useTermKeys', () => ({ useTermKeys: () => ({ enabled: termKeysEnabled }) }))
import TerminalPane from './TerminalPane.vue'

const session = { id: 's1', name: 'ezio', project: 'back', branch: 'feat/x', status: 'working', action: '', since: 0, stamina: 90 } as any

beforeEach(() => { vi.clearAllMocks(); selectMode.value = false; mode.value = 'landscape'; termKeysEnabled.value = false })

describe('TerminalPane', () => {
  it('barra con proyecto · rama, seleccionar y copiar visible', async () => {
    const w = mount(TerminalPane, { props: { session } })
    expect(w.get('[data-test="term-title"]').text()).toContain('back')
    expect(w.get('[data-test="term-title"]').text()).toContain('feat/x')
    await w.get('[data-test="term-select"]').trigger('click')
    expect(selectMode.value).toBe(true)
    await w.get('[data-test="term-copy-visible"]').trigger('click')
    expect(term.copyVisible).toHaveBeenCalled()
    expect(w.get('[data-test="term-copied"]').classes()).toContain('opacity-100')
  })
  it('click derecho abre el menú copiar/pegar', async () => {
    const w = mount(TerminalPane, { props: { session }, attachTo: document.body })
    await w.get('[data-test="term-body"]').trigger('contextmenu', { clientX: 10, clientY: 20 })
    await w.get('[data-test="ctx-copy"]').trigger('click')
    expect(term.copySelection).toHaveBeenCalled()
    expect(w.find('[data-test="ctx-copy"]').exists()).toBe(false)
    w.unmount()
  })
  it('expone fit e insert', () => {
    const w = mount(TerminalPane, { props: { session } })
    ;(w.vm as any).insert('hola ')
    expect(term.insert).toHaveBeenCalledWith('hola ')
    ;(w.vm as any).fit()
    expect(term.fit).toHaveBeenCalled()
  })
  it('botones sin estilo nativo (preflight apagado)', () => {
    const w = mount(TerminalPane, { props: { session } })
    for (const sel of ['[data-test="term-select"]', '[data-test="term-copy-visible"]']) {
      expect(w.get(sel).classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer', 'min-h-10']))
    }
  })
  it('el menú contextual marca data-term-menu y sus ítems tienen objetivo táctil ≥40px', async () => {
    const w = mount(TerminalPane, { props: { session }, attachTo: document.body })
    await w.get('[data-test="term-body"]').trigger('contextmenu', { clientX: 10, clientY: 20 })
    expect(w.get('[data-test="term-menu"]').attributes()).toHaveProperty('data-term-menu')
    expect(w.get('[data-test="ctx-copy"]').classes()).toContain('min-h-10')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(document.querySelector('[data-term-menu]')).toBeNull()
    w.unmount()
  })
  it('en phone las teclas en pantalla van en su fila, tamaño táctil (no dense)', () => {
    mode.value = 'phone'
    termKeysEnabled.value = true
    const w = mount(TerminalPane, { props: { session } })
    const row = w.get('[data-test="term-keys-row"]')
    expect(row.find('.termkeys').classes()).not.toContain('dense')
  })
})
