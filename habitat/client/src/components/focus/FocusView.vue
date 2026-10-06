<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../../stores/sessions'
import { useFocusTools, type SideTool } from '../../composables/useFocusTools'
import { useFocusShortcuts } from '../../composables/useFocusShortcuts'
import { useProjects } from '../../composables/useProjects'
import { useLayoutMode } from '../../composables/useLayoutMode'
import SessionHeader from './SessionHeader.vue'
import ToolTabs from './ToolTabs.vue'
import TerminalPane from './TerminalPane.vue'
import PinnedPanel from './PinnedPanel.vue'
import EditorPane from './EditorPane.vue'
import ToolHost from './ToolHost.vue'

const { mode } = useLayoutMode()
const phone = computed(() => mode.value === 'phone')
const store = useSessions()
const session = computed(() => store.selected)
const tools = useFocusTools(computed(() => session.value?.id ?? null))
const { canSpawn } = useProjects()
const term = ref<InstanceType<typeof TerminalPane> | null>(null)
const editorOpen = ref(false)
watch(() => session.value?.id, () => { editorOpen.value = false })

const LABEL: Record<SideTool, string> = { git: 'Git', files: 'Archivos', infra: 'Infra', quest: 'Quest' }

// Mismo gate que ToolTabs para la pestaña Infra. Si no se cumple (se cerró la sesión
// de infra, el server dejó de permitir spawnear, o se pasó a una sesión sin infra
// que tenía Infra guardada), no se muestra una herramienta cuya pestaña no existe.
const infraAllowed = computed(() => canSpawn.value && !!session.value?.infra?.dir)
const visible = (t: SideTool | null): SideTool | null => (t === 'infra' && !infraAllowed.value ? null : t)
// Panel fijado efectivo: sólo en landscape (respaldo del desfijado por cambio de modo).
const pinnedTool = computed<SideTool | null>(() => (tools.canPin.value ? visible(tools.pinned.value) : null))
// La herramienta que ocupa el área (sin panel fijado) o el panel fijado.
const shownTool = computed<SideTool | null>(() =>
  pinnedTool.value ?? (tools.active.value === 'terminal' ? null : visible(tools.active.value)))
// Además limpia el estado guardado, para que la pestaña marcada vuelva a Terminal.
watch([() => session.value?.id, infraAllowed], ([, allowed]) => {
  if (allowed) return
  if (tools.pinned.value === 'infra') tools.unpin()
  if (tools.active.value === 'infra') tools.select('terminal')
}, { immediate: true })

// Elegir una pestaña (o fijar) cierra el editor: el usuario quiere ver esa herramienta.
function onToolSelected() { editorOpen.value = false }

function onInsert(text: string) {
  term.value?.insert(text)
  if (!pinnedTool.value) tools.select('terminal') // volver a la terminal para seguir escribiendo
}

// Esc: primero cierra el editor, después desfija el panel. Los diálogos (Reka) manejan su propio Esc.
useFocusShortcuts({
  onEscape: () => {
    if (editorOpen.value) { editorOpen.value = false; return true }
    if (pinnedTool.value) { tools.unpin(); return true }
    return false
  },
})

defineExpose({ fit: () => term.value?.fit() })
</script>

<template>
  <div v-if="session" :class="phone ? 'flex h-full min-h-0 flex-col p-3 pb-0' : 'flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4'">
    <SessionHeader :session="session" @open-editor="editorOpen = true" />
    <ToolTabs v-if="!phone" :session="session" @selected="onToolSelected" />
    <div class="relative min-h-0 flex-1">
      <PinnedPanel v-if="pinnedTool" :size="tools.pinnedSize.value" :label="LABEL[pinnedTool]"
        @resize="tools.setPinnedSize" @unpin="tools.unpin()">
        <template #left><TerminalPane ref="term" :session="session" /></template>
        <ToolHost :tool="pinnedTool" :session="session" :path="tools.path.value"
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
    <ToolTabs v-if="phone" :session="session" @selected="onToolSelected" />
  </div>
</template>
