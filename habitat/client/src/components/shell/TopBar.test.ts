import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../SpawnMenu.vue', () => ({ default: { template: '<button data-test="spawn">+</button>' } }))
import TopBar from './TopBar.vue'
import { useSessions } from '../../stores/sessions'
import { setUsage } from '../../composables/useUsage'

const sess = (id: string, status: string) => ({ id, name: id, project: 'p', branch: '', status, action: '', since: 0, stamina: 100 }) as any
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/settings/:section?', component: { template: '<div/>' } }] })

describe('TopBar', () => {
  it('resumen con totales por estado y maná', async () => {
    setActivePinia(createPinia())
    useSessions().setAll([sess('a', 'working'), sess('b', 'working'), sess('c', 'waiting'), sess('d', 'idle')])
    setUsage({ pct: 30, resetAt: Math.floor(Date.now() / 1000) + 3600 })
    const w = mount(TopBar, { global: { plugins: [router] } })
    const sum = w.get('[data-test="session-summary"]').text()
    expect(sum).toContain('4')
    expect(sum).toContain('2 trabajando')
    expect(sum).toContain('1 te necesita')
    expect(w.get('[data-test="mana-fill"]').attributes('style')).toContain('width: 70%')
    expect(w.find('[data-test="spawn"]').exists()).toBe(true)
  })
  // Regresión: sin el preflight de Tailwind, el trigger del menú de usuario (reka-ui
  // DropdownMenuTrigger, un <button> real) heredaba cara blanca nativa.
  it('el trigger del menú de usuario no depende del estilo nativo del botón', () => {
    setActivePinia(createPinia())
    useSessions().setAll([])
    const w = mount(TopBar, { global: { plugins: [router] } })
    const trigger = w.get('[aria-label="Menú"]')
    expect(trigger.classes()).toContain('bg-transparent')
    expect(trigger.classes()).toContain('border-0')
  })
})
