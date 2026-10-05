import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'

const mode = ref<'landscape' | 'portrait' | 'phone'>('landscape')
vi.mock('./useLayoutMode', () => ({ useLayoutMode: () => ({ mode }) }))

import { useFocusTools, resetFocusTools } from './useFocusTools'

beforeEach(() => { localStorage.clear(); mode.value = 'landscape'; resetFocusTools() })

describe('useFocusTools', () => {
  it('arranca en terminal, sin panel fijado ni carpeta', () => {
    const t = useFocusTools(ref('a'))
    expect(t.active.value).toBe('terminal')
    expect(t.pinned.value).toBeNull()
    expect(t.path.value).toBe('')
  })
  it('la pestaña activa es por sesión', () => {
    const id = ref<string | null>('a')
    const t = useFocusTools(id)
    t.select('git')
    id.value = 'b'
    expect(t.active.value).toBe('terminal')
    id.value = 'a'
    expect(t.active.value).toBe('git')
  })
  it('fijar deja la terminal activa y la herramienta al costado', () => {
    const t = useFocusTools(ref('a'))
    t.select('quest')
    t.pin('quest')
    expect(t.pinned.value).toBe('quest')
    expect(t.active.value).toBe('terminal')
  })
  it('con un panel fijado, elegir otra herramienta cambia el panel fijado y la terminal sigue a la izquierda', () => {
    const t = useFocusTools(ref('a'))
    t.pin('quest')
    t.select('git')
    expect(t.pinned.value).toBe('git')
    expect(t.active.value).toBe('terminal')
  })
  it('desfijar vuelve a pestañas con esa herramienta activa', () => {
    const t = useFocusTools(ref('a'))
    t.pin('files')
    t.unpin()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('files')
  })
  it('sólo se puede fijar en landscape', () => {
    const t = useFocusTools(ref('a'))
    mode.value = 'portrait'
    expect(t.canPin.value).toBe(false)
    t.pin('git')
    expect(t.pinned.value).toBeNull()
  })
  it('al salir de landscape se desfija y la herramienta pasa a la pestaña activa', async () => {
    const t = useFocusTools(ref('a'))
    t.pin('git')
    mode.value = 'portrait'
    await nextTick()
    expect(t.pinned.value).toBeNull()
    expect(t.active.value).toBe('git')
  })
  it('el ancho del panel fijado se persiste y tolera un localStorage que lanza', () => {
    const t = useFocusTools(ref('a'))
    expect(t.pinnedSize.value).toBe(40)
    t.setPinnedSize(55)
    expect(localStorage.getItem('habitat.focus.pinnedSize')).toBe('55')
    resetFocusTools()
    expect(useFocusTools(ref('a')).pinnedSize.value).toBe(55)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => t.setPinnedSize(30)).not.toThrow()
    spy.mockRestore()
  })
  it('la carpeta actual es por sesión', () => {
    const id = ref<string | null>('a')
    const t = useFocusTools(id)
    t.setPath('pkg/api')
    id.value = 'b'
    expect(t.path.value).toBe('')
    id.value = 'a'
    expect(t.path.value).toBe('pkg/api')
  })
  it('sin sesión no rompe', () => {
    const t = useFocusTools(ref(null))
    t.select('git'); t.pin('git'); t.setPath('x')
    expect(t.active.value).toBe('terminal')
    expect(t.pinned.value).toBeNull()
  })
})
