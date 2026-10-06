import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('../../composables/useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))
const projects = ref([
  { dir: '/p/back', name: 'back', color: '#888888', chars: ['Knight', 'Monk'] },
  { dir: '/p/front', name: 'front', color: '#888888' },
])
const error = ref('')
const spawn = vi.fn(async () => true)
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn: ref(true), projects, error, spawn }) }))
import NewSessionDialog from './NewSessionDialog.vue'
import { CHARACTERS } from '../../sprites'

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[]

beforeEach(() => { vi.clearAllMocks(); error.value = ''; mode.value = 'landscape'; spawn.mockResolvedValue(true) })

async function open() {
  const w = mount(NewSessionDialog, { props: { open: true }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('NewSessionDialog', () => {
  it('elegir proyecto muestra sólo los personajes permitidos', async () => {
    const w = await open()
    expect(qa('[data-test="ns-project"]').map((b) => b.textContent?.trim())).toEqual(['back', 'front'])
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    expect(qa('[data-test="ns-char"]').length).toBe(2)
    w.unmount()
  })
  it('sin allowlist se ofrecen todos los personajes', async () => {
    const w = await open()
    qa('[data-test="ns-project"]')[1].click(); await flushPromises()
    expect(qa('[data-test="ns-char"]').length).toBe(CHARACTERS.length)
    w.unmount()
  })
  it('crear llama a spawn con proyecto, nombre y personaje, y cierra', async () => {
    const w = await open()
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    const name = q('[data-test="ns-name"]') as HTMLInputElement
    name.value = 'ezio'; name.dispatchEvent(new Event('input')); await flushPromises()
    qa('[data-test="ns-char"]')[1].click(); await flushPromises()
    q('[data-test="ns-create"]').click(); await flushPromises()
    expect(spawn).toHaveBeenCalledWith('/p/back', 'ezio', 'Monk')
    const ev = w.emitted('update:open')
    expect(ev?.[ev.length - 1]).toEqual([false])
    w.unmount()
  })
  it('si falla muestra el error y no cierra', async () => {
    spawn.mockImplementationOnce(async () => { error.value = 'ya existe un personaje con ese nombre'; return false })
    const w = await open()
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    q('[data-test="ns-create"]').click(); await flushPromises()
    expect(q('[data-test="ns-error"]').textContent).toContain('ya existe')
    expect(w.emitted('update:open')).toBeUndefined()
    w.unmount()
  })
  it('al reabrir no arrastra el error de un intento anterior', async () => {
    error.value = 'ya existe un personaje con ese nombre'
    const w = await open()
    expect(q('[data-test="ns-error"]')).toBeNull()
    w.unmount()
  })
  it('en phone es un Sheet inferior', async () => {
    mode.value = 'phone'
    const w = await open()
    expect(q('[data-test="ns-sheet"]')).not.toBeNull()
    w.unmount()
  })
  it('en phone el cuerpo del Sheet tiene padding (no toca los bordes)', async () => {
    mode.value = 'phone'
    const w = await open()
    const cls = q('[data-test="ns-sheet-body"]').className
    expect(cls).toContain('px-4')
    expect(cls).toContain('pb-[calc(1rem+env(safe-area-inset-bottom,0px))]')
    w.unmount()
  })
  it('la descripción muestra "Elegí el proyecto" y, con uno elegido, su nombre', async () => {
    const w = await open()
    expect(q('[data-test="ns-description"]').textContent?.trim()).toBe('Elegí el proyecto')
    qa('[data-test="ns-project"]')[0].click(); await flushPromises()
    expect(q('[data-test="ns-description"]').textContent?.trim()).toBe('back')
    w.unmount()
  })
  it('botones táctiles y sin estilo nativo', async () => {
    const w = await open()
    const cls = qa('[data-test="ns-project"]')[0].className
    for (const c of ['min-h-10', 'border-0', 'cursor-pointer']) expect(cls).toContain(c)
    w.unmount()
  })
})
