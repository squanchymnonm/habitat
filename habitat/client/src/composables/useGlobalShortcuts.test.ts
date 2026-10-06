import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createSequence, useGlobalShortcuts } from './useGlobalShortcuts'
import { useSessions } from '../stores/sessions'

describe('createSequence', () => {
  it('g b → board, g f → focus', () => {
    const seq = createSequence()
    expect(seq('g', 0)).toBeNull()
    expect(seq('b', 100)).toBe('board')
    expect(seq('g', 200)).toBeNull()
    expect(seq('f', 300)).toBe('focus')
  })
  it('la secuencia vence y otra tecla la desarma', () => {
    const seq = createSequence(1000)
    seq('g', 0)
    expect(seq('b', 1500)).toBeNull()
    seq('g', 2000)
    expect(seq('x', 2100)).toBeNull()
    expect(seq('b', 2200)).toBeNull()
  })
  it('b sola no hace nada', () => {
    expect(createSequence()('b', 0)).toBeNull()
  })
})

describe('useGlobalShortcuts', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const key = (k: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  async function setup() {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: { template: '<div/>' } }, { path: '/s/:id', component: { template: '<div/>' } }, { path: '/board', component: { template: '<div/>' } },
    ] })
    await router.push('/'); await router.isReady()
    const w = mount(defineComponent({ setup() { useGlobalShortcuts(); return () => h('div') } }), { global: { plugins: [router] }, attachTo: document.body })
    return { router, w }
  }
  it('g b va al tablero y g f vuelve al foco de la seleccionada', async () => {
    const store = useSessions(); store.setAll([{ id: 'a', name: 'a', project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 } as any]); store.select('a')
    const { router, w } = await setup()
    key('g'); key('b'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/board')
    key('g'); key('f'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/s/a')
    w.unmount()
  })
  it('no actúa escribiendo en un input ni en la terminal', async () => {
    const { router, w } = await setup()
    const input = document.createElement('input'); document.body.appendChild(input)
    key('g', input); key('b', input); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    const xt = document.createElement('div'); xt.className = 'xterm'; const ta = document.createElement('textarea'); xt.appendChild(ta); document.body.appendChild(xt)
    key('g', ta); key('b', ta); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    input.remove(); xt.remove(); w.unmount()
  })
})
