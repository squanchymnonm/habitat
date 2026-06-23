import { describe, it, expect } from 'vitest'
import { useProjects, applyServerProjects } from './useProjects'

describe('useProjects.colorForProject', () => {
  it('mapea el color por basename del dir y default vacío si no hay match', () => {
    applyServerProjects([{ dir: '/home/u/proj-api', name: 'proj-api', color: '#e7c14a', chars: [] }])
    const { colorForProject } = useProjects()
    expect(colorForProject('proj-api')).toBe('#e7c14a')
    expect(colorForProject('desconocido')).toBe('')
  })
})
