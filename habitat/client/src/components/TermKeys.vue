<script setup lang="ts">
import { computed } from 'vue'
import type { SpecialKey } from '../composables/useTerminal'
import { cn } from '@/lib/utils'

const emit = defineEmits<{ (e: 'press', key: SpecialKey): void }>()

// `dense`: variante chica para cuando la fila vive dentro de una barra de
// herramientas (la barra de la terminal, el header del editor) en vez de
// ocupar su propio renglón.
const props = withDefaults(defineProps<{ dense?: boolean }>(), { dense: false })

const btnClass = computed(() => cn(
  'cursor-pointer select-none rounded-[var(--radius)] border border-border bg-surface-raised font-mono text-text hover:text-accent',
  props.dense ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
))

// Fila de teclas que Android no tiene: flechas + Enter/Esc/Tab.
const KEYS: { key: SpecialKey; label: string; title: string }[] = [
  { key: 'up', label: '↑', title: 'Flecha arriba' },
  { key: 'down', label: '↓', title: 'Flecha abajo' },
  { key: 'left', label: '←', title: 'Flecha izquierda' },
  { key: 'right', label: '→', title: 'Flecha derecha' },
  { key: 'enter', label: '⏎', title: 'Enter' },
  { key: 'esc', label: 'Esc', title: 'Escape' },
  { key: 'tab', label: 'Tab', title: 'Tab' },
]
</script>

<template>
  <div class="termkeys flex items-center gap-1" :class="{ dense }">
    <button
      v-for="k in KEYS"
      :key="k.key"
      type="button"
      :class="btnClass"
      :title="k.title"
      @pointerdown.prevent
      @click="emit('press', k.key)"
    >{{ k.label }}</button>
  </div>
</template>
