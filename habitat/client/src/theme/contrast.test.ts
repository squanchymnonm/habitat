// @vitest-environment node
// (happy-dom reescribe import.meta.url con la location del entorno, así que
// `new URL('./tokens.css', import.meta.url)` deja de apuntar a un file:// real.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES, TOKENS } from './themes'
import { contrastRatio } from './contrast'

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

describe('temas', () => {
  it('contrastRatio: blanco/negro = 21', () => {
    expect(Math.round(contrastRatio('#ffffff', '#000000'))).toBe(21)
  })

  for (const t of THEMES) {
    describe(t.id, () => {
      const c = t.colors
      it('texto AA (4.5:1)', () => {
        expect(contrastRatio(c.text, c.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c.text, c['surface-raised'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['text-muted'], c.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['accent-foreground'], c.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['terminal-fg'], c['terminal-bg'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c.background, c.danger)).toBeGreaterThanOrEqual(4.5)
      })
      it('UI y estados (3:1 contra surface)', () => {
        for (const k of ['accent', 'state-working', 'state-waiting', 'state-done', 'state-error', 'mana'] as const) {
          expect(contrastRatio(c[k], c.surface), k).toBeGreaterThanOrEqual(3)
        }
      })
      it('tokens.css define los mismos valores', () => {
        const sel = t.id === 'forja' ? ":root, [data-theme='forja']" : `[data-theme='${t.id}']`
        const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
        for (const k of TOKENS) expect(block.toLowerCase(), k).toContain(`--${k}:${c[k].toLowerCase()}`)
      })
    })
  }
})
