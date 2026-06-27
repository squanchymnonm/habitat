import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCompactPods } from './useCompactPods'

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('useCompactPods', () => {
  it('toggleCompact invierte el estado y lo persiste en localStorage', () => {
    const store = memStorage()
    vi.stubGlobal('localStorage', store)
    const { compact, toggleCompact } = useCompactPods()
    const start = compact.value
    toggleCompact()
    expect(compact.value).toBe(!start)
    expect(store.getItem('habitat.compactPods')).toBe(compact.value ? '1' : '0')
    toggleCompact()
    expect(compact.value).toBe(start)
    expect(store.getItem('habitat.compactPods')).toBe(compact.value ? '1' : '0')
  })
})
