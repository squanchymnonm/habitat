import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TermKeys from './TermKeys.vue'

describe('TermKeys', () => {
  it('emite la tecla presionada', async () => {
    const w = mount(TermKeys)
    await w.findAll('button')[0].trigger('click')
    expect(w.emitted('press')?.[0]).toEqual(['up'])
  })

  it('por defecto no usa la variante densa', () => {
    const w = mount(TermKeys)
    expect(w.get('.termkeys').classes()).not.toContain('dense')
  })

  it('con dense agrega la clase para achicar las teclas dentro de una barra', () => {
    const w = mount(TermKeys, { props: { dense: true } })
    expect(w.get('.termkeys').classes()).toContain('dense')
  })

  it('por defecto el tamaño mínimo táctil es >= 40px (spec §5)', () => {
    const w = mount(TermKeys)
    const classes = w.findAll('button')[0].classes()
    expect(classes).toContain('min-h-10')
    expect(classes).toContain('min-w-10')
  })

  it('con dense el tamaño mínimo vuelve al de la barra de terminal (26x32)', () => {
    const w = mount(TermKeys, { props: { dense: true } })
    const classes = w.findAll('button')[0].classes()
    expect(classes).toContain('min-h-[26px]')
    expect(classes).toContain('min-w-8')
  })
})
