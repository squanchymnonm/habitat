<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useGit, type DiffBase, type StashEntry } from '../../../composables/useGit'
import { canCreatePr } from '../../../composables/gitBranches'
import { parseDiff, type DiffHunk } from '../../../composables/parseDiff'
import { useSessions } from '../../../stores/sessions'
import GitWork from './GitWork.vue'
import GitBranchDiff from './GitBranchDiff.vue'
import GitBranches from './GitBranches.vue'
import GitCommits from './GitCommits.vue'
import GitDiff from './GitDiff.vue'
import GitIcon from './GitIcon.vue'

const props = defineProps<{ sessionId: string; path: string }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, loadStash, action } = useGit()

// 'branch' (el diff contra el default) dejó de ser pestaña propia: era la misma
// pregunta que 'commits' — "qué tiene mi rama arriba del default" — partida en
// dos lugares. Ahora vive como resumen arriba del historial.
const tab = ref<'work' | 'branches' | 'commits'>('work')
const branchesEl = ref<InstanceType<typeof GitBranches> | null>(null)
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')
const stash = ref<StashEntry[]>([])
// Cuando el checkout falla por árbol sucio, ofrecemos la salida útil en vez de
// dejar al usuario con un error de git.
const retry = ref<{ branch: string } | null>(null)
const prUrl = ref('')

async function refresh() {
  await loadStatus(props.sessionId, props.path)
  stash.value = await loadStash(props.sessionId, props.path)
}

async function openDiff(file: string, base: DiffBase) {
  diff.value = null
  try {
    const r = await loadDiff(props.sessionId, file, base, props.path)
    diff.value = { file, hunks: r.binary ? [] : parseDiff(r.patch), binary: r.binary }
  } catch { actionErr.value = 'no se pudo cargar el diff' }
}

async function run(name: string, payload: Record<string, unknown> = {}, confirmMsg?: string) {
  if (confirmMsg && !confirm(confirmMsg)) return
  busy.value = name; actionErr.value = ''
  const r = await action(props.sessionId, name, { path: props.path, ...payload })
  busy.value = ''
  if (!r.ok) {
    actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
    retry.value = r.dirty && name === 'checkout' ? { branch: payload.branch as string } : null
  } else {
    retry.value = null
  }
  await refresh()
  await branchesEl.value?.refresh()
}

// El stash va por run(), no por action() directo: así toma `busy` (el botón no admite
// doble click) y limpia el actionErr del checkout que falló — con action() directo ese
// error quedaba visible como si el stash hubiera fallado.
async function stashAndRetry() {
  const branch = retry.value?.branch
  if (!branch) return
  retry.value = null
  await run('stash-push', { message: `auto antes de ir a ${branch}` })
  if (actionErr.value) return // el stash falló: no encadenar el checkout encima
  await run('checkout', { branch })
}

async function doPr() {
  busy.value = 'pr-create'; actionErr.value = ''; prUrl.value = ''
  const r = await action(props.sessionId, 'pr-create', { path: props.path })
  busy.value = ''
  if (r.url) prUrl.value = r.url
  if (!r.ok) actionErr.value = r.message || 'no se pudo crear el PR'
  await refresh()
}

// Refresh live: cada broadcast WS hace store.upsert -> la sesión seleccionada
// cambia de identidad; debounced para no spamear git.
let t: ReturnType<typeof setTimeout> | null = null
function schedule() { if (t) clearTimeout(t); t = setTimeout(refresh, 800) }
watch(() => store.list.find((s) => s.id === props.sessionId), schedule)
// El path lo manda el shell: al navegar a otra carpeta hay que re-scopear.
// Cambiar de sesión o de path invalida cualquier oferta de recuperación pendiente:
// "retry" (y el error que la originó) apuntan a la rama/repo que falló, que ya no
// es el contexto activo — si no se limpia, "Stashear y reintentar" terminaría
// operando sobre el repo/rama nuevos con el nombre de rama del contexto viejo.
// prUrl tiene la misma fuga: es el link del PR del repo/rama anterior, y si no
// se limpia queda visible apuntando a un PR que no tiene nada que ver con el
// repo activo nuevo.
watch(() => [props.sessionId, props.path] as const, () => {
  retry.value = null
  actionErr.value = ''
  prUrl.value = ''
  refresh()
}, { immediate: true })
onBeforeUnmount(() => { if (t) clearTimeout(t) })

const repoLabel = computed(() => {
  if (!status.value) return null
  const { branch, ahead, behind } = status.value.overview
  return { name: status.value.repo.name || status.value.repo.rel || '·', branch, ahead, behind }
})
const pr = computed(() => (status.value ? canCreatePr(status.value.overview) : { can: false, why: '' }))

// Una sola acción primaria por contexto: antes los cinco botones de la barra
// pesaban igual y no había forma de saber cuál correspondía.
//
// Ojo con la señal: `ahead` NO sirve para "falta pushear" — cuenta commits por
// encima de origin/<default>, no contra origin/<branch>, así que con la rama
// pusheada al día `ahead` sigue en 2 o 3. La señal honesta es `pushed` por
// commit, que sale de git. `behind` sí cuenta contra el default, así que sirve
// para decidir "traer el default".
const unpushedCount = computed(() => status.value?.commits.filter((c) => !c.pushed).length ?? 0)
const primary = computed<'push' | 'merge-default' | 'fetch'>(() => {
  const s = status.value
  if (!s) return 'fetch'
  if (unpushedCount.value > 0) return 'push'
  if (s.overview.behind > 0) return 'merge-default'
  return 'fetch'
})

// Lo que espera acción del usuario en la pestaña Cambios: conflictos primero
// (bloquean), después lo que hay para stagear o commitear.
const pendingCount = computed(() => {
  const w = status.value?.working
  if (!w) return 0
  return w.conflicted.length + w.staged.length + w.unstaged.length + w.untracked.length
})
// Traduce el discriminante del 409 (ver reason409 en useGit) a algo que se entienda.
// 'repo-arriba' era el caso mentiroso: el panel decía "sin repo git acá" cuando SÍ
// había repo y el motivo real era que su raíz está fuera del alcance de la sesión.
const errMsg = computed(() => {
  switch (error.value) {
    case 'sin-repo': return 'sin repo git acá'
    case 'sin-sesion': return 'este pod no tiene un directorio asociado'
    case 'repo-arriba': return 'el repo está por encima del directorio de la sesión: fuera de alcance'
    case 'repo-afuera': return 'el repo apunta fuera del directorio de la sesión: fuera de alcance'
    default: return error.value
  }
})
defineExpose({ repoLabel, refresh })

// Clases compartidas (ex git.css), token por token.
const BTN = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:cursor-default disabled:opacity-50'
const BTN_PRIMARY = 'bg-accent text-accent-foreground hover:text-accent-foreground'
const COUNT = 'rounded-full bg-surface px-1.5 text-[10px] tabular-nums text-muted'
const COUNT_PRIMARY = 'bg-accent-foreground/20 text-accent-foreground'
const GROUP_H4 = 'm-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted'
const TAB = 'cursor-pointer border-0 border-b-2 bg-transparent px-3 py-1.5 font-[inherit] text-sm'
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <!-- Cabecera del repo: antes la mostraba ProjectExplorer, que ya no existe. -->
    <p v-if="repoLabel" data-test="git-repo" class="m-0 px-3 pt-2 font-mono text-xs text-muted">
      repo: <b class="text-text">{{ repoLabel.name }}</b> · ⌥ <b class="text-text">{{ repoLabel.branch }}</b> · ↑{{ repoLabel.ahead }} ↓{{ repoLabel.behind }}
    </p>

    <!-- Tres pestañas, todas en español: antes eran cuatro y mezclaba idiomas
         (Trabajo | Rama | Branches | Commits). El contador de cambios va en la
         pestaña porque es el dato que decide si entrar. -->
    <nav class="flex gap-1.5 px-3 py-2" role="tablist" aria-label="Vistas de git">
      <button
        role="tab"
        type="button"
        data-test="git-tab"
        :aria-selected="tab === 'work'"
        :class="[TAB, tab === 'work' ? 'border-accent text-text' : 'border-transparent text-muted']"
        @click="tab = 'work'"
      >
        Cambios
        <span v-if="pendingCount" :class="COUNT">{{ pendingCount }}</span>
      </button>
      <button
        role="tab"
        type="button"
        data-test="git-tab"
        :aria-selected="tab === 'branches'"
        :class="[TAB, tab === 'branches' ? 'border-accent text-text' : 'border-transparent text-muted']"
        @click="tab = 'branches'"
      >
        Ramas
      </button>
      <button
        role="tab"
        type="button"
        data-test="git-tab"
        :aria-selected="tab === 'commits'"
        :class="[TAB, tab === 'commits' ? 'border-accent text-text' : 'border-transparent text-muted']"
        @click="tab = 'commits'"
      >
        Historial
      </button>
    </nav>

    <p v-if="error" class="m-0 px-3 text-sm text-danger">{{ errMsg }}</p>
    <p v-if="actionErr" class="m-0 px-3 text-sm text-danger">{{ actionErr }}</p>
    <p v-if="prUrl" class="px-3 text-sm [overflow-wrap:anywhere]">
      <a :href="prUrl" target="_blank" rel="noopener" class="font-mono text-accent no-underline hover:underline">{{ prUrl }}</a>
    </p>
    <!-- La salida del checkout que falló por árbol sucio. No es un error nuevo:
         es la acción de recuperación del error de arriba, así que va pegada. -->
    <p v-if="retry" class="m-0 px-3">
      <button type="button" data-test="git-btn" :class="BTN" :disabled="!!busy" @click="stashAndRetry">
        <GitIcon name="stack" />
        Stashear y reintentar
      </button>
    </p>
    <p v-if="loading" class="px-3 text-sm text-muted">cargando…</p>

    <div v-if="status" class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <GitWork v-if="tab === 'work'" :status="status" :stash="stash" @run="run" @diff="openDiff" />
      <GitBranches v-else-if="tab === 'branches'" ref="branchesEl" :id="props.sessionId" :path="props.path" @run="run" />
      <template v-else>
        <!-- El diff contra el default encabeza el historial: es el resumen de
             "qué cambia mi rama", y los commits son el detalle de lo mismo. -->
        <section class="flex flex-col gap-1.5">
          <h4 :class="GROUP_H4">
            Contra {{ status.overview.default }}
            <span :class="COUNT">{{ status.overview.files.length }}</span>
          </h4>
          <GitBranchDiff :status="status" @diff="openDiff" />
        </section>
        <GitCommits :status="status" :id="props.sessionId" :path="props.path" @diff="openDiff" />
      </template>
    </div>

    <!-- Barra fija: visible desde cualquier sub-pestaña. Es la corrección al
         problema original (los botones estaban enterrados en una pestaña).
         Una sola acción va marcada como primaria según el estado del repo; el
         resto queda secundario, y el PR aparte porque es la única que sale
         hacia afuera (crea algo en GitHub). -->
    <footer v-if="status" class="flex flex-wrap gap-2 border-t border-border bg-surface p-2">
      <button
        type="button"
        data-test="git-btn"
        :class="[BTN, primary === 'merge-default' ? BTN_PRIMARY : '']"
        :disabled="busy === 'merge-default'"
        @click="run('merge-default', {}, `Traer ${status.overview.default} a la rama?`)"
      >
        <GitIcon name="merge" />
        Actualizar
        <span v-if="status.overview.behind" :class="[COUNT, primary === 'merge-default' ? COUNT_PRIMARY : '']">{{ status.overview.behind }}</span>
      </button>
      <button
        type="button"
        data-test="git-btn"
        :class="[BTN, primary === 'fetch' ? BTN_PRIMARY : '']"
        :disabled="busy === 'fetch'"
        @click="run('fetch')"
      >
        <GitIcon name="refresh" />
        Fetch
      </button>
      <button type="button" data-test="git-btn" :class="BTN" :disabled="busy === 'pull'" @click="run('pull')">
        <GitIcon name="download" />
        Pull
      </button>
      <button
        type="button"
        data-test="git-btn"
        :class="[BTN, primary === 'push' ? BTN_PRIMARY : '']"
        :disabled="busy === 'push'"
        @click="run('push')"
      >
        <GitIcon name="upload" />
        Push
        <span v-if="unpushedCount" :class="[COUNT, primary === 'push' ? COUNT_PRIMARY : '']">{{ unpushedCount }}</span>
      </button>
      <!-- El PR empuja a la derecha: es la única acción que sale hacia afuera, y
           separarla evita tocarla apuntando a Push. -->
      <button type="button" data-test="git-btn" class="ml-auto" :class="BTN" :disabled="busy === 'pr-create' || !pr.can" :title="pr.why" @click="doPr">
        <GitIcon name="pr" />
        PR
      </button>
    </footer>

    <GitDiff v-if="diff" :file="diff.file" :hunks="diff.hunks" :binary="diff.binary" @close="diff = null" />
  </div>
</template>
