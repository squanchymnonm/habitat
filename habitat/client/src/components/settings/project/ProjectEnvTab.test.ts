import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ProjectEnvTab from './ProjectEnvTab.vue'
import { useProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import { PROJECT, resp, stub, type Call } from './fetchStub'

afterEach(() => { vi.unstubAllGlobals() })

const mountTab = (project: typeof PROJECT) =>
  mount(ProjectEnvTab, { props: { project, draft: useProjectConfigDraft(ref(project)) } })

describe('ProjectEnvTab', () => {
  it('edita una plantilla: carga, importa, guarda y muestra desconocidas', async () => {
    const calls: Call[] = []
    stub(calls, { '/projects/env?': resp({ content: 'A={{port:db}}' }) })
    const w = mountTab(PROJECT)
    await flushPromises()
    await w.get('[data-test="env-open"]').trigger('click')
    await flushPromises()
    const ta = w.get('[data-test="env-text"]')
    expect((ta.element as HTMLTextAreaElement).value).toBe('A={{port:db}}')
    await w.get('[data-test="env-import"]').trigger('click')
    await flushPromises()
    expect((ta.element as HTMLTextAreaElement).value).toBe('REAL=1')
    stub(calls, { '/projects/env': resp({ unknown: ['{{x}}'] }, 400) })
    await w.get('[data-test="env-save"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('variables desconocidas: {{x}}')
  })

  it('el editor sigue al archivo (no al índice) cuando se quita una fila anterior', async () => {
    const calls: Call[] = []
    const project = { ...PROJECT, envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: '.env' }] }
    stub(calls)
    const w = mountTab(project)
    await flushPromises()
    // Abrir el editor del SEGUNDO archivo (infra/.env).
    await w.findAll('[data-test="env-open"]')[1].trigger('click')
    await flushPromises()
    expect(w.find('[data-test="env-text"]').exists()).toBe(true)
    // Quitar la PRIMERA fila (self/.env): el editor debe seguir abierto, apuntando a infra/.env.
    await w.findAll('[data-test="env-remove"]')[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test="env-text"]').exists()).toBe(true)
    await w.get('[data-test="env-save"]').trigger('click')
    await flushPromises()
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toMatchObject({ repo: 'infra', path: '.env' })
  })

  it('quitar la fila en edición cierra el editor', async () => {
    const project = { ...PROJECT, envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: '.env' }] }
    stub([])
    const w = mountTab(project)
    await flushPromises()
    await w.findAll('[data-test="env-open"]')[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test="env-text"]').exists()).toBe(true)
    await w.findAll('[data-test="env-remove"]')[0].trigger('click') // quita self/.env, que es la que se edita
    await flushPromises()
    expect(w.find('[data-test="env-text"]').exists()).toBe(false)
  })
})
