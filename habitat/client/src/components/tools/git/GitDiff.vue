<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { DiffHunk } from '../../../composables/parseDiff'
import GitIcon from './GitIcon.vue'

defineProps<{ file: string; hunks: DiffHunk[]; binary: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const box = ref<HTMLElement | null>(null)

// Escape cierra el diff, no la herramienta entera. Va en captura y detiene la
// propagación para ganarle a cualquier handler de arriba.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  // El foco entra al panel: si no, el teclado sigue operando la lista de atrás.
  box.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

// Color de fondo de la línea por tipo (contexto no lleva fondo propio).
const LINE_BG: Record<string, string> = { add: 'bg-state-done/15', del: 'bg-danger/15' }
function lineClass(type: string) {
  return type === 'ctx' ? 'text-muted' : `${LINE_BG[type]} text-terminal-fg`
}
function lineSign(type: string) {
  return type === 'add' ? '+ ' : type === 'del' ? '- ' : ''
}
</script>

<template>
  <div ref="box" class="absolute inset-0 z-10 flex flex-col bg-surface" role="dialog" aria-modal="true" :aria-label="`Diff de ${file}`" tabindex="-1">
    <header class="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
      <b class="min-w-0 font-mono text-sm font-medium text-text [overflow-wrap:anywhere]">{{ file }}</b>
      <button
        type="button"
        class="inline-flex cursor-pointer items-center rounded-[var(--radius)] border-0 bg-transparent p-1 text-text hover:text-accent"
        aria-label="Cerrar el diff"
        @click="emit('close')"
      >
        <GitIcon name="close" />
      </button>
    </header>
    <p v-if="binary" class="p-2.5 text-sm text-muted">archivo binario</p>
    <div v-else class="flex-1 overflow-auto bg-terminal-bg font-mono text-xs">
      <table v-for="(h, i) in hunks" :key="i" class="w-full border-collapse">
        <tbody>
          <tr v-for="(l, j) in h.lines" :key="j">
            <td class="w-px select-none px-1.5 text-right tabular-nums text-muted/70">{{ l.oldNo ?? '' }}</td>
            <td class="w-px select-none px-1.5 text-right tabular-nums text-muted/70">{{ l.newNo ?? '' }}</td>
            <td class="whitespace-pre px-1.5 align-top" :class="lineClass(l.type)">{{ lineSign(l.type) }}{{ l.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
