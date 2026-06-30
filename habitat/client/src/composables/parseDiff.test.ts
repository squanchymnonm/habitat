import { describe, it, expect } from 'vitest'
import { parseDiff } from './parseDiff'

describe('parseDiff', () => {
  it('parsea hunks con add/del/ctx y numera líneas', () => {
    const patch = [
      'diff --git a/x.js b/x.js',
      'index 111..222 100644',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -1,3 +1,3 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      ' const c = 4',
    ].join('\n')
    const hunks = parseDiff(patch)
    expect(hunks.length).toBe(1)
    const types = hunks[0].lines.map((l) => l.type)
    expect(types).toEqual(['ctx', 'del', 'add', 'ctx'])
    expect(hunks[0].lines[0]).toMatchObject({ oldNo: 1, newNo: 1, text: 'const a = 1' })
    expect(hunks[0].lines[1]).toMatchObject({ type: 'del', oldNo: 2, newNo: null })
    expect(hunks[0].lines[2]).toMatchObject({ type: 'add', oldNo: null, newNo: 2 })
  })

  it('devuelve [] para patch vacío', () => {
    expect(parseDiff('')).toEqual([])
  })
})
