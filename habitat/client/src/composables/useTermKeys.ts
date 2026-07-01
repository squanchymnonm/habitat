import { ref } from 'vue'

// Preferencia POR-DISPOSITIVO (localStorage) para mostrar el strip de teclas en
// pantalla. Patrón de useCompactPods. Guards `typeof` para importar en node (tests).
const KEY = 'habitat.termKeys'

// Valor inicial del toggle: si hay algo guardado ('1'/'0') gana; si no, usa la
// detección táctil (coarse) como default (ON en tablet/teléfono, OFF en desktop).
export function readInitialEnabled(stored: string | null, coarse: boolean): boolean {
  if (stored === '1') return true
  if (stored === '0') return false
  return coarse
}

function coarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
}

function storedValue(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
}

// Singleton a nivel de módulo: la vista de Settings y las terminales comparten el ref.
const enabled = ref(readInitialEnabled(storedValue(), coarsePointer()))

export function useTermKeys() {
  function toggle() {
    enabled.value = !enabled.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, enabled.value ? '1' : '0')
    }
  }
  return { enabled, toggle }
}
