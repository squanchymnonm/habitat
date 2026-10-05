import { describe, it, expect } from 'vitest'
import { buttonVariants } from '.'

// Regresión: sin el preflight de Tailwind, una variante sin bg/borde explícitos deja
// que el <button> herede la cara blanca y el borde nativos del navegador.
describe('buttonVariants — independientes del estilo nativo del botón', () => {
  it.each(['ghost', 'link'] as const)('%s declara bg-transparent y border-0', (variant) => {
    const cls = buttonVariants({ variant }).split(' ')
    expect(cls).toContain('bg-transparent')
    expect(cls).toContain('border-0')
  })
  it.each(['default', 'destructive', 'secondary'] as const)('%s declara border-0', (variant) => {
    expect(buttonVariants({ variant }).split(' ')).toContain('border-0')
  })
})
