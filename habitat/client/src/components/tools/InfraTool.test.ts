import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import InfraTool from './InfraTool.vue'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const session = (state?: string) => ({
  id: 's1', name: 'bob', project: 'back', branch: 'bob', status: 'idle', action: '', since: 0, stamina: 100,
  infra: { stack: 'back-bob', ports: { app: 20003, db: 20004 }, dir: '/wt/infra', branch: 'bob', state },
}) as any

// Baja ahora pasa por el ConfirmDialog (portaleado a document.body) en vez de window.confirm.
async function confirmDown(w: VueWrapper<any>) {
  await w.get('[data-test="infra-down"]').trigger('click')
  await flushPromises()
  ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
  await flushPromises()
}

describe('InfraTool', () => {
  it('muestra estado, stack y puertos como links al host actual, sin subrayado', () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({})))
    const w = mount(InfraTool, { props: { session: session('partial') } })
    expect(w.text()).toContain('back-bob')
    expect(w.get('[data-test="infra-state"]').text()).toBe('parcial')
    const links = w.findAll('a')
    expect(links.map((a) => a.text())).toEqual(['app :20003', 'db :20004'])
    expect(links[0].attributes('href')).toBe(`http://${location.hostname}:20003`)
    expect(links[0].attributes('target')).toBe('_blank')
    expect(links[0].classes()).toContain('no-underline')
    // Objetivo táctil ≥40px (spec §5) en links de puertos y botones.
    expect(links[0].classes()).toContain('min-h-10')
    expect(w.get('[data-test="infra-up"]').classes()).toContain('min-h-10')
  })

  it('sin estado muestra apagado; levantar llama al endpoint y muestra el error', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp({ ok: false, message: 'port is already allocated' }) }))
    const w = mount(InfraTool, { props: { session: session() } })
    expect(w.get('[data-test="infra-state"]').text()).toBe('apagado')
    await w.get('[data-test="infra-up"]').trigger('click')
    await flushPromises()
    expect(urls).toContain('/infra/up?id=s1')
    expect(w.text()).toContain('port is already allocated')
  })

  it('bajar pide confirmación y, al aceptarla, llama a /docker/down', async () => {
    const calls: { url: string; body?: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: any) => { calls.push({ url: u, body: i?.body && JSON.parse(i.body) }); return resp({ stacks: ['x'] }) }))
    const w = mount(InfraTool, { props: { session: session('up') }, attachTo: document.body })
    await confirmDown(w)
    expect(calls.find((c) => c.url === '/docker/down')?.body).toEqual({ id: 's1' })
    w.unmount()
  })

  it('bajar con 409 muestra que hay una operación en curso', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/docker/down' ? resp({}, 409) : resp({}))))
    const w = mount(InfraTool, { props: { session: session('up') }, attachTo: document.body })
    await confirmDown(w)
    expect(w.text()).toContain('ocupado: hay una operación de infra en curso')
    w.unmount()
  })
})
