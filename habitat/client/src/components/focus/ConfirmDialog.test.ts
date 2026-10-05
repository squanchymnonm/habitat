import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('confirmar emite confirm y cierra', async () => {
    const w = mount(ConfirmDialog, {
      props: { open: true, title: '¿Cerrar?', description: 'Se pierde', confirmLabel: 'Cerrar', danger: true },
      attachTo: document.body,
    })
    await flushPromises()
    const btn = document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Cerrar')
    expect(btn.className).toContain('bg-danger')
    btn.click()
    await flushPromises()
    expect(w.emitted('confirm')).toHaveLength(1)
    const updateOpenCalls = w.emitted('update:open')
    expect(updateOpenCalls?.[updateOpenCalls.length - 1]).toEqual([false])
    w.unmount()
  })
})
