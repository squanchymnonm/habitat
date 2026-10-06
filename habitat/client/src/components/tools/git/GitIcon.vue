<script setup lang="ts">
import { ICON_PATHS, type IconName } from '../../../composables/gitIcons'

// aria-hidden a propósito: el icono nunca es la etiqueta. Los botones que sólo
// tienen icono llevan su propio aria-label, que es lo que se anuncia.
const props = defineProps<{ name: IconName }>()
</script>

<template>
  <svg
    class="size-5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <!-- `dot` es un punto, no una línea: necesita trazo ancho y redondo. -->
    <path :d="ICON_PATHS[props.name]" :stroke-width="props.name === 'dot' ? 4 : 1.5" />
  </svg>
</template>
