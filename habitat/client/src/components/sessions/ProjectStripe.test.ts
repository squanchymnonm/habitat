import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../../composables/useProjects', () => ({
  useProjects: () => ({ colorForProject: (n: string) => (n === 'RPG-Agents' ? '#4ec9b0' : '') }),
}))
import ProjectStripe from './ProjectStripe.vue'

describe('ProjectStripe', () => {
  it('pinta el color del proyecto de la sesión', () => {
    const el = mount(ProjectStripe, { props: { project: 'RPG-Agents' } }).get('[data-test="project-stripe"]').element as HTMLElement
    expect(el.style.background).toMatch(/#4ec9b0|rgb\(78, 201, 176\)/)
  })
  it('sin color conocido no dibuja nada', () => {
    expect(mount(ProjectStripe, { props: { project: 'otro' } }).find('[data-test="project-stripe"]').exists()).toBe(false)
  })
})
