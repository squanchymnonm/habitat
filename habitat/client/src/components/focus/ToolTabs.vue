<script setup lang="ts">
import { computed } from 'vue'
import { TerminalSquare, GitBranch, FolderOpen, Server, ScrollText, PanelRightOpen } from 'lucide-vue-next'
import { useFocusTools, type ToolId, type SideTool } from '../../composables/useFocusTools'
import { useProjects } from '../../composables/useProjects'
import { useLayoutMode } from '../../composables/useLayoutMode'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const { canSpawn } = useProjects()
const { mode } = useLayoutMode()
const phone = computed(() => mode.value === 'phone')
const tools = useFocusTools(computed(() => props.session.id))
// Avisa al padre que el usuario eligió una herramienta (FocusView cierra el editor).
const emit = defineEmits<{ (e: 'selected'): void }>()
function choose(id: ToolId) { tools.select(id); emit('selected') }
function pinActive() { tools.pin(tools.active.value as SideTool); emit('selected') }

const TABS = computed(() => [
  { id: 'terminal' as ToolId, label: 'Terminal', icon: TerminalSquare },
  { id: 'git' as ToolId, label: 'Git', icon: GitBranch },
  { id: 'files' as ToolId, label: 'Archivos', icon: FolderOpen },
  // Las acciones de infra requieren que el server permita spawnear (como el bloque viejo).
  ...(canSpawn.value && props.session.infra?.dir ? [{ id: 'infra' as ToolId, label: 'Infra', icon: Server }] : []),
  { id: 'quest' as ToolId, label: 'Quest', icon: ScrollText },
])
// Con un panel fijado, la pestaña marcada es la del panel (la terminal está a la izquierda).
const current = computed<ToolId>(() => tools.pinned.value ?? tools.active.value)
const pinnable = computed(() => tools.canPin.value && !tools.pinned.value && tools.active.value !== 'terminal')
</script>

<template>
  <nav v-if="phone" data-test="tool-bar" role="tablist" aria-label="Herramientas"
    class="flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom,0px)]">
    <button v-for="t in TABS" :key="t.id" data-test="tool-tab" type="button" role="tab"
      :aria-selected="current === t.id ? 'true' : 'false'"
      :class="cn('flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent font-[inherit] text-[11px]',
        current === t.id ? 'text-accent' : 'text-muted')"
      @click="choose(t.id)">
      <component :is="t.icon" class="size-5" />{{ t.label }}
    </button>
  </nav>
  <nav v-else role="tablist" aria-label="Herramientas" class="flex items-center gap-1 overflow-x-auto border-b border-border">
    <button v-for="t in TABS" :key="t.id" data-test="tool-tab" type="button" role="tab"
      :aria-selected="current === t.id ? 'true' : 'false'"
      :class="cn('inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-3 font-[inherit] text-sm',
        current === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')"
      @click="choose(t.id)">
      <component :is="t.icon" class="size-4" />{{ t.label }}
    </button>
    <span class="flex-1" />
    <button v-if="pinnable" data-test="pin-tool" type="button" title="Fijar al costado de la terminal"
      class="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 font-[inherit] text-xs text-muted hover:bg-surface-raised hover:text-text"
      @click="pinActive">
      <PanelRightOpen class="size-4" />Fijar al costado
    </button>
  </nav>
</template>
