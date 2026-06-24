import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { questIcon } from './questIcons'
import { useQuestBook } from './useQuestBook'

describe('questIcon', () => {
  it('completed -> quest-done', () => { expect(questIcon('completed')).toBe('assets/ui/quest-done.png') })
  it('pending -> quest-pending', () => { expect(questIcon('pending')).toBe('assets/ui/quest-pending.png') })
  it('in_progress -> quest-pending', () => { expect(questIcon('in_progress')).toBe('assets/ui/quest-pending.png') })
})

describe('useQuestBook', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '' })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('carga el libro en éxito y pide la URL con id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ synopsis: 'x', quests: [], events: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const qb = useQuestBook()
    await qb.load('s1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/questbook?id=s1')
    expect(qb.book.value?.synopsis).toBe('x')
    expect(qb.loading.value).toBe(false)
    expect(qb.error.value).toBe('')
  })

  it('setea error en respuesta no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    const qb = useQuestBook()
    await qb.load('s1')
    expect(qb.error.value).toContain('404')
    expect(qb.book.value).toBeNull()
  })
})
