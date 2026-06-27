<script setup lang="ts">
import Sprite from './Sprite.vue'

withDefaults(defineProps<{
  src: string
  height: number
  mode: 'static' | 'grid' | 'strip'
  frame?: number
  dir?: number
  duration?: number
  contact?: boolean
}>(), { contact: true })
</script>

<template>
  <span class="gsprite">
    <Sprite
      class="gbase"
      :src="src"
      :height="height"
      :mode="mode"
      :frame="frame"
      :dir="dir"
      :duration="duration"
    />
    <span v-if="contact" class="gcontact" aria-hidden="true"></span>
  </span>
</template>

<style scoped>
.gsprite { position: relative; display: inline-block; line-height: 0; }
/* grade cálido (comparte paleta con la forja) + sombra de apoyo dura + glow de antorcha.
   Se aplica por filtro para ser animation-safe sobre el background-cropping de Sprite. */
.gbase {
  filter:
    saturate(0.82) brightness(0.96) sepia(0.2) hue-rotate(-8deg) contrast(1.04)
    drop-shadow(0 2px 0 rgba(0, 0, 0, 0.5))
    drop-shadow(0 0 5px rgba(232, 140, 70, 0.4));
}
/* sombra de contacto: apoya el sprite en el piso (lo que más quita el efecto "pegado") */
.gcontact {
  position: absolute; left: 50%; bottom: -3px; width: 84%; height: 8px; transform: translateX(-50%);
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0 42%, rgba(0,0,0,0.25) 58%, transparent 72%);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) { .gbase { filter: saturate(0.82) brightness(0.96) sepia(0.2) hue-rotate(-8deg) contrast(1.04) drop-shadow(0 2px 0 rgba(0,0,0,0.5)); } }
</style>
