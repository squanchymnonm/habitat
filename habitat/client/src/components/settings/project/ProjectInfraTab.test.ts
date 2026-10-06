import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ProjectInfraTab from './ProjectInfraTab.vue'
import { useProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import { PROJECT, stub, type Call } from './configTabs.test-utils'

afterEach(() => { vi.unstubAllGlobals() })

describe('ProjectInfraTab', () => {
  it('muestra la config actual y guarda los cambios de infra', async () => {
    const calls: Call[] = []
    stub(calls)
    const w = mount(ProjectInfraTab, { props: { draft: useProjectConfigDraft(ref(PROJECT)) } })
    await flushPromises()
    expect(w.text()).toContain('infra')
    expect((w.get('[data-test="infra-repo"]').element as HTMLSelectElement).value).toBe('infra')
    await w.get('[data-test="infra-path"]').setValue('docker')
    await w.get('[data-test="save-config"]').trigger('click')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({
      dir: '/root/back', related: PROJECT.related,
      infra: { repo: 'infra', path: 'docker', up: 'make up', down: '' }, envFiles: PROJECT.envFiles,
    })
    expect(w.text()).toContain('configuración guardada')
  })
})
