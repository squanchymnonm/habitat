import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GameSprite from './GameSprite.vue'

describe('GameSprite', () => {
  it('renderiza el Sprite base y la sombra de contacto por defecto', () => {
    const w = mount(GameSprite, { props: { src: 'x.png', height: 48, mode: 'static' } })
    expect(w.find('.gbase').exists()).toBe(true)
    expect(w.find('.gcontact').exists()).toBe(true)
  })
  it('omite la sombra de contacto con contact=false', () => {
    const w = mount(GameSprite, { props: { src: 'x.png', height: 48, mode: 'static', contact: false } })
    expect(w.find('.gcontact').exists()).toBe(false)
  })
})
