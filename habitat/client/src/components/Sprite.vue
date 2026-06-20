<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

// mode:
//  - 'static': strip horizontal de direcciones (ej. Idle.png 4 dirs). Muestra `frame` fijo.
//  - 'grid':   hoja 4x4 (monstruo). Columna = dirección (`dir`), animación por filas (Y).
//  - 'strip':  strip horizontal animado (boss). frames = ancho/alto.
const props = withDefaults(
  defineProps<{
    src: string
    height: number
    mode: 'static' | 'grid' | 'strip'
    frame?: number
    dir?: number
    duration?: number
  }>(),
  { frame: 0, dir: 0, duration: 900 },
)

const el = ref<HTMLDivElement | null>(null)
let anim: Animation | null = null

function apply() {
  const node = el.value
  if (!node || !props.src) return
  node.style.backgroundImage = `url(${props.src})`
  const img = new Image()
  img.onload = () => {
    const n = el.value
    if (!n) return
    const nW = img.naturalWidth
    const nH = img.naturalHeight
    if (anim) {
      anim.cancel()
      anim = null
    }
    if (props.mode === 'grid') {
      const frameH = nH / 4
      const scale = props.height / frameH
      const frameW = (nW / 4) * scale
      n.style.width = frameW + 'px'
      n.style.backgroundSize = `${nW * scale}px ${nH * scale}px`
      n.style.backgroundPositionX = `${-(props.dir * frameW)}px`
      anim = n.animate(
        [{ backgroundPositionY: '0px' }, { backgroundPositionY: `${-(props.height * 4)}px` }],
        { duration: props.duration, iterations: Infinity, easing: 'steps(4)' },
      )
    } else {
      const frames = Math.max(1, Math.round(nW / nH))
      const scale = props.height / nH
      const frameW = nH * scale
      n.style.width = frameW + 'px'
      n.style.backgroundSize = `${nW * scale}px ${nH * scale}px`
      n.style.backgroundPositionY = '0px'
      if (props.mode === 'strip' && frames > 1) {
        anim = n.animate(
          [{ backgroundPositionX: '0px' }, { backgroundPositionX: `${-(frameW * frames)}px` }],
          { duration: props.duration, iterations: Infinity, easing: `steps(${frames})` },
        )
      } else {
        n.style.backgroundPositionX = `${-(Math.min(props.frame, frames - 1) * frameW)}px`
      }
    }
  }
  img.src = props.src
}

onMounted(apply)
watch(() => [props.src, props.height, props.mode, props.frame, props.dir], apply, { flush: 'post' })
onBeforeUnmount(() => {
  if (anim) anim.cancel()
})
</script>

<template>
  <div ref="el" class="sprite" :style="{ height: height + 'px' }"></div>
</template>

<style scoped>
.sprite {
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
</style>
