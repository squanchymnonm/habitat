import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'

type Cfg = { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] }
const saveConfig = vi.fn<(dir: string, cfg: Cfg) => Promise<{ ok: true } | { ok: false; error: string }>>()
vi.mock('./useProjects', () => ({ useProjects: () => ({ saveConfig }) }))

import { useProjectConfigDraft } from './useProjectConfigDraft'

const PROJECT: Project = {
  dir: '/root/back', name: 'back', color: '#fff',
  related: [{ dir: '/root/docker', name: 'infra' }],
  infra: { repo: 'infra', path: 'compose', up: 'make up', down: 'make down' },
  envFiles: [{ repo: 'infra', path: '.env' }],
}

beforeEach(() => { vi.clearAllMocks(); saveConfig.mockResolvedValue({ ok: true }) })

describe('useProjectConfigDraft', () => {
  it('arranca con la config del proyecto', () => {
    const d = useProjectConfigDraft(ref(PROJECT))
    expect(d.related.value).toEqual(PROJECT.related)
    expect([d.infraRepo.value, d.infraPath.value, d.infraUp.value, d.infraDown.value]).toEqual(['infra', 'compose', 'make up', 'make down'])
    expect(d.envFiles.value).toEqual(PROJECT.envFiles)
    expect(d.repoOptions.value).toEqual(['self', 'infra'])
    expect(d.repoLabel('self')).toBe('este repo')
    expect(d.repoLabel('infra')).toBe('infra')
  })

  it('el borrador es una copia: editarlo no toca el proyecto', () => {
    const d = useProjectConfigDraft(ref(PROJECT))
    d.related.value[0].name = 'otro'
    expect(PROJECT.related![0].name).toBe('infra')
  })

  it('save() manda la config completa y marca configOk', async () => {
    const d = useProjectConfigDraft(ref(PROJECT))
    d.infraPath.value = 'docker'
    await d.save()
    expect(saveConfig).toHaveBeenCalledWith('/root/back', {
      related: PROJECT.related,
      infra: { repo: 'infra', path: 'docker', up: 'make up', down: 'make down' },
      envFiles: PROJECT.envFiles,
    })
    expect(d.configOk.value).toBe(true)
    expect(d.saving.value).toBe(false)
  })

  it('sin repo de infra manda infra: null', async () => {
    const d = useProjectConfigDraft(ref(PROJECT))
    d.infraRepo.value = ''
    await d.save()
    expect(saveConfig.mock.calls[0][1].infra).toBeNull()
  })

  it('si saveConfig falla deja configError', async () => {
    saveConfig.mockResolvedValue({ ok: false, error: 'config inválida' })
    const d = useProjectConfigDraft(ref(PROJECT))
    await d.save()
    expect(d.configError.value).toBe('config inválida')
    expect(d.configOk.value).toBe(false)
  })
})
