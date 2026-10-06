import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const permissionMode = ref('acceptEdits')
const save = vi.fn(async () => true)
vi.mock('../../composables/useSettings', () => ({ useSettings: () => ({ permissionMode, error: ref(''), saving: ref(false), save }) }))
import GeneralSettings from './GeneralSettings.vue'

describe('GeneralSettings', () => {
  it('muestra el modo actual con su descripción y guarda al cambiar', async () => {
    const w = mount(GeneralSettings)
    const sel = w.get('[data-test="pmode"]')
    expect((sel.element as HTMLSelectElement).value).toBe('acceptEdits')
    expect(w.text()).toContain('Auto-aprueba ediciones')
    await sel.setValue('plan')
    expect(save).toHaveBeenCalledWith('plan')
  })
  it('select táctil y estilado', () => {
    expect(mount(GeneralSettings).get('[data-test="pmode"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border', 'border-border', 'font-[inherit]']))
  })
})
