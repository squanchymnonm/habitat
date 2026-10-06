import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GitDiff from './GitDiff.vue'

const props = { file: 'a.ts', hunks: [], binary: false }

describe('GitDiff', () => {
  it('Esc nacido fuera del panel (p. ej. en la terminal con Git fijado) no cierra el diff ni se come la tecla', () => {
    const w = mount(GitDiff, { props, attachTo: document.body })
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    outside.dispatchEvent(ev)
    expect(w.emitted('close')).toBeUndefined()
    expect(ev.defaultPrevented).toBe(false)
    outside.remove()
    w.unmount()
  })
  it('Esc dentro del panel cierra el diff', () => {
    const w = mount(GitDiff, { props, attachTo: document.body })
    w.get('[role="dialog"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
  it('no se declara modal: no tapa la app (la terminal sigue usable al lado)', () => {
    const w = mount(GitDiff, { props })
    expect(w.get('[role="dialog"]').attributes('aria-modal')).toBeUndefined()
  })
})
