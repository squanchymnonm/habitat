import { describe, it, expect } from 'vitest'
import { staminaHue } from './sprites'

describe('staminaHue', () => {
  it('mapea 0/50/100 a rojo/amarillo/verde', () => {
    expect(staminaHue(0)).toBe(0)
    expect(staminaHue(50)).toBe(60)
    expect(staminaHue(100)).toBe(120)
  })
  it('clampa fuera de rango', () => {
    expect(staminaHue(-10)).toBe(0)
    expect(staminaHue(150)).toBe(120)
  })
  it('redondea a entero', () => {
    expect(staminaHue(33)).toBe(40) // 33 * 1.2 = 39.6 -> 40
  })
})
