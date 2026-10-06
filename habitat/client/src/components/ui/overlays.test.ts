import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './sheet'
import { Input } from './input'

// Regresión: con el preflight apagado, <h2>/<p> traen márgenes del navegador, y los
// radios fijos (rounded-md/xs) no siguen el tema (--radius).
async function mountOverlay(kind: 'dialog' | 'sheet') {
  const [Root, Content, Title, Desc] = kind === 'dialog'
    ? [Dialog, DialogContent, DialogTitle, DialogDescription]
    : [Sheet, SheetContent, SheetTitle, SheetDescription]
  const C = defineComponent({
    render: () => h(Root as any, { open: true }, () => h(Content as any, kind === 'sheet' ? { side: 'bottom' } : {}, () => [
      h(Title as any, null, () => 'Título'), h(Desc as any, null, () => 'Descripción'),
    ])),
  })
  const w = mount(C, { attachTo: document.body })
  await flushPromises()
  return w
}

describe('overlays sin preflight', () => {
  it.each(['dialog', 'sheet'] as const)('%s: título y descripción con m-0; superficie y cerrar con el radio del tema', async (kind) => {
    const w = await mountOverlay(kind)
    const title = document.body.querySelector(`[data-slot="${kind}-title"]`)!
    const desc = document.body.querySelector(`[data-slot="${kind}-description"]`)!
    expect(title.classList.contains('m-0')).toBe(true)
    expect(desc.classList.contains('m-0')).toBe(true)
    const content = document.body.querySelector(`[data-slot="${kind}-content"]`)!
    expect(content.className).toContain('calc(var(--radius)+4px)')
    const close = content.querySelector('button')!
    expect(close.className).toContain('rounded-[var(--radius)]')
    expect(close.className).not.toMatch(/rounded-xs\b/)
    w.unmount()
  })
  it('Input usa el radio del tema', () => {
    const w = mount(Input)
    expect(w.get('input').classes()).toContain('rounded-[var(--radius)]')
    expect(w.get('input').classes()).not.toContain('rounded-md')
  })
})
