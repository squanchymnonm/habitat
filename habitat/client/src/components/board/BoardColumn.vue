<script setup lang="ts">
import BoardCard from './BoardCard.vue'
import type { BoardColumnData } from './boardColumns'
import { cn } from '@/lib/utils'

const props = defineProps<{ column: BoardColumnData }>()
// Clases literales para que Tailwind las detecte: color del contador por columna.
const DOT: Record<string, string> = { need: 'bg-state-waiting', working: 'bg-state-working', done: 'bg-state-done', quiet: 'bg-state-idle' }
</script>

<template>
  <section :data-test="`board-column-${column.id}`" :data-empty="column.sessions.length ? 'false' : 'true'"
    :class="cn('flex min-h-0 flex-col gap-2 rounded-[calc(var(--radius)+4px)] bg-background/40 p-2', !column.sessions.length && 'self-start')">
    <h2 class="m-0 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
      <i :class="cn('size-2 rounded-full', DOT[column.id])" />{{ column.title }}
      <span class="tabular-nums text-text">{{ props.column.sessions.length }}</span>
    </h2>
    <!-- Vacía: sólo el encabezado con el contador. -->
    <ul v-if="column.sessions.length" class="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto p-0">
      <li v-for="s in column.sessions" :key="s.id"><BoardCard :session="s" /></li>
    </ul>
  </section>
</template>
