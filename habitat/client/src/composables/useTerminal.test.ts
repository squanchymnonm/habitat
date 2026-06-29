import { describe, it, expect } from 'vitest'
import { copyPasteIntent, decideKeyAction, canReadClipboard, joinBufferLines } from './useTerminal'

const ev = (o: Partial<KeyboardEvent>) =>
  ({ type: 'keydown', ctrlKey: false, shiftKey: false, metaKey: false, code: '', ...o }) as KeyboardEvent

describe('copyPasteIntent', () => {
  it('pega con Ctrl+V (semántica web, dispara el paste nativo)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('pega con Shift+Insert', () => {
    expect(copyPasteIntent(ev({ shiftKey: true, code: 'Insert' }))).toBe('paste')
  })

  it('pega con Cmd+V en Mac (metaKey)', () => {
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('pega con Ctrl+Shift+V (alias por compatibilidad)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('copia con Ctrl+C y con Cmd+C', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyC' }))).toBe('copy')
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyC' }))).toBe('copy')
  })

  it('Ctrl+Shift+C NO dispara copia (el navegador lo reserva para DevTools)', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))).toBe(null)
  })

  it('ignora eventos que no son keydown', () => {
    expect(copyPasteIntent(ev({ type: 'keyup', ctrlKey: true, code: 'KeyV' }))).toBe(null)
  })

  it('otras teclas con el modificador no disparan intent', () => {
    expect(copyPasteIntent(ev({ ctrlKey: true, code: 'KeyA' }))).toBe(null)
    expect(copyPasteIntent(ev({ metaKey: true, code: 'KeyK' }))).toBe(null)
  })
})

describe('decideKeyAction', () => {
  it('copy con selección copia', () => {
    expect(decideKeyAction('copy', true)).toBe('copy')
  })

  it('copy sin selección pasa al pty (SIGINT con Ctrl+C)', () => {
    expect(decideKeyAction('copy', false)).toBe('passthrough')
  })

  it('paste siempre pega, haya o no selección', () => {
    expect(decideKeyAction('paste', false)).toBe('paste')
    expect(decideKeyAction('paste', true)).toBe('paste')
  })

  it('sin intent, pasa al pty', () => {
    expect(decideKeyAction(null, true)).toBe('passthrough')
    expect(decideKeyAction(null, false)).toBe('passthrough')
  })
})

describe('joinBufferLines', () => {
  it('une líneas con saltos', () => {
    expect(joinBufferLines(['a', 'b', 'c'])).toBe('a\nb\nc')
  })

  it('recorta líneas en blanco al final (relleno del viewport)', () => {
    expect(joinBufferLines(['hola', 'mundo', '', '   ', ''])).toBe('hola\nmundo')
  })

  it('conserva líneas en blanco internas', () => {
    expect(joinBufferLines(['a', '', 'b'])).toBe('a\n\nb')
  })

  it('todo en blanco devuelve cadena vacía', () => {
    expect(joinBufferLines(['', '  ', ''])).toBe('')
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
