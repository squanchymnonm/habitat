import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createHabitatRouter, syncSelectionWithRoute } from '../../router'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
const canSpawn = ref(true)
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn }) }))
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

const sess = (id: string, infra?: any) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100, infra }) as any

beforeEach(() => { setActivePinia(createPinia()); resetFocusTools(); mode.value = 'landscape'; canSpawn.value = true; vi.clearAllMocks() })

// FocusView usa useGoToSession (atajos [ ]), que requiere router: se monta siempre con
// uno de memoria, igual que SessionNav.test.ts.
async function mountFocus(sessions: any[], path = `/s/${sessions[0]?.id}`, opts: Record<string, unknown> = {}) {
  const store = useSessions()
  store.setAll(sessions)
  const router = createHabitatRouter(createMemoryHistory())
  syncSelectionWithRoute(router, store)
  await router.push(path)
  await router.isReady()
  const w = mount(FocusView, { global: { plugins: [router] }, ...opts })
  return { w, store, router }
}

describe('FocusView', () => {
  it('la terminal queda montada al cambiar de pestaña', async () => {
    // isVisible() (getComputedStyle) necesita el nodo en el document.
    const { w } = await mountFocus([sess('a')], '/s/a', { attachTo: document.body })
    useFocusTools(ref('a')).select('git'); await flushPromises()
    expect(w.find('[data-test="git-tool"]').exists()).toBe(true)
    const pane = w.get('[data-test="terminal-pane"]')
    expect(pane.isVisible()).toBe(false)
    useFocusTools(ref('a')).select('terminal'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
    w.unmount()
  })
  it('insertar desde Archivos escribe en la terminal y vuelve a la pestaña terminal', async () => {
    const { w } = await mountFocus([sess('a')])
    useFocusTools(ref('a')).select('files'); await flushPromises()
    await w.get('[data-test="files-tool"]').trigger('click')
    expect(insert).toHaveBeenCalledWith('"a b.md" ')
    expect(useFocusTools(ref('a')).active.value).toBe('terminal')
    w.unmount()
  })
  it('insertar con Archivos fijado escribe en la terminal y no cambia de pestaña', async () => {
    const { w } = await mountFocus([sess('a')])
    useFocusTools(ref('a')).pin('files'); await flushPromises()
    await w.get('[data-test="files-tool"]').trigger('click')
    expect(insert).toHaveBeenCalledWith('"a b.md" ')
    expect(useFocusTools(ref('a')).active.value).toBe('terminal')
    expect(useFocusTools(ref('a')).pinned.value).toBe('files')
    w.unmount()
  })
  it('con un panel fijado se ven terminal y herramienta a la vez', async () => {
    const { w } = await mountFocus([sess('a')], '/s/a', { attachTo: document.body })
    useFocusTools(ref('a')).pin('quest'); await flushPromises()
    expect(w.get('[data-test="terminal-pane"]').isVisible()).toBe(true)
    expect(w.find('[data-test="quest-tool"]').exists()).toBe(true)
    expect(w.find('[data-test="pinned-panel"]').exists()).toBe(true)
    w.unmount()
  })
  it('abrir en editor muestra el EditorPane', async () => {
    const { w } = await mountFocus([sess('a')])
    await w.get('[data-test="header-editor"]').trigger('click')
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
    w.unmount()
  })
  it('elegir una pestaña de herramienta cierra el editor', async () => {
    const { w } = await mountFocus([sess('a')])
    await w.get('[data-test="header-editor"]').trigger('click')
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
    const git = w.findAll('[data-test="tool-tab"]').find((b) => b.text() === 'Git')!
    await git.trigger('click'); await flushPromises()
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(false)
    expect(w.find('[data-test="git-tool"]').exists()).toBe(true)
    w.unmount()
  })
  it('elegir la pestaña ya activa también cierra el editor', async () => {
    const { w } = await mountFocus([sess('a')])
    await w.get('[data-test="header-editor"]').trigger('click')
    await w.findAll('[data-test="tool-tab"]')[0].trigger('click'); await flushPromises()
    expect(w.find('[data-test="editor-pane"]').exists()).toBe(false)
    w.unmount()
  })
  it('sin selección no renderiza nada', async () => {
    const { w } = await mountFocus([], '/')
    expect(w.find('[data-test="terminal-pane"]').exists()).toBe(false)
    w.unmount()
  })

  describe('atajos de teclado', () => {
    it('] navega a la sesión siguiente y [ a la anterior, de forma circular', async () => {
      const { w, router } = await mountFocus([sess('a'), sess('b')], '/s/a')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))
      await flushPromises()
      expect(router.currentRoute.value.fullPath).toBe('/s/b')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
      await flushPromises()
      expect(router.currentRoute.value.fullPath).toBe('/s/a')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
      await flushPromises()
      expect(router.currentRoute.value.fullPath).toBe('/s/b')
      w.unmount()
    })
    it('Esc con un panel fijado lo desfija', async () => {
      const { w } = await mountFocus([sess('a')])
      useFocusTools(ref('a')).pin('quest'); await flushPromises()
      expect(useFocusTools(ref('a')).pinned.value).toBe('quest')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(useFocusTools(ref('a')).pinned.value).toBeNull()
      w.unmount()
    })
    it('Esc con el editor abierto lo cierra primero (no desfija el panel)', async () => {
      const { w } = await mountFocus([sess('a')])
      useFocusTools(ref('a')).pin('quest'); await flushPromises()
      await w.get('[data-test="header-editor"]').trigger('click')
      expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(w.find('[data-test="editor-pane"]').exists()).toBe(false)
      expect(useFocusTools(ref('a')).pinned.value).toBe('quest')
      w.unmount()
    })
    // Reka's DismissableLayer escucha Esc en window y sólo cierra si el evento no llegó
    // con preventDefault; nuestro atajo tampoco debe actuar mientras hay un diálogo
    // abierto en cualquier parte del documento: el diálogo es dueño del Esc.
    it('Esc con un diálogo abierto no cierra el editor (el diálogo es dueño del Esc)', async () => {
      const { w } = await mountFocus([sess('a')])
      await w.get('[data-test="header-editor"]').trigger('click')
      expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('data-state', 'open')
      document.body.appendChild(dialog)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
      dialog.remove()
      w.unmount()
    })
    it('Esc con el menú contextual de la terminal abierto sólo cierra el menú (no el editor ni el panel)', async () => {
      const { w } = await mountFocus([sess('a')])
      useFocusTools(ref('a')).pin('quest'); await flushPromises()
      await w.get('[data-test="header-editor"]').trigger('click')
      const menu = document.createElement('div')
      menu.setAttribute('data-term-menu', '')
      document.body.appendChild(menu)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(w.find('[data-test="editor-pane"]').exists()).toBe(true)
      expect(useFocusTools(ref('a')).pinned.value).toBe('quest')
      menu.remove()
      w.unmount()
    })
  })

  describe('selección de Infra obsoleta', () => {
    it('si se pierde el gate de Infra estando fijada, se desfija', async () => {
      const { w } = await mountFocus([sess('a', { dir: '/wt/infra' })])
      useFocusTools(ref('a')).pin('infra'); await flushPromises()
      expect(useFocusTools(ref('a')).pinned.value).toBe('infra')
      canSpawn.value = false
      await flushPromises()
      expect(useFocusTools(ref('a')).pinned.value).toBeNull()
      expect(useFocusTools(ref('a')).active.value).toBe('terminal')
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(false)
      w.unmount()
    })
    it('si se pierde el gate de Infra estando activa (sin fijar), vuelve a terminal', async () => {
      const { w } = await mountFocus([sess('a', { dir: '/wt/infra' })])
      useFocusTools(ref('a')).select('infra'); await flushPromises()
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(true)
      canSpawn.value = false
      await flushPromises()
      expect(useFocusTools(ref('a')).active.value).toBe('terminal')
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(false)
      w.unmount()
    })
    it('al pasar a una sesión sin infra que tenía Infra guardada, muestra la terminal', async () => {
      // a no tiene infra; b tenía Infra activa y la pierde mientras está seleccionada a.
      // Volver a b es false→false para infraAllowed: un watch sólo de ese gate no se entera.
      const { w, router } = await mountFocus([sess('a'), sess('b', { dir: '/wt/infra-b' })], '/s/b')
      useFocusTools(ref('b')).select('infra'); await flushPromises()
      await router.push('/s/a'); await flushPromises()
      useSessions().upsert(sess('b', { dir: '' }))
      await flushPromises()
      await router.push('/s/b'); await flushPromises()
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(false)
      expect(useFocusTools(ref('b')).active.value).toBe('terminal')
      w.unmount()
    })
    it('si session.infra.dir queda vacío (canSpawn sigue en true), vuelve a terminal', async () => {
      const { w, store } = await mountFocus([sess('a', { dir: '/wt/infra' })])
      useFocusTools(ref('a')).select('infra'); await flushPromises()
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(true)
      store.upsert(sess('a', { dir: '' }))
      await flushPromises()
      expect(useFocusTools(ref('a')).active.value).toBe('terminal')
      expect(w.find('[data-test="infra-tool"]').exists()).toBe(false)
      w.unmount()
    })
  })
})
