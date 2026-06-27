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
  it('skyGradient: noche usa negro cálido de fragua (no púrpura frío)', () => {
    // p=1.0 → STOP noche cálido top #191320 / bot #130d08
    expect(skyGradient(1)).toBe('linear-gradient(180deg, rgb(25, 19, 32), rgb(19, 13, 8))')
  })
  it('skyGradient: día tiende a ámbar tostado cálido', () => {
    // p=0.16 → STOP día top #473828 / bot #5d421f
    expect(skyGradient(0.16)).toBe('linear-gradient(180deg, rgb(71, 56, 40), rgb(93, 66, 31))')
  })
})
