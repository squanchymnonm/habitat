import { describe, it, expect } from 'vitest'
import { nextLayoutHeight } from './useViewport'

describe('nextLayoutHeight', () => {
  it('en touch, con el mismo ancho, ignora que el alto baje (teclado en pantalla)', () => {
    const s = nextLayoutHeight(null, 1280, 800, true)
    expect(nextLayoutHeight(s, 1280, 420, true)).toEqual({ width: 1280, height: 800 })
  })
  it('en touch, al cambiar el ancho (rotación) toma el alto nuevo', () => {
    const s = nextLayoutHeight({ width: 1280, height: 800 }, 800, 1280, true)
    expect(s).toEqual({ width: 800, height: 1280 })
    expect(nextLayoutHeight({ width: 1280, height: 800 }, 800, 500, true)).toEqual({ width: 800, height: 500 })
  })
  it('en touch, si el alto crece (se esconde la barra del navegador) lo toma', () => {
    expect(nextLayoutHeight({ width: 1280, height: 760 }, 1280, 800, true)).toEqual({ width: 1280, height: 800 })
  })
  it('sin touch sigue el alto real (achicar la ventana en desktop)', () => {
    expect(nextLayoutHeight({ width: 1440, height: 900 }, 1440, 500, false)).toEqual({ width: 1440, height: 500 })
  })
})
