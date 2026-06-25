import { describe, it, expect } from 'vitest'
import { quotePath } from './useFiles'

describe('quotePath', () => {
  it('deja el path tal cual si no tiene espacios', () => {
    expect(quotePath('.habitat-uploads/logo.png')).toBe('.habitat-uploads/logo.png')
    expect(quotePath('src/main.ts')).toBe('src/main.ts')
  })
  it('envuelve en comillas si tiene espacios', () => {
    expect(quotePath('.habitat-uploads/mi captura.png')).toBe('".habitat-uploads/mi captura.png"')
  })
})
