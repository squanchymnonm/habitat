import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SessionAvatar from './SessionAvatar.vue'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import { send } from '../../composables/useSocket'

const sess = (status: string) => ({ id: 's1', name: 'ezio', project: 'p', branch: 'b', status, action: '', since: 0, stamina: 80 }) as any
afterEach(() => vi.clearAllMocks())

describe('SessionAvatar', () => {
  it('luz con el token del estado', () => {
    setActivePinia(createPinia())
    const w = mount(SessionAvatar, { props: { session: sess('waiting') } })
    expect(w.get('[data-test="state-light"]').classes()).toContain('bg-state-waiting')
    const w2 = mount(SessionAvatar, { props: { session: sess('offline') } })
    expect(w2.get('[data-test="state-light"]').classes()).toContain('bg-state-idle')
  })
  it('tocar la luz descarta "te necesita" y no propaga el click', async () => {
    setActivePinia(createPinia())
    const parent = vi.fn()
    const w = mount({ components: { SessionAvatar }, template: '<div @click="p"><SessionAvatar :session="s" /></div>', setup: () => ({ s: sess('waiting'), p: parent }) })
    await w.get('[data-test="state-light"]').trigger('click')
    expect(send).toHaveBeenCalledWith({ type: 'dismiss', id: 's1' })
    expect(parent).not.toHaveBeenCalled()
  })
  it('en otros estados la luz no descarta', async () => {
    setActivePinia(createPinia())
    const w = mount(SessionAvatar, { props: { session: sess('working') } })
    await w.get('[data-test="state-light"]').trigger('click')
    expect(send).not.toHaveBeenCalled()
  })
  it('la luz descartable tiene un área táctil de 40px que descarta sin propagar', async () => {
    setActivePinia(createPinia())
    const parent = vi.fn()
    const w = mount({ components: { SessionAvatar }, template: '<div @click="p"><SessionAvatar :session="s" /></div>', setup: () => ({ s: sess('error'), p: parent }) })
    const hit = w.get('[data-test="state-light"] [data-test="state-light-hit"]')
    // size-3 (12px) + 14px por lado = 40px.
    expect(hit.classes()).toEqual(expect.arrayContaining(['absolute', '-inset-[14px]']))
    expect(w.get('[data-test="state-light"]').classes()).toContain('size-3')
    await hit.trigger('click')
    expect(send).toHaveBeenCalledWith({ type: 'dismiss', id: 's1' })
    expect(parent).not.toHaveBeenCalled()
  })
  it('sin alerta no hay área táctil extra', () => {
    setActivePinia(createPinia())
    const w = mount(SessionAvatar, { props: { session: sess('working') } })
    expect(w.find('[data-test="state-light-hit"]').exists()).toBe(false)
  })
})
