import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const book = ref<any>(null)
const load = vi.fn(async () => {
  book.value = {
    synopsis: 'Migrar el login',
    quests: [
      { id: 'a', title: 'Armar el form', status: 'completed', loose: false, dialogue: [], originPrompt: 'hacé el login' },
      { id: 'b', title: 'Validar', status: 'in_progress', loose: false, dialogue: [{ claude: 'Listo el form', you: 'dale', ts: 0 }] },
    ],
  }
})
vi.mock('../../composables/useQuestBook', () => ({ useQuestBook: () => ({ book, loading: ref(false), error: ref(''), load }) }))
import QuestTool from './QuestTool.vue'

describe('QuestTool', () => {
  it('carga el libro de la sesión y muestra sinopsis y progreso', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(load).toHaveBeenCalledWith('s1')
    expect(w.text()).toContain('Migrar el login')
    expect(w.get('[data-test="quest-progress"]').text()).toContain('1/2')
  })
  it('expandir una quest muestra el diálogo', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    await w.findAll('[data-test="quest-row"]')[1].trigger('click')
    expect(w.text()).toContain('Listo el form')
    expect(w.text()).toContain('dale')
  })
  it('las filas de quest tienen objetivo táctil ≥40px', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(w.findAll('[data-test="quest-row"]')[0].classes()).toContain('min-h-10')
  })
  it('no es un overlay', async () => {
    const w = mount(QuestTool, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})
