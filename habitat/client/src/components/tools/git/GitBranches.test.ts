import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import GitBranches from './GitBranches.vue'

// La fila de una remota es el <li> que muestra el nombre completo ('origin/x') y
// tiene botón: las locales se listan por nombre corto y sin botón.
const remoteRowButton = (w: VueWrapper, name: string) => {
  const li = w.findAll('li').filter((el) => el.text().includes(name) && el.find('button').exists())
  expect(li.length).toBe(1)
  return li[0].find('button')
}

const branchesBody = {
  current: 'main',
  default: 'origin/main',
  local: [{ name: 'main', worktree: '', current: true }],
  remote: ['origin/main', 'origin/shepard', 'origin/feature/x'],
}

describe('GitBranches — filas remotas', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => branchesBody })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  // El botón emitía branch-create con from:'HEAD': la rama creada salía del HEAD
  // local (sin el trabajo de la remota ni upstream) y, como groupBranches esconde
  // las remotas que ya tienen local homónima, la remota real desaparecía de la UI
  // dejando al usuario sin camino a ella. `git switch <short>` la DWIMea bien.
  it('emite checkout (no branch-create/HEAD) con el nombre corto de la remota', async () => {
    const w = mount(GitBranches, { props: { id: 's1', path: '' } })
    await flushPromises()

    await remoteRowButton(w, 'origin/shepard').trigger('click')

    expect(w.emitted('run')).toEqual([['checkout', { branch: 'shepard' }]])
  })

  it('el nombre corto conserva las barras de la rama remota', async () => {
    const w = mount(GitBranches, { props: { id: 's1', path: '' } })
    await flushPromises()

    await remoteRowButton(w, 'origin/feature/x').trigger('click')

    expect(w.emitted('run')).toEqual([['checkout', { branch: 'feature/x' }]])
  })
})

describe('GitBranches — red caída', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('no queda en "cargando ramas…" para siempre si el fetch rechaza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const w = mount(GitBranches, { props: { id: 's1', path: '' } })
    await flushPromises()
    expect(w.text()).not.toContain('cargando ramas')
    expect(w.text()).toContain('no se pudieron cargar las ramas')
  })
})
