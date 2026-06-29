import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLongPress } from './longPress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createLongPress', () => {
  it('dispara con las coordenadas tras mantener apretado', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(10, 20)
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledWith(10, 20)
  })

  it('NO dispara si el dedo se mueve más que la tolerancia (es scroll)', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500, moveTol: 10 })
    lp.start(10, 20)
    lp.move(10, 40) // 20px > 10
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
  })

  it('dispara si el movimiento queda dentro de la tolerancia', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500, moveTol: 10 })
    lp.start(10, 20)
    lp.move(13, 22)
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('cancel() aborta el long-press', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(10, 20)
    lp.cancel()
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
  })

  it('no dispara antes de cumplir el tiempo', () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { ms: 500 })
    lp.start(0, 0)
    vi.advanceTimersByTime(499)
    expect(fire).not.toHaveBeenCalled()
  })
})
