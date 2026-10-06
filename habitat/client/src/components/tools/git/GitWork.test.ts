import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GitWork from './GitWork.vue'
import type { GitStatus } from '../../../composables/useGit'

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  overview: { branch: 'feature-x', default: 'origin/main', ahead: 0, behind: 0, files: [] },
  commits: [],
  repo: { rel: '', name: 'repo' },
  ...over,
})

const amendBtn = (w: ReturnType<typeof mount>) =>
  w.findAll('[data-test="git-commit-actions"]').find((b) => b.text() === 'amend')!

// El aviso de amend estaba invertido: status.commits son los commits en
// default..HEAD, así que con la lista vacía `last` era undefined y no se avisaba
// nada — y ése es precisamente el caso en que HEAD está garantizado publicado.
describe('GitWork — aviso de amend', () => {
  it('avisa cuando NO hay commits por delante del default (HEAD publicado)', async () => {
    const w = mount(GitWork, { props: { status: status({ commits: [] }), stash: [] } })
    await amendBtn(w).trigger('click')
    const [name, , warn] = w.emitted('run')![0] as [string, unknown, string | undefined]
    expect(name).toBe('amend')
    expect(warn).toBeTypeOf('string')
    expect(warn).toMatch(/reescribe historia/)
  })

  it('avisa cuando el último commit ya está pusheado', async () => {
    const commits = [{ sha: 'a', shortSha: 'a', subject: 's', pushed: true, files: [] }]
    const w = mount(GitWork, { props: { status: status({ commits }), stash: [] } })
    await amendBtn(w).trigger('click')
    const warn = (w.emitted('run')![0] as unknown[])[2]
    expect(warn).toBeTypeOf('string')
  })

  it('NO avisa cuando el último commit es local y sin pushear (el caso seguro)', async () => {
    const commits = [{ sha: 'a', shortSha: 'a', subject: 's', pushed: false, files: [] }]
    const w = mount(GitWork, { props: { status: status({ commits }), stash: [] } })
    await amendBtn(w).trigger('click')
    const warn = (w.emitted('run')![0] as unknown[])[2]
    expect(warn).toBeUndefined()
  })

  it('deshabilita amend si el repo no tiene ningún commit (HEAD unborn: overview.branch vacío)', () => {
    const w = mount(GitWork, {
      props: { status: status({ overview: { ...status().overview, branch: '' } }), stash: [] },
    })
    expect(amendBtn(w).attributes('disabled')).toBeDefined()
  })
})
