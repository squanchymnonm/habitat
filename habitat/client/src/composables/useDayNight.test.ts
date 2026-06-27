import { describe, it, expect } from 'vitest'
import { dialPositions, skyGradient } from './useDayNight'

describe('useDayNight', () => {
  it('dialPositions: sol y luna desfasados medio ciclo', () => {
    expect(dialPositions(0)).toEqual({ sun: 120, moon: 0 })   // sol abajo, luna centro
    expect(dialPositions(0.25)).toEqual({ sun: 60, moon: -60 })
    expect(dialPositions(0.5)).toEqual({ sun: 0, moon: 120 })  // luna reaparece abajo
    expect(dialPositions(null)).toEqual({ sun: 120, moon: 0 })
  })
  it('skyGradient: null vacío; con valor devuelve linear-gradient', () => {
    expect(skyGradient(null)).toBe('')
    expect(skyGradient(0)).toMatch(/^linear-gradient\(180deg, /)
    expect(skyGradient(1)).toMatch(/^linear-gradient\(180deg, /)
  })
})
