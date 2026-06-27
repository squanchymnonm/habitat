import { ref } from 'vue'

// Estado global del modo compacto de los pods, persistido entre recargas.
// Guard `typeof localStorage` para que el módulo sea seguro de importar en
// entornos sin DOM (tests en node).
const KEY = 'habitat.compactPods'

function readInitial(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
}

const compact = ref(readInitial())

export function useCompactPods() {
  function toggleCompact() {
    compact.value = !compact.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, compact.value ? '1' : '0')
    }
  }
  return { compact, toggleCompact }
}
