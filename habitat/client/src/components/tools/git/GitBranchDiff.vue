<script setup lang="ts">
import type { GitStatus, DiffBase } from '../../../composables/useGit'
const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()

// Color de la letra de estado (M/A/D/?…) por token semántico, no por valor fijo.
const ST_COLOR: Record<string, string> = { M: 'text-state-working', A: 'text-state-done', D: 'text-danger' }
function stColor(status: string) { return ST_COLOR[status] ?? 'text-muted' }
</script>

<template>
  <ul class="m-0 list-none divide-y divide-border p-0">
    <li
      v-for="f in props.status.overview.files"
      :key="f.rel"
      class="flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-base"
    >
      <span class="w-4 text-center font-mono text-xs" :class="stColor(f.status)">{{ f.status }}</span>
      <a
        class="min-w-0 flex-1 cursor-pointer font-mono text-sm text-text underline decoration-dotted underline-offset-[3px] hover:text-accent [overflow-wrap:anywhere]"
        @click="emit('diff', f.rel, 'branch')"
      >{{ f.rel }}</a>
    </li>
    <li v-if="!props.status.overview.files.length" class="text-sm text-muted">
      sin diferencias con {{ props.status.overview.default }}
    </li>
  </ul>
</template>
