import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const user = ref<string | null>('mnonm')
const logout = vi.fn()
vi.mock('../../composables/useAuth', () => ({ useAuth: () => ({ user, logout }) }))
import AccountSettings from './AccountSettings.vue'

describe('AccountSettings', () => {
  it('muestra el usuario actual y llama a logout al clickear Salir', async () => {
    user.value = 'mnonm'
    const w = mount(AccountSettings)
    expect(w.get('[data-test="account-user"]').text()).toBe('mnonm')
    await w.get('[data-test="logout"]').trigger('click')
    expect(logout).toHaveBeenCalled()
  })
  it('sin usuario (entró con token) muestra el mensaje', () => {
    user.value = null
    const w = mount(AccountSettings)
    expect(w.get('[data-test="account-user"]').text()).toBe('Entraste con token')
  })
})
