import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn: ref(true) }) }))
const insert = vi.fn()
vi.mock('./TerminalPane.vue', () => ({ default: defineComponent({ props: ['session'], setup(_, { expose }) { expose({ fit: () => {}, insert }); return () => h('div', { 'data-test': 'terminal-pane' }) } }) }))
vi.mock('./SessionHeader.vue', () => ({ default: defineComponent({ props: ['session'], emits: ['open-editor'], setup: (_, { emit }) => () => h('button', { 'data-test': 'header-editor', onClick: () => emit('open-editor') }) }) }))
vi.mock('./EditorPane.vue', () => ({ default: defineComponent({ props: ['sessionId'], emits: ['close'], setup: () => () => h('div', { 'data-test': 'editor-pane' }) }) }))
// function (no const): las fábricas de mock de abajo la invocan apenas se resuelve
// el módulo de cada herramienta, antes de que corra el resto del archivo — una
// `const` con arrow cae en TDZ ahí; una declaración `function` queda hoisteada entera.
function stub(t: string, emits: string[] = []) {
  return { default: defineComponent({ props: ['sessionId', 'session', 'path'], emits, setup: (_, { emit }) => () => h('div', { 'data-test': t, onClick: () => emit(emits[0] as any, '"a b.md" ') }) }) }
}
vi.mock('../tools/git/GitTool.vue', () => stub('git-tool'))
vi.mock('../tools/FilesTool.vue', () => stub('files-tool', ['insert', 'navigate', 'opened']))
vi.mock('../tools/QuestTool.vue', () => stub('quest-tool'))
vi.mock('../tools/InfraTool.vue', () => stub('infra-tool'))
import FocusView from './FocusView.vue'
import { useSessions } from '../../stores/sessions'
import { useFocusTools, resetFocusTools } from '../../composables/useFocusTools'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

beforeEach(() => { setActivePinia(createPinia()); resetFocusTools(); mode.value = 'landscape'; vi.clearAllMocks() })

describe('FocusView', () => {
  it('la terminal queda montada al cambiar de pestaña', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    // isVisible() (getComputedStyle) necesita el nodo en el document.
    const w = mount(FocusView, { attachTo: document.body })
    useFocusTools(ref('a')).select('git'); await flushPromises()
    expect(w.find('[data-test="git-tool"]').exists()).toBe(true)
    const pane = w.get('[data-test="terminal-pane"]')
    expect(pane.isVisible()).toBe(false)
    useFocusTools(ref('a')).select('terminal'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
    w.unmount()
  })
  it('insertar desde Archivos escribe en la terminal', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    useFocusTools(ref('a')).select('files'); await flushPromises()
    await w.get('[data-test="files-tool"]').trigger('click')
    expect(insert).toHaveBeenCalledWith('"a b.md" ')
  })
  it('con un panel fijado se ven terminal y herramienta a la vez', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView, { attachTo: document.body })
    useFocusTools(ref('a')).pin('quest'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
    expect(w.find('[data-test="quest-tool"]').exists()).toBe(true)
    expect(w.find('[data-test="pinned-panel"]').exists()).toBe(true)
    w.unmount()
  })
  it('abrir en editor muestra el EditorPane', async () => {
    useSessions().setAll([sess('a')]); useSessions().select('a')
    const w = mount(FocusView)
    await w.get('[data-test="header-editor"]').trigger('click')
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
  })
  it('sin selección no renderiza nada', () => {
    useSessions().setAll([])
    const w = mount(FocusView)
    expect(w.find('[data-test="terminal-pane"]').exists()).toBe(false)
  })
})
