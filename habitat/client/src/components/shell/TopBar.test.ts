import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'

vi.mock('../session/NewSessionDialog.vue', () => ({ default: { props: ['open'], template: '<div data-test="ns-stub" :data-open="String(open)" />' } }))
vi.mock('../../composables/useProjects', () => ({ useProjects: () => ({ canSpawn: ref(true) }) }))
import TopBar from './TopBar.vue'
import { useSessions } from '../../stores/sessions'
import { setUsage } from '../../composables/useUsage'

const sess = (id: string, status: string) => ({ id, name: id, project: 'p', branch: '', status, action: '', since: 0, stamina: 100 }) as any
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/', component: { template: '<div/>' } },
  { path: '/s/:id', component: { template: '<div/>' } },
  { path: '/board', component: { template: '<div/>' } },
  { path: '/settings/:section?', component: { template: '<div/>' } },
] })

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
    // En teléfono sólo números: el texto "te necesita" se oculta bajo sm.
    expect(w.get('[data-test="need-label"]').classes()).toEqual(expect.arrayContaining(['hidden', 'sm:inline']))
    expect(w.get('[data-test="mana-fill"]').attributes('style')).toContain('width: 70%')
    expect(w.find('[data-test="new-session"]').exists()).toBe(true)
  })
  // Regresión: en teléfono (400px) la barra desbordaba; el resumen cede ancho y los controles no.
  it('la fila de la barra encoge sin desbordar: resumen min-w-0, controles shrink-0', () => {
    setActivePinia(createPinia())
    useSessions().setAll([sess('c', 'waiting')])
    setUsage({ pct: 30, resetAt: Math.floor(Date.now() / 1000) + 3600 })
    const w = mount(TopBar, { global: { plugins: [router] } })
    expect(w.get('[data-test="session-summary"]').classes()).toContain('min-w-0')
    expect(w.get('a').classes()).toContain('shrink-0')
    expect(w.get('[aria-label="Menú"]').classes()).toContain('shrink-0')
    expect(w.get('[aria-label="Maná: uso de Claude restante"]').classes()).toContain('shrink-0')
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
  // Regresión: un <a> (RouterLink) sin estilo explícito queda subrayado (default de <a>).
  it('el link de marca "Hábitat" no queda subrayado por el default de <a>', () => {
    setActivePinia(createPinia())
    useSessions().setAll([])
    const w = mount(TopBar, { global: { plugins: [router] } })
    expect(w.get('a').classes()).toContain('no-underline')
  })
  // Regresión: el zoom se mudó a Ajustes → Apariencia (PR 4); el menú de usuario ya
  // no lo incluye. El contenido del DropdownMenu se teleporta a document.body
  // (reka-ui), así que montamos con attachTo y lo buscamos ahí tras abrir.
  it('el menú de usuario ya no tiene zoom', async () => {
    setActivePinia(createPinia())
    useSessions().setAll([])
    const w = mount(TopBar, { global: { plugins: [router] }, attachTo: document.body })
    try {
      await w.get('[aria-label="Menú"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))
      expect(document.body.querySelector('[aria-label="Acercar"]')).toBeNull()
    } finally {
      w.unmount()
    }
  })
  it('el botón tablero/foco alterna entre /board y el foco', async () => {
    setActivePinia(createPinia())
    const r = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/s/:id', component: { template: '<div/>' } },
      { path: '/board', component: { template: '<div/>' } },
      { path: '/settings/:section?', component: { template: '<div/>' } },
    ] })
    useSessions().setAll([sess('a', 'idle')]); useSessions().select('a')
    await r.push('/s/a'); await r.isReady()
    const w = mount(TopBar, { global: { plugins: [r] } })
    const btn = w.get('[data-test="board-toggle"]')
    expect(btn.text()).toContain('Tablero')
    expect(btn.classes()).toEqual(expect.arrayContaining(['border-0', 'cursor-pointer', 'min-h-10']))
    await btn.trigger('click'); await flushPromises()
    expect(r.currentRoute.value.path).toBe('/board')
    expect(w.get('[data-test="board-toggle"]').text()).toContain('Foco')
    await w.get('[data-test="board-toggle"]').trigger('click'); await flushPromises()
    expect(r.currentRoute.value.path).toBe('/s/a')
  })
  it('el botón "Nueva sesión" abre el diálogo', async () => {
    setActivePinia(createPinia())
    useSessions().setAll([])
    const w = mount(TopBar, { global: { plugins: [router] } })
    const btn = w.get('[data-test="new-session"]')
    expect(btn.classes()).toEqual(expect.arrayContaining(['min-h-10', 'border-0', 'cursor-pointer']))
    expect(w.get('[data-test="ns-stub"]').attributes('data-open')).toBe('false')
    await btn.trigger('click')
    expect(w.get('[data-test="ns-stub"]').attributes('data-open')).toBe('true')
  })
})
