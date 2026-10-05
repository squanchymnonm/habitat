import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GitTool from './GitTool.vue'
import GitBranches from './GitBranches.vue'

// Respuestas mínimas para que el panel llegue a mostrar contenido sin
// depender del server real.
const statusBody = {
  working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  overview: { branch: 'main', default: 'origin/main', ahead: 0, behind: 0, files: [] },
  commits: [],
  repo: { rel: '', name: 'repo' },
}
const branchesBody = {
  current: 'main',
  default: 'origin/main',
  local: [{ name: 'main', worktree: '', current: true }, { name: 'feature-x', worktree: '', current: false }],
  remote: [],
}

// Stub de fetch que responde según el endpoint pedido. El checkout SIEMPRE
// falla por árbol sucio (dirty:true), que es lo que dispara "retry".
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (url.includes('/git/status')) return { ok: true, status: 200, json: async () => statusBody }
    if (url.includes('/git/stash')) return { ok: true, status: 200, json: async () => [] }
    if (url.includes('/git/branches')) return { ok: true, status: 200, json: async () => branchesBody }
    if (url.includes('/git/action')) {
      const body = JSON.parse(init.body)
      if (body.action === 'checkout') {
        return { ok: true, status: 200, json: async () => ({ ok: false, dirty: true, message: 'árbol sucio' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
}

describe('GitTool — retry de checkout sucio', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('un checkout que falla por árbol sucio muestra "Stashear y reintentar", y el refresh() interno de run() no lo borra', async () => {
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    // Vamos a la pestaña Branches: es la que emite 'checkout'.
    const tabs = w.findAll('[data-test="git-tab"]')
    const branchesTab = tabs.find((b) => b.text().includes('Ramas'))
    await branchesTab!.trigger('click')
    await flushPromises()

    // Simulamos lo mismo que produciría un click en una rama: GitBranches emite
    // 'run' con el checkout, que index.js/GitTool.run() procesa.
    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()

    expect(w.text()).toContain('Stashear y reintentar')
    expect(w.text()).toContain('árbol sucio')
  })

  it('cambiar de path limpia "retry" y el error viejo (no queda apuntando a un repo/rama que ya no es el activo)', async () => {
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    const tabs = w.findAll('[data-test="git-tab"]')
    const branchesTab = tabs.find((b) => b.text().includes('Ramas'))
    await branchesTab!.trigger('click')
    await flushPromises()

    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()
    expect(w.text()).toContain('Stashear y reintentar') // precondición: quedó pendiente

    // El usuario navega a otro path sin tocar el botón de recuperación.
    await w.setProps({ path: 'otro/repo' })
    await flushPromises()

    expect(w.text()).not.toContain('Stashear y reintentar')
    expect(w.text()).not.toContain('árbol sucio')
  })

  it('cambiar de sesión (id) también limpia "retry"', async () => {
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    const tabs = w.findAll('[data-test="git-tab"]')
    const branchesTab = tabs.find((b) => b.text().includes('Ramas'))
    await branchesTab!.trigger('click')
    await flushPromises()

    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()
    expect(w.text()).toContain('Stashear y reintentar')

    await w.setProps({ sessionId: 's2' })
    await flushPromises()

    expect(w.text()).not.toContain('Stashear y reintentar')
  })
})

describe('GitTool — el stash del retry pasa por run()', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { vi.unstubAllGlobals() })

  // Llamar action() directo salteaba todo lo que aporta run(): el `busy` que evita el
  // doble click y el limpiado del actionErr del checkout anterior (que quedaba visible
  // como si el stash hubiera fallado). El rastro observable de haber pasado por run()
  // es el refresh que hace al terminar, antes de encadenar el checkout.
  it('el stash refresca el estado antes de reintentar el checkout (rastro de run())', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url.includes('/git/action')) {
        const body = JSON.parse(init.body)
        calls.push(`action:${body.action}`)
        if (body.action === 'checkout') {
          return { ok: true, status: 200, json: async () => ({ ok: false, dirty: true, message: 'árbol sucio' }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.includes('/git/status')) { calls.push('status'); return { ok: true, status: 200, json: async () => statusBody } }
      if (url.includes('/git/stash')) { calls.push('stash'); return { ok: true, status: 200, json: async () => [] } }
      if (url.includes('/git/branches')) { calls.push('branches'); return { ok: true, status: 200, json: async () => branchesBody } }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()
    await w.findAll('[data-test="git-tab"]').find((b) => b.text().includes('Ramas'))!.trigger('click')
    await flushPromises()

    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()
    expect(w.text()).toContain('Stashear y reintentar') // precondición

    calls.length = 0
    await w.findAll('[data-test="git-btn"]').find((b) => b.text() === 'Stashear y reintentar')!.trigger('click')
    await flushPromises()

    const iStash = calls.indexOf('action:stash-push')
    const iCheckout = calls.indexOf('action:checkout')
    expect(iStash).toBeGreaterThanOrEqual(0)
    expect(iCheckout).toBeGreaterThan(iStash)
    const iRefresh = calls.findIndex((c, k) => k > iStash && c === 'status')
    expect(iRefresh).toBeGreaterThan(iStash)
    expect(iRefresh).toBeLessThan(iCheckout)
  })
})

describe('GitTool — diagnóstico del 409', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { vi.unstubAllGlobals() })

  // Sesión arrancada en un subdirectorio del repo: no hay acceso (s.cwd es el límite
  // del sandbox), pero el panel decía "sin repo git acá" cuando SÍ había repo.
  it('con reason repo-arriba dice que el repo está por encima del directorio de la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/git/status')) {
        return { ok: false, status: 409, json: async () => ({ reason: 'repo-arriba' }) }
      }
      return { ok: true, status: 200, json: async () => [] }
    }))
    const w = mount(GitTool, { props: { sessionId: 's1', path: 'sub' } })
    await flushPromises()
    expect(w.text()).toContain('por encima del directorio de la sesión')
    expect(w.text()).not.toContain('sin repo git acá')
  })

  it('con reason sin-repo sigue diciendo "sin repo git acá"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/git/status')) {
        return { ok: false, status: 409, json: async () => ({ reason: 'sin-repo' }) }
      }
      return { ok: true, status: 200, json: async () => [] }
    }))
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()
    expect(w.text()).toContain('sin repo git acá')
  })
})

// Rama distinta del default: a diferencia de statusBody (branch === default,
// que deja el botón PR deshabilitado), acá el botón queda habilitado para
// poder disparar 'pr-create' desde el test.
const statusBodyOffDefault = {
  ...statusBody,
  overview: { ...statusBody.overview, branch: 'feature-x' },
}

function stubFetchWithPr() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (url.includes('/git/status')) return { ok: true, status: 200, json: async () => statusBodyOffDefault }
    if (url.includes('/git/stash')) return { ok: true, status: 200, json: async () => [] }
    if (url.includes('/git/branches')) return { ok: true, status: 200, json: async () => branchesBody }
    if (url.includes('/git/action')) {
      const body = JSON.parse(init.body)
      if (body.action === 'pr-create') {
        return { ok: true, status: 200, json: async () => ({ ok: true, url: 'https://github.com/x/y/pull/42' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
}

describe('GitTool — prUrl no se filtra entre repos', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetchWithPr()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('cambiar de path limpia el link del PR creado en el repo anterior', async () => {
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    const prButton = w.findAll('[data-test="git-btn"]').find((b) => b.text() === 'PR')
    await prButton!.trigger('click')
    await flushPromises()

    expect(w.html()).toContain('pull/42') // precondición: el link quedó visible

    await w.setProps({ path: 'otro/repo' })
    await flushPromises()

    expect(w.html()).not.toContain('pull/42')
  })
})

describe('GitTool — estilo con tokens', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('los botones de la barra de acciones no usan borde nativo y son clickeables', async () => {
    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    const actionButtons = w.findAll('footer [data-test="git-btn"]')
    expect(actionButtons.length).toBeGreaterThan(0)
    for (const b of actionButtons) {
      expect(b.classes()).toContain('border-0')
      expect(b.classes()).toContain('cursor-pointer')
    }
  })

  it('el diff se abre dentro de la herramienta: el contenedor queda posicionado "absolute", no como overlay aparte', async () => {
    const withFile = {
      ...statusBody,
      working: { ...statusBody.working, staged: [{ rel: 'a.txt', status: 'M' }] },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/git/status')) return { ok: true, status: 200, json: async () => withFile }
      if (url.includes('/git/stash')) return { ok: true, status: 200, json: async () => [] }
      if (url.includes('/git/diff')) return { ok: true, status: 200, json: async () => ({ binary: false, patch: '' }) }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    const w = mount(GitTool, { props: { sessionId: 's1', path: '' } })
    await flushPromises()

    await w.find('a').trigger('click') // el nombre del archivo staged emite 'diff'
    await flushPromises()

    const panel = w.find('[role="dialog"]')
    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('absolute')
  })
})
