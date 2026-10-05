import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import InfraBlock from './InfraBlock.vue'

afterEach(() => { vi.unstubAllGlobals() })
const resp = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
const session = (state?: string) => ({
  id: 's1', name: 'bob', project: 'back', branch: 'bob', status: 'idle', action: '', since: 0, stamina: 100,
  infra: { stack: 'back-bob', ports: { app: 20003, db: 20004 }, dir: '/wt/infra', branch: 'bob', state },
}) as any

describe('InfraBlock', () => {
  it('muestra estado, stack y puertos como links al host actual', () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({})))
    const w = mount(InfraBlock, { props: { session: session('partial') } })
    expect(w.text()).toContain('back-bob')
    expect(w.get('[data-test="infra-state"]').text()).toBe('parcial')
    const links = w.findAll('a')
    expect(links.map((a) => a.text())).toEqual(['app :20003', 'db :20004'])
    expect(links[0].attributes('href')).toBe(`http://${location.hostname}:20003`)
    expect(links[0].attributes('target')).toBe('_blank')
  })

  it('sin estado muestra apagado; levantar llama al endpoint y muestra el error', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp({ ok: false, message: 'port is already allocated' }) }))
    const w = mount(InfraBlock, { props: { session: session() } })
    expect(w.get('[data-test="infra-state"]').text()).toBe('apagado')
    await w.get('[data-test="infra-up"]').trigger('click')
    await flushPromises()
    expect(urls).toContain('/infra/up?id=s1')
    expect(w.text()).toContain('port is already allocated')
  })

  it('bajar llama a /docker/down', async () => {
    const calls: { url: string; body?: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: any) => { calls.push({ url: u, body: i?.body && JSON.parse(i.body) }); return resp({ stacks: ['x'] }) }))
    const w = mount(InfraBlock, { props: { session: session('up') } })
    await w.get('[data-test="infra-down"]').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.url === '/docker/down')?.body).toEqual({ id: 's1' })
  })

  it('bajar con 409 muestra que hay una operación en curso', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/docker/down' ? resp({}, 409) : resp({}))))
    const w = mount(InfraBlock, { props: { session: session('up') } })
    await w.get('[data-test="infra-down"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('ocupado: hay una operación de infra en curso')
  })
})
