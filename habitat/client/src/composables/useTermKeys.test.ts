import { describe, it, expect } from 'vitest'
import { readInitialEnabled } from './useTermKeys'

describe('readInitialEnabled', () => {
  it('respeta el valor guardado "1" (ON) por encima de la detección táctil', () => {
    expect(readInitialEnabled('1', false)).toBe(true)
  })
  it('respeta el valor guardado "0" (OFF) por encima de la detección táctil', () => {
    expect(readInitialEnabled('0', true)).toBe(false)
  })
  it('sin valor guardado usa la detección táctil (coarse=true → ON)', () => {
    expect(readInitialEnabled(null, true)).toBe(true)
  })
  it('sin valor guardado y no táctil → OFF', () => {
    expect(readInitialEnabled(null, false)).toBe(false)
  })
})
