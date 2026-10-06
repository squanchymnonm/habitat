import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const listing = ref<any>({
  root: 'proj', rel: '', breadcrumbs: [],
  entries: [
    { name: 'src', rel: 'src', isDir: true, size: 0, isRepo: false },
    { name: 'mi archivo.md', rel: 'mi archivo.md', isDir: false, size: 1200, isRepo: false },
  ],
})
const loadTree = vi.fn(async () => {})
const loadFile = vi.fn(async () => ({ text: '# hola', size: 6 }))
const openInNvim = vi.fn(async () => ({ ok: true }))
vi.mock('../../composables/useProjectTree', () => ({
  useProjectTree: () => ({ listing, loading: ref(false), error: ref(''), loadTree, loadFile, openInNvim }),
}))
const upload = vi.fn(async () => ({ rel: '.habitat-uploads/foto.png' }))
vi.mock('../../composables/useFiles', async (orig) => ({ ...(await orig<any>()), useFiles: () => ({ upload }) }))
import FilesTool from './FilesTool.vue'

beforeEach(() => vi.clearAllMocks())

describe('FilesTool', () => {
  it('lista la carpeta actual de la sesión', async () => {
    mount(FilesTool, { props: { sessionId: 's1', path: 'pkg' } })
    await flushPromises()
    expect(loadTree).toHaveBeenCalledWith('s1', 'pkg')
  })
  it('click en carpeta pide navegar', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[0].trigger('click')
    expect(w.emitted('navigate')?.[0]).toEqual(['src'])
  })
  it('click en archivo muestra la vista previa; insertar escribe la ruta citada', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[1].trigger('click')
    await flushPromises()
    expect(w.get('[data-test="file-preview"]').text()).toContain('# hola')
    await w.get('[data-test="file-insert"]').trigger('click')
    expect(w.emitted('insert')?.[0]).toEqual(['"mi archivo.md" '])
  })
  it('editar en nvim emite opened', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    await w.findAll('[data-test="file-entry"]')[1].trigger('click')
    await flushPromises()
    await w.get('[data-test="file-edit"]').trigger('click')
    await flushPromises()
    expect(openInNvim).toHaveBeenCalledWith('s1', 'mi archivo.md')
    expect(w.emitted('opened')).toHaveLength(1)
  })
  it('subir un archivo inserta su ruta', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    const input = w.get('[data-test="file-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'foto.png')] })
    await input.trigger('change')
    await flushPromises()
    expect(upload).toHaveBeenCalled()
    expect(w.emitted('insert')?.[0]).toEqual(['.habitat-uploads/foto.png '])
  })
  it('entradas y acciones sin estilo nativo (preflight apagado)', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    expect(w.findAll('[data-test="file-entry"]')[0].classes()).toEqual(expect.arrayContaining(['border-0', 'bg-transparent']))
    expect(w.get('[data-test="file-upload"]').classes()).toContain('border-0')
  })
  it('migas, entradas y acciones con objetivo táctil ≥40px', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    expect(w.get('[data-test="file-crumb"]').classes()).toContain('min-h-10')
    expect(w.findAll('[data-test="file-entry"]')[0].classes()).toContain('min-h-10')
    expect(w.get('[data-test="file-upload"]').classes()).toContain('min-h-10')
  })
  it('con preview, en el teléfono la grilla usa dos filas acotadas (listado y preview scrollean aparte)', async () => {
    const w = mount(FilesTool, { props: { sessionId: 's1', path: '' } })
    expect(w.get('[data-test="file-grid"]').classes()).not.toContain('grid-rows-[minmax(0,1fr)_minmax(0,1fr)]')
    await w.findAll('[data-test="file-entry"]')[1].trigger('click')
    await flushPromises()
    expect(w.get('[data-test="file-grid"]').classes()).toEqual(expect.arrayContaining(['grid-rows-[minmax(0,1fr)_minmax(0,1fr)]', 'md:grid-rows-1']))
  })
})
