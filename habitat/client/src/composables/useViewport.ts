import { ref, onMounted, onUnmounted } from 'vue'

// Narrow (el detalle pasa a overlay y el rail muestra solo pods) cuando es un
// teléfono: ancho U alto menor a 600px. Las tablets —incluso en portrait— tienen
// ambas dimensiones >= 600 y usan el layout desktop (rail + panel lado a lado).
export function isNarrowViewport(width: number, height: number, limit = 600): boolean {
  return width < limit || height < limit
}

export function useViewport() {
  const isNarrow = ref(false)
  const update = () => { isNarrow.value = isNarrowViewport(window.innerWidth, window.innerHeight) }
  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })
  onUnmounted(() => window.removeEventListener('resize', update))
  return { isNarrow }
}
