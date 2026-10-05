import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const canSpawn = ref(false)
vi.mock('../composables/useProjects', () => ({ useProjects: () => ({ canSpawn }) }))
vi.mock('../components/DetailPanel.vue', () => ({ default: { template: '<div data-test="detail-panel" />', methods: { fit() {} } } }))
import FocusRoute from './FocusRoute.vue'
import { useSessions } from '../stores/sessions'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

beforeEach(() => setActivePinia(createPinia()))

describe('FocusRoute — estado vacío', () => {
  it('sin sesiones y con spawn habilitado apunta al botón de nueva sesión', () => {
    canSpawn.value = true
    useSessions().setAll([])
    const w = mount(FocusRoute)
    const empty = w.get('[data-test="empty-sessions"]').text()
    expect(empty).toContain('No hay sesiones abiertas')
    expect(empty).toContain('Nueva sesión')
    expect(empty).not.toContain('mono <proyecto>')
    expect(w.find('[data-test="detail-panel"]').exists()).toBe(false)
  })
  it('sin sesiones y sin spawn explica que se arrancan con mono en el server', () => {
    canSpawn.value = false
    useSessions().setAll([])
    const w = mount(FocusRoute)
    const empty = w.get('[data-test="empty-sessions"]').text()
    expect(empty).toContain('mono <proyecto>')
    expect(empty).not.toContain('Nueva sesión')
  })
  it('con sesiones muestra el panel de detalle', () => {
    useSessions().setAll([sess('a')])
    const w = mount(FocusRoute)
    expect(w.find('[data-test="empty-sessions"]').exists()).toBe(false)
    expect(w.find('[data-test="detail-panel"]').exists()).toBe(true)
  })
})
