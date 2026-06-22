import { ref, onMounted, onUnmounted } from 'vue'

// `isNarrow` = true bajo ~900px. Ahí el detalle pasa a overlay en vez de embebido.
export function useViewport(query = '(max-width: 899px)') {
  const isNarrow = ref(false)
  let mq: MediaQueryList | null = null
  const update = () => { if (mq) isNarrow.value = mq.matches }
  onMounted(() => {
    mq = window.matchMedia(query)
    update()
    mq.addEventListener('change', update)
  })
  onUnmounted(() => mq?.removeEventListener('change', update))
  return { isNarrow }
}
