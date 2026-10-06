import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ProjectRelatedTab from './ProjectRelatedTab.vue'
import { useProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import { PROJECT, stub, type Call } from './configTabs.test-utils'

afterEach(() => { vi.unstubAllGlobals() })

describe('ProjectRelatedTab', () => {
  it('agrega un relacionado desde el navegador (sólo repos) con nombre = carpeta', async () => {
    const calls: Call[] = []
    stub(calls)
    const w = mount(ProjectRelatedTab, { props: { draft: useProjectConfigDraft(ref(PROJECT)) } })
    await flushPromises()
    await w.get('[data-test="related-add"]').trigger('click')
    await flushPromises()
    const picks = w.findAll('[data-test="related-pick"]')
    expect(picks).toHaveLength(2)
    expect(picks[1].attributes('disabled')).toBeDefined() // 'plain' no es repo
    await picks[0].trigger('click')
    expect(w.findAll('[data-test="related-row"]').map((r) => (r.get('input').element as HTMLInputElement).value)).toEqual(['infra', 'front'])
  })

  it('marca en rojo (con texto, no sólo color) un relacionado que ya no existe', async () => {
    stub([])
    const project = { ...PROJECT, related: [{ dir: '/root/docker', name: 'infra', exists: false }] }
    const w = mount(ProjectRelatedTab, { props: { draft: useProjectConfigDraft(ref(project)) } })
    await flushPromises()
    const row = w.get('[data-test="related-row"]')
    expect(row.find('.text-danger').exists()).toBe(true)
    expect(row.text()).toContain('no existe')
  })
})
