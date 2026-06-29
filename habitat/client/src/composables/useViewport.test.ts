import { describe, it, expect } from 'vitest'
import { isNarrowViewport } from './useViewport'

describe('isNarrowViewport', () => {
  it('tablet portrait (810x1080) NO es narrow → layout desktop', () => {
    expect(isNarrowViewport(810, 1080)).toBe(false)
  })

  it('tablet landscape (1080x810) NO es narrow', () => {
    expect(isNarrowViewport(1080, 810)).toBe(false)
  })

  it('teléfono portrait (390x844) es narrow → overlay', () => {
    expect(isNarrowViewport(390, 844)).toBe(true)
  })

  it('teléfono landscape (844x390) es narrow (alto < 600)', () => {
    expect(isNarrowViewport(844, 390)).toBe(true)
  })

  it('límite: 600x600 NO es narrow; 599 de cualquier lado sí', () => {
    expect(isNarrowViewport(600, 600)).toBe(false)
    expect(isNarrowViewport(599, 600)).toBe(true)
    expect(isNarrowViewport(600, 599)).toBe(true)
  })
})
