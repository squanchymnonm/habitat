import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.resetModules() })

describe('useTheme', () => {
  it('default forja y aplica data-theme', async () => {
    const { useTheme, applyStoredTheme } = await import('./useTheme')
    applyStoredTheme()
    expect(useTheme().theme.value).toBe('forja')
    expect(document.documentElement.dataset.theme).toBe('forja')
  })
  it('setTheme persiste y aplica', async () => {
    const { useTheme } = await import('./useTheme')
    useTheme().setTheme('taberna')
    expect(localStorage.getItem('habitat.theme')).toBe('taberna')
    expect(document.documentElement.dataset.theme).toBe('taberna')
  })
  it('lee el guardado e ignora ids inválidos', async () => {
    localStorage.setItem('habitat.theme', 'pizarra')
    let m = await import('./useTheme'); m.applyStoredTheme()
    expect(m.useTheme().theme.value).toBe('pizarra')
    vi.resetModules(); localStorage.setItem('habitat.theme', 'nope')
    m = await import('./useTheme'); m.applyStoredTheme()
    expect(m.useTheme().theme.value).toBe('forja')
  })
  it('sobrevive a un localStorage que lanza', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const { useTheme, applyStoredTheme } = await import('./useTheme')
    expect(() => applyStoredTheme()).not.toThrow()
    expect(useTheme().theme.value).toBe('forja')
    spy.mockRestore()
  })
})
