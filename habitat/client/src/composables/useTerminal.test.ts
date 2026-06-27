import { describe, it, expect } from 'vitest'
import { copyPasteIntent, canReadClipboard } from './useTerminal'

const ev = (o: Partial<KeyboardEvent>) =>
  ({ type: 'keydown', ctrlKey: false, shiftKey: false, metaKey: false, code: '', ...o }) as KeyboardEvent

describe('copyPasteIntent', () => {
  it('Linux/Windows: Ctrl+Shift+C copia, Ctrl+Shift+V pega', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))).toBe('copy')
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('Mac: Cmd+C copia, Cmd+V pega (metaKey)', () => {
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyC' }))).toBe('copy')
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('Ctrl+C pelado (sin shift) no se intercepta: debe llegar al pty como SIGINT', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyC' }))).toBe(null)
  })

  it('ignora eventos que no son keydown', () => {
    expect(copyPasteIntent(ev({ type: 'keyup', metaKey: true, code: 'KeyC' }))).toBe(null)
  })

  it('otras teclas con el modificador no disparan intent', () => {
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyA' }))).toBe(null)
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyK' }))).toBe(null)
  })
})

describe('canReadClipboard', () => {
  it('true cuando la Async Clipboard API está disponible (contexto seguro)', () => {
    expect(canReadClipboard({ clipboard: { readText: () => Promise.resolve('') } })).toBe(true)
  })

  it('false en contexto inseguro: navigator.clipboard es undefined (http por LAN)', () => {
    expect(canReadClipboard({})).toBe(false)
  })

  it('false si readText no existe (p. ej. navegadores sin soporte)', () => {
    expect(canReadClipboard({ clipboard: {} })).toBe(false)
  })
})
