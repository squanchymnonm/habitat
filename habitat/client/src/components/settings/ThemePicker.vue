<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useTheme } from '../../composables/useTheme'
import { cn } from '@/lib/utils'

// Tarjetas de los temas con vista previa; elegir uno lo aplica en vivo.
const { theme, themes, setTheme } = useTheme()
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <button v-for="t in themes" :key="t.id" data-test="theme-card" type="button" :aria-pressed="theme === t.id ? 'true' : 'false'"
      :class="cn('flex min-h-10 cursor-pointer flex-col gap-2 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-3 text-left font-[inherit] text-text hover:bg-surface-raised',
        theme === t.id && 'ring-2 ring-accent')"
      @click="setTheme(t.id)">
      <!-- Vista previa: fondo, superficie y acento del tema (colores de datos del registro). -->
      <span class="flex h-12 overflow-hidden rounded-[var(--radius)] border border-border" aria-hidden="true">
        <i class="flex-[2]" :style="{ background: t.swatch[0] }" />
        <i class="flex-[2]" :style="{ background: t.swatch[1] }" />
        <i class="flex-1" :style="{ background: t.swatch[2] }" />
      </span>
      <span class="flex items-center justify-between gap-2 text-sm font-semibold">
        {{ t.name }}<Check v-if="theme === t.id" class="size-4 text-accent" />
      </span>
    </button>
  </div>
</template>
