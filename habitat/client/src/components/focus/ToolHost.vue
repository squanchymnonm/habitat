<script setup lang="ts">
// Aloja la herramienta activa (en el área o en el panel fijado) y le pasa sólo
// los props/listeners que esa herramienta declara: Git y Archivos quieren
// `path`, Infra quiere la sesión entera, y sólo Archivos emite algo.
import type { Session } from '../../types'
import type { SideTool } from '../../composables/useFocusTools'
import GitTool from '../tools/git/GitTool.vue'
import FilesTool from '../tools/FilesTool.vue'
import QuestTool from '../tools/QuestTool.vue'
import InfraTool from '../tools/InfraTool.vue'

defineProps<{ tool: SideTool; session: Session; path: string }>()
const emit = defineEmits<{ (e: 'navigate', rel: string): void; (e: 'insert', text: string): void; (e: 'opened'): void }>()
</script>

<template>
  <GitTool v-if="tool === 'git'" :key="`${session.id}:git`" :session-id="session.id" :path="path" />
  <FilesTool v-else-if="tool === 'files'" :key="`${session.id}:files`" :session-id="session.id" :path="path"
    @navigate="emit('navigate', $event)" @insert="emit('insert', $event)" @opened="emit('opened')" />
  <QuestTool v-else-if="tool === 'quest'" :key="`${session.id}:quest`" :session-id="session.id" />
  <InfraTool v-else-if="tool === 'infra'" :key="`${session.id}:infra`" :session="session" />
</template>
