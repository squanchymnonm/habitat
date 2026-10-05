<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../../stores/sessions'
import { useFocusTools, type SideTool } from '../../composables/useFocusTools'
import { useFocusShortcuts } from '../../composables/useFocusShortcuts'
import { useProjects } from '../../composables/useProjects'
import SessionHeader from './SessionHeader.vue'
import ToolTabs from './ToolTabs.vue'
import TerminalPane from './TerminalPane.vue'
import PinnedPanel from './PinnedPanel.vue'
import EditorPane from './EditorPane.vue'
import ToolHost from './ToolHost.vue'

const store = useSessions()
const session = computed(() => store.selected)
const tools = useFocusTools(computed(() => session.value?.id ?? null))
const { canSpawn } = useProjects()
const term = ref<InstanceType<typeof TerminalPane> | null>(null)
const editorOpen = ref(false)
watch(() => session.value?.id, () => { editorOpen.value = false })

const LABEL: Record<SideTool, string> = { git: 'Git', files: 'Archivos', infra: 'Infra', quest: 'Quest' }
// La herramienta que ocupa el área (sin panel fijado) o el panel fijado.
const shownTool = computed<SideTool | null>(() => tools.pinned.value ?? (tools.active.value === 'terminal' ? null : tools.active.value))

// Mismo gate que ToolTabs para la pestaña Infra. Si deja de cumplirse (se cerró la
// sesión de infra, el server dejó de permitir spawnear) mientras Infra está activa o
// fijada, no seguir mostrando una herramienta cuya pestaña ya desapareció.
const infraAllowed = computed(() => canSpawn.value && !!session.value?.infra?.dir)
watch(infraAllowed, (allowed) => {
  if (allowed) return
  if (tools.pinned.value === 'infra') tools.unpin()
  if (tools.active.value === 'infra') tools.select('terminal')
})

function onInsert(text: string) {
  term.value?.insert(text)
  if (!tools.pinned.value) tools.select('terminal') // volver a la terminal para seguir escribiendo
}

// Esc: primero cierra el editor, después desfija el panel. Los diálogos (Reka) manejan su propio Esc.
useFocusShortcuts({
  onEscape: () => {
    if (editorOpen.value) { editorOpen.value = false; return true }
    if (tools.pinned.value) { tools.unpin(); return true }
    return false
  },
})

defineExpose({ fit: () => term.value?.fit() })
</script>

<template>
  <div v-if="session" class="flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4">
    <SessionHeader :session="session" @open-editor="editorOpen = true" />
    <ToolTabs :session="session" />
    <div class="relative min-h-0 flex-1">
      <PinnedPanel v-if="tools.pinned.value" :size="tools.pinnedSize.value" :label="LABEL[tools.pinned.value]"
        @resize="tools.setPinnedSize" @unpin="tools.unpin()">
        <template #left><TerminalPane ref="term" :session="session" /></template>
        <ToolHost :tool="tools.pinned.value" :session="session" :path="tools.path.value"
          @navigate="tools.setPath" @insert="onInsert" @opened="editorOpen = true" />
      </PinnedPanel>
      <template v-else>
        <!-- La terminal no se desmonta al cambiar de pestaña: v-show, para no cortar el WebSocket. -->
        <div v-show="!shownTool" class="h-full"><TerminalPane ref="term" :session="session" /></div>
        <div v-if="shownTool" class="h-full overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-surface">
          <ToolHost :tool="shownTool" :session="session" :path="tools.path.value"
            @navigate="tools.setPath" @insert="onInsert" @opened="editorOpen = true" />
        </div>
      </template>
      <EditorPane v-if="editorOpen" :key="session.id" :session-id="session.id" @close="editorOpen = false" />
    </div>
  </div>
</template>
