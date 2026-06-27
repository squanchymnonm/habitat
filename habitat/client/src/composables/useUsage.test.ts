import { describe, it, expect } from 'vitest'
import { manaFromUsage, cyclePosFrom, fmtReset, WINDOW_MS, setUsage, useUsage } from './useUsage'

describe('useUsage helpers', () => {
  it('manaFromUsage = 100 - pct, clamp, null', () => {
    expect(manaFromUsage({ pct: 63, resetAt: 0 })).toBe(37)
    expect(manaFromUsage({ pct: 150, resetAt: 0 })).toBe(0)
    expect(manaFromUsage(null)).toBe(null)
  })
  it('cyclePosFrom: 0 recién renovado, 1 por renovar, 0.5 mitad', () => {
    const now = 1_000_000_000_000
    expect(cyclePosFrom(null, now)).toBe(null)
    expect(cyclePosFrom({ pct: 0, resetAt: (now + WINDOW_MS) / 1000 }, now)).toBeCloseTo(0)
    expect(cyclePosFrom({ pct: 0, resetAt: now / 1000 }, now)).toBeCloseTo(1)
    expect(cyclePosFrom({ pct: 0, resetAt: (now + WINDOW_MS / 2) / 1000 }, now)).toBeCloseTo(0.5)
  })
  it('fmtReset formatea', () => {
    expect(fmtReset(2 * 3600000 + 14 * 60000)).toBe('2h 14m')
    expect(fmtReset(14 * 60000)).toBe('14m')
    expect(fmtReset(null)).toBe('')
  })
  it('setUsage actualiza el ref compartido', () => {
    setUsage({ pct: 20, resetAt: 5 })
    expect(useUsage().usage.value).toEqual({ pct: 20, resetAt: 5 })
    setUsage(null)
    expect(useUsage().usage.value).toBe(null)
  })
})
