import { describe, it, expect } from 'vitest'
import { manaFromUsage, fmtReset, setUsage, useUsage } from './useUsage'

describe('useUsage helpers', () => {
  it('manaFromUsage = 100 - pct, clamp, null', () => {
    expect(manaFromUsage({ pct: 63, resetAt: 0 })).toBe(37)
    expect(manaFromUsage({ pct: 150, resetAt: 0 })).toBe(0)
    expect(manaFromUsage(null)).toBe(null)
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
