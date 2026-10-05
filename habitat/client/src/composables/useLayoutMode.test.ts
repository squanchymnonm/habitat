import { describe, it, expect, beforeEach, vi } from 'vitest'
import { layoutModeFor } from './useLayoutMode'

describe('layoutModeFor', () => {
  it('phone si el lado menor < 600', () => {
    expect(layoutModeFor(400, 860)).toBe('phone')
    expect(layoutModeFor(860, 400)).toBe('phone')
  })
  it('landscape si ancho > alto y ancho >= 900', () => {
    expect(layoutModeFor(1440, 900)).toBe('landscape')
    expect(layoutModeFor(1180, 820)).toBe('landscape')
  })
  it('portrait en el resto', () => {
    expect(layoutModeFor(820, 1180)).toBe('portrait')
    expect(layoutModeFor(880, 700)).toBe('portrait')
  })
})

describe('useLayoutMode colapsado por modo', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  it('persiste por modo', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const { useLayoutMode } = await import('./useLayoutMode')
    const l = useLayoutMode()
    expect(l.mode.value).toBe('landscape')
    expect(l.collapsed.value).toBe(false)
    l.toggleCollapsed()
    expect(l.collapsed.value).toBe(true)
    expect(localStorage.getItem('habitat.nav.collapsed.landscape')).toBe('1')
    expect(localStorage.getItem('habitat.nav.collapsed.portrait')).toBeNull()
  })
})
