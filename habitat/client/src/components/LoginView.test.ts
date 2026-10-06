import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const login = vi.fn(async () => false)
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ login }) }))
import LoginView from './LoginView.vue'

beforeEach(() => login.mockReset())

describe('LoginView', () => {
  it('manda usuario y contraseña y muestra el error si fallan', async () => {
    login.mockResolvedValueOnce(false)
    const w = mount(LoginView)
    await w.get('input[autocomplete="username"]').setValue('mnonm')
    await w.get('input[type="password"]').setValue('x')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('mnonm', 'x')
    expect(w.text()).toContain('Usuario o contraseña incorrectos.')
  })
  it('sin conexión avisa', async () => {
    login.mockRejectedValueOnce(new Error('net'))
    const w = mount(LoginView)
    await w.get('form').trigger('submit'); await flushPromises()
    expect(w.text()).toContain('No se pudo conectar.')
  })
  it('labels visibles y controles táctiles sin estilo nativo', () => {
    const w = mount(LoginView)
    expect(w.findAll('label').map((l) => l.text())).toEqual(['Usuario', 'Contraseña'])
    expect(w.get('button[type="submit"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border-0', 'bg-accent', 'cursor-pointer']))
    expect(w.get('input[type="password"]').classes()).toEqual(expect.arrayContaining(['min-h-10', 'border', 'border-border']))
  })
})
