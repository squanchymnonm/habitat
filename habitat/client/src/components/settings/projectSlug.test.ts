import { describe, it, expect } from 'vitest'
import { projectSlug } from './projectSlug'

describe('projectSlug', () => {
  it('toma el último segmento de la ruta', () => {
    expect(projectSlug('/a/b/back')).toBe('back')
  })
  it('ignora una barra final', () => {
    expect(projectSlug('back/')).toBe('back')
  })
  it('una carpeta sin barras queda igual', () => {
    expect(projectSlug('back')).toBe('back')
  })
})
