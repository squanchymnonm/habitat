import { describe, it, expect } from 'vitest'
import { pickSelection } from './pickSelection'

describe('pickSelection', () => {
  it('mantiene la selección actual si sigue en la lista', () => {
    expect(pickSelection(['a', 'b', 'c'], 'b')).toBe('b')
  })
  it('selecciona el primero cuando no hay selección', () => {
    expect(pickSelection(['a', 'b'], null)).toBe('a')
  })
  it('reselecciona el primero si el actual desapareció', () => {
    expect(pickSelection(['b', 'c'], 'a')).toBe('b')
  })
  it('devuelve null con lista vacía', () => {
    expect(pickSelection([], 'a')).toBe(null)
  })
})
