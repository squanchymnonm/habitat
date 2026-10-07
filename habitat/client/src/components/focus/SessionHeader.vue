<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { SquarePen, X, Container, ArrowLeft } from 'lucide-vue-next'
import SessionAvatar from '../sessions/SessionAvatar.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useProjects } from '../../composables/useProjects'
import { useProjectTree } from '../../composables/useProjectTree'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { STATUS_LABEL, STATE_TOKEN, type Session } from '../../types'
import { ago } from '../../sprites'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ (e: 'open-editor'): void }>()
const { canSpawn, kill, colorForProject, dockerStatus, dockerDown } = useProjects()
const { openInNvim } = useProjectTree()
const { mode } = useLayoutMode()
const router = useRouter()

// Clases literales para que Tailwind las detecte.
const BADGE: Record<string, string> = {
  working: 'text-state-working border-state-working', waiting: 'text-state-waiting border-state-waiting',
  done: 'text-state-done border-state-done', idle: 'text-muted border-border', error: 'text-state-error border-state-error',
}
const badge = computed(() => BADGE[STATE_TOKEN[props.session.status]])
const projectColor = computed(() => colorForProject(props.session.project))
// Tinte suave del color del proyecto sobre la superficie (como los pods del diseño anterior).
const headTint = computed(() => (projectColor.value ? { background: `color-mix(in srgb, ${projectColor.value} 14%, var(--surface))` } : {}))

const editorErr = ref('')
// El error de nvim es de la sesión en la que se intentó: no arrastrarlo a otra.
watch(() => props.session.id, () => { editorErr.value = '' })
async function openEditor() {
  editorErr.value = ''
  const r = await openInNvim(props.session.id, '.')
  if (r.ok) emit('open-editor')
  else editorErr.value = r.message || 'no se pudo abrir nvim'
}

// Docker sin infra configurada: stacks levantados dentro del worktree. Al cerrar la
// sesión se bajan solos; el botón es para liberar puertos/RAM sin cerrarla.
const dockerStacks = ref<string[]>([])
const dockerBusy = ref(false)
async function refreshDocker() {
  const id = props.session.id
  dockerStacks.value = []
  if (!canSpawn.value || props.session.infra?.dir) return
  const stacks = await dockerStatus(id)
  if (props.session.id === id) dockerStacks.value = stacks // la sesión pudo cambiar mientras tanto
}
watch(() => [props.session.id, canSpawn.value] as const, refreshDocker, { immediate: true })
async function doDockerDown() {
  dockerBusy.value = true
  try { await dockerDown(props.session.id) } finally { dockerBusy.value = false }
  refreshDocker()
}

// Volver a la lista: si venimos de ella, retroceder (no apilar historial); si se entró
// directo a #/s/:id, reemplazar.
function backToList() {
  if (router.options.history.state.back === '/sessions') router.back()
  else router.replace('/sessions')
}

// En celular, al cerrar la sesión en foco se vuelve a la lista en vez de saltar al foco de otra.
async function closeSession() {
  const ok = await kill(props.session.id)
  if (ok && mode.value === 'phone') router.replace('/sessions')
}

const confirmClose = ref(false)
const confirmDocker = ref(false)
// min-h-10/min-w-10: objetivo táctil ≥40px (spec §5); en el teléfono Editor y Cerrar quedan sólo con ícono.
const action = 'inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1.5 font-[inherit] text-xs font-semibold text-text hover:text-accent disabled:cursor-default disabled:opacity-50'
</script>

<template>
  <header data-test="session-header" :style="headTint" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[calc(var(--radius)+4px)] border border-border bg-surface px-3 py-2">
    <button v-if="mode === 'phone'" data-test="back-to-list" type="button" aria-label="Volver a la lista" title="Volver a la lista"
      class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-transparent text-muted hover:bg-surface-raised hover:text-text"
      @click="backToList">
      <ArrowLeft class="size-5" />
    </button>
    <SessionAvatar :session="session" />
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <h1 data-test="session-name" class="m-0 truncate font-display text-lg font-semibold text-text">{{ session.name }}</h1>
      <span data-test="state-badge" :class="cn('rounded-[var(--radius-pill)] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', badge)">
        {{ STATUS_LABEL[session.status] }}
      </span>
      <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-raised" :title="`Stamina ${session.stamina}%`" :aria-label="`Stamina ${session.stamina}%`">
        <i data-test="stamina-fill" class="block h-full" :class="session.stamina < 25 ? 'bg-stamina-low' : 'bg-stamina-ok'" :style="{ width: session.stamina + '%' }" />
      </span>
      <span class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted">
        <i v-if="projectColor" class="size-2.5 shrink-0 rounded-sm" :style="{ background: projectColor }" />
        <span data-test="session-repo" class="block min-w-0 truncate">{{ session.project }}<template v-if="session.branch"> · <span class="text-accent">{{ session.branch }}</span></template></span>
      </span>
      <span v-if="editorErr" class="text-xs text-danger">{{ editorErr }}</span>
      <span data-test="session-activity" class="w-full min-w-0 truncate text-xs text-muted">
        <template v-if="session.action">{{ session.action }}<span class="hidden sm:inline"> · </span></template><span :class="session.action ? 'hidden sm:inline' : ''">activa hace {{ ago(session.since) }}</span>
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button data-test="open-editor" type="button" :class="action" title="Abrir nvim en la carpeta de la sesión"
        aria-label="Editor: abrir nvim en la carpeta de la sesión" @click="openEditor">
        <SquarePen class="size-3.5" /><span class="hidden sm:inline">Editor</span>
      </button>
      <button v-if="canSpawn && dockerStacks.length" data-test="docker-down" type="button" :class="action" :disabled="dockerBusy"
        :title="`Bajar containers: ${dockerStacks.join(', ')}`" @click="confirmDocker = true">
        <Container class="size-3.5" />{{ dockerBusy ? 'Bajando…' : `Bajar docker (${dockerStacks.length})` }}
      </button>
      <button v-if="canSpawn" data-test="close-session" type="button" :class="cn(action, 'hover:text-danger')"
        title="Cerrar sesión" aria-label="Cerrar sesión" @click="confirmClose = true">
        <X class="size-3.5" /><span class="hidden sm:inline">Cerrar</span>
      </button>
    </div>
    <ConfirmDialog v-model:open="confirmClose" :title="`¿Cerrar la sesión “${session.name}”?`"
      description="Se pierde el trabajo en curso." confirm-label="Cerrar sesión" danger @confirm="closeSession" />
    <ConfirmDialog v-model:open="confirmDocker" title="¿Bajar los containers de esta sesión?"
      :description="`${dockerStacks.join(', ')}\n\nSe eliminan containers y red; los volúmenes con datos quedan.`"
      confirm-label="Bajar" danger @confirm="doDockerDown" />
  </header>
</template>
