import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GitCommits from './GitCommits.vue'
import type { GitStatus } from '../../../composables/useGit'

// Status mínimo: estos tests ejercitan sólo la vista "historial completo"
// (loadLog), la de props.status.commits no está en juego.
const statusBody: GitStatus = {
  working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  overview: { branch: 'main', default: 'origin/main', ahead: 0, behind: 0, files: [] },
  commits: [],
  repo: { rel: '', name: 'repo' },
}

// Fetch controlado a mano: cada llamada queda pendiente hasta que el test
// decide resolverla, para poder armar carreras deliberadas entre respuestas.
function stubControlledFetch() {
  const pending: { url: string; resolve: (v: unknown) => void }[] = []
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise((resolve) => {
    pending.push({ url, resolve })
  })))
  const resolveNext = (matchUrl: string, rows: unknown[]) => {
    const idx = pending.findIndex((p) => p.url.includes(matchUrl))
    if (idx === -1) throw new Error(`no hay fetch pendiente que matchee "${matchUrl}" (pendientes: ${pending.map((p) => p.url).join(', ')})`)
    const [p] = pending.splice(idx, 1)
    p.resolve({ ok: true, status: 200, json: async () => rows })
  }
  return { pending, resolveNext }
}

describe('GitCommits — historial completo: condiciones de carrera', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('no mezcla commits de dos repos cuando un fetch viejo llega después de cambiar de id/path', async () => {
    const { pending, resolveNext } = stubControlledFetch()
    const w = mount(GitCommits, { props: { status: statusBody, id: 's1', path: '' } })
    await flushPromises()

    // Activar "historial completo": dispara loadMore() para el repo s1.
    await w.find('[data-test="git-commit-toggle"]').trigger('click')
    await flushPromises()
    expect(pending.filter((p) => p.url.includes('/git/log')).length).toBe(1)

    // El usuario cambia de sesión/repo ANTES de que responda el fetch de s1.
    // El watch de [id, path] resetea el log y dispara un loadMore() nuevo para s2.
    await w.setProps({ id: 's2', path: 'otro' })
    await flushPromises()
    expect(pending.filter((p) => p.url.includes('/git/log')).length).toBe(2)

    // Llega primero la respuesta VIEJA (repo s1), después de que el contexto
    // ya cambió a s2.
    resolveNext('id=s1', [{ sha: 'aaa', shortSha: 'aaa', subject: 'commit de A', author: 'X', date: 'd1' }])
    await flushPromises()
    // Y recién ahora la respuesta del repo nuevo (s2).
    resolveNext('id=s2', [{ sha: 'bbb', shortSha: 'bbb', subject: 'commit de B', author: 'Y', date: 'd2' }])
    await flushPromises()

    expect(w.text()).toContain('commit de B')
    expect(w.text()).not.toContain('commit de A')
  })

  it('no reentra en loadMore() mientras hay una carga en curso (toggle rápido no duplica fetches)', async () => {
    const { pending, resolveNext } = stubControlledFetch()
    const w = mount(GitCommits, { props: { status: statusBody, id: 's1', path: '' } })
    await flushPromises()

    const toggle = () => w.find('[data-test="git-commit-toggle"]').trigger('click')

    // historial completo -> loadMore() #1 en vuelo (sin resolver todavía).
    await toggle()
    await flushPromises()
    // sólo mi rama -> historial completo otra vez, rápido, antes de que #1 responda.
    await toggle()
    await toggle()
    await flushPromises()

    const logCalls = pending.filter((p) => p.url.includes('/git/log'))
    expect(logCalls.length).toBe(1) // el guard de reentrancia bloqueó el segundo intento

    resolveNext('id=s1', [{ sha: 'xxx', shortSha: 'xxx', subject: 'commit único', author: 'X', date: 'd1' }])
    await flushPromises()

    const rows = w.findAll('[data-test="git-commit-row"]')
    expect(rows.length).toBe(1) // sin duplicados
  })
})
