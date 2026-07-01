import { describe, it, expect } from 'vitest'
import { copyPasteIntent, decideKeyAction, canReadClipboard, joinBufferLines, rowFromY, wheelNotchesFromDelta, isVerticalDrag, keySeq } from './useTerminal'

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

describe('rowFromY', () => {
  // term de 24 filas, rect de 0..480 (20px por fila), viewport arrancando en 0.
  it('mapea el medio del rect a la fila del medio', () => {
    expect(rowFromY(250, 0, 480, 24, 0)).toBe(12)
  })

  it('clampa por arriba a la primera fila visible', () => {
    expect(rowFromY(-50, 0, 480, 24, 0)).toBe(0)
  })

  it('clampa por abajo a la última fila visible', () => {
    expect(rowFromY(9999, 0, 480, 24, 0)).toBe(23)
  })

  it('suma el desplazamiento del viewport (scrollback)', () => {
    expect(rowFromY(10, 0, 480, 24, 100)).toBe(100)
    expect(rowFromY(9999, 0, 480, 24, 100)).toBe(123)
  })

  it('rect degenerado (alto 0) cae a la primera fila del viewport', () => {
    expect(rowFromY(10, 0, 0, 24, 5)).toBe(5)
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

describe('wheelNotchesFromDelta', () => {
  it('trunca el desplazamiento acumulado a notches enteros', () => {
    expect(wheelNotchesFromDelta(40, 17)).toBe(2) // trunc(2.35)
  })

  it('conserva el signo (dedo hacia arriba = acumulado negativo)', () => {
    expect(wheelNotchesFromDelta(-40, 17)).toBe(-2)
  })

  it('devuelve 0 si no se alcanzó una celda completa', () => {
    expect(wheelNotchesFromDelta(10, 17)).toBe(0)
  })

  it('devuelve 0 con cellHeight inválido (evita dividir por cero)', () => {
    expect(wheelNotchesFromDelta(100, 0)).toBe(0)
  })
})

describe('isVerticalDrag', () => {
  it('es vertical cuando |dy| > |dx|', () => {
    expect(isVerticalDrag(5, 40)).toBe(true)
  })

  it('no es vertical cuando el arrastre es mayormente horizontal', () => {
    expect(isVerticalDrag(40, 5)).toBe(false)
  })

  it('empate (45°) no cuenta como vertical', () => {
    expect(isVerticalDrag(20, 20)).toBe(false)
  })
})

describe('keySeq', () => {
  it('flechas en modo normal (CSI)', () => {
    expect(keySeq('up', false)).toBe('\x1b[A')
    expect(keySeq('down', false)).toBe('\x1b[B')
    expect(keySeq('right', false)).toBe('\x1b[C')
    expect(keySeq('left', false)).toBe('\x1b[D')
  })
  it('flechas en modo application cursor keys (SS3)', () => {
    expect(keySeq('up', true)).toBe('\x1bOA')
    expect(keySeq('down', true)).toBe('\x1bOB')
    expect(keySeq('right', true)).toBe('\x1bOC')
    expect(keySeq('left', true)).toBe('\x1bOD')
  })
  it('Enter/Esc/Tab no dependen del modo', () => {
    expect(keySeq('enter', false)).toBe('\r')
    expect(keySeq('enter', true)).toBe('\r')
    expect(keySeq('esc', false)).toBe('\x1b')
    expect(keySeq('tab', true)).toBe('\t')
  })
})
