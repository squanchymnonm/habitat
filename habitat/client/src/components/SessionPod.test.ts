import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SessionPod from './SessionPod.vue'

// MiniArena dibuja en canvas (happy-dom no lo implementa): no hace falta para el dot.
const stubs = { MiniArena: true }
const session = (infra?: object) => ({
  id: 's1', name: 'bob', project: 'back', branch: 'bob', status: 'idle', action: '', since: 0, stamina: 100, infra,
}) as any

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('SessionPod — dot de infra', () => {
  it('sin infra (o sin carpeta de infra) no hay dot', () => {
    expect(mount(SessionPod, { props: { session: session() }, global: { stubs } }).find('.infra-dot').exists()).toBe(false)
    const sinDir = session({ stack: 'x', ports: {}, dir: '', branch: 'bob' })
    expect(mount(SessionPod, { props: { session: sinDir }, global: { stubs } }).find('.infra-dot').exists()).toBe(false)
  })

  it.each([['up', 'up'], ['partial', 'partial'], [undefined, 'off']])('estado %s -> clase %s', (state, cls) => {
    const w = mount(SessionPod, { props: { session: session({ stack: 'x', ports: {}, dir: '/wt/infra', branch: 'bob', state }) }, global: { stubs } })
    const dot = w.get('.infra-dot')
    expect(dot.classes()).toContain(cls)
    for (const other of ['up', 'partial', 'off'].filter((c) => c !== cls)) expect(dot.classes()).not.toContain(other)
  })
})
