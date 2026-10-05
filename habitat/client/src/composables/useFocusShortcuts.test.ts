import { describe, it, expect } from 'vitest'
import { shortcutFor } from './useFocusShortcuts'

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })
const el = (tag: string, cls = '') => { const e = document.createElement(tag); if (cls) e.className = cls; return e }

describe('shortcutFor', () => {
  it('[ y ] cambian de sesión; Esc', () => {
    expect(shortcutFor(ev('['), document.body)).toBe('prev')
    expect(shortcutFor(ev(']'), document.body)).toBe('next')
    expect(shortcutFor(ev('Escape'), document.body)).toBe('escape')
    expect(shortcutFor(ev('a'), document.body)).toBeNull()
  })
  it('con modificadores no es atajo', () => {
    expect(shortcutFor(ev('[', { ctrlKey: true }), document.body)).toBeNull()
    expect(shortcutFor(ev(']', { metaKey: true }), document.body)).toBeNull()
  })
  it('desactivados en la terminal y en inputs', () => {
    expect(shortcutFor(ev('['), el('textarea', 'xterm-helper-textarea'))).toBeNull()
    expect(shortcutFor(ev('Escape'), el('textarea', 'xterm-helper-textarea'))).toBeNull()
    expect(shortcutFor(ev('['), el('input'))).toBeNull()
    expect(shortcutFor(ev(']'), el('select'))).toBeNull()
    const ce = el('div'); ce.setAttribute('contenteditable', 'true')
    expect(shortcutFor(ev('['), ce)).toBeNull()
  })
  it('dentro de un contenedor xterm tampoco', () => {
    const wrap = el('div', 'xterm'); const inner = el('div'); wrap.appendChild(inner)
    expect(shortcutFor(ev(']'), inner)).toBeNull()
  })
})
