<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGit, type GitStatus, type DiffBase, type LogEntry } from '../../../composables/useGit'
import GitIcon from './GitIcon.vue'
import { BTN, GROUP_H4, MUTED, UL, LI, FLAT_A, stColor } from './gitClasses'

const props = defineProps<{ status: GitStatus; id: string; path: string }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()

const { loadLog } = useGit()
const showAll = ref(false)
const log = ref<LogEntry[]>([])
const skip = ref(0)
const atEnd = ref(false)
const loadingMore = ref(false)
const PAGE = 50
// Generación del contexto (id/path). Cada loadMore() en vuelo recuerda con qué
// generación arrancó; si el contexto cambió mientras esperaba la respuesta del
// server, la descarta al volver en vez de aplicarla — si no, un fetch viejo que
// llega después del reset pisa o mezcla el log con commits de otro repo.
const gen = ref(0)

async function loadMore() {
  if (loadingMore.value) return // ya hay una carga en curso: no reentrar (evita duplicar página)
  loadingMore.value = true
  const myGen = gen.value
  const mySkip = skip.value // capturado ahora: no leer skip.value de nuevo tras el await
  const rows = await loadLog(props.id, props.path, { limit: PAGE, skip: mySkip })
  if (myGen !== gen.value) return // el contexto cambió mientras esperábamos: descartar sin tocar el estado
  log.value = mySkip === 0 ? rows : [...log.value, ...rows]
  skip.value = mySkip + rows.length
  atEnd.value = rows.length < PAGE
  loadingMore.value = false
}

// Al cambiar de repo se descarta lo cargado: el historial es de otro repo.
// Se libera el guard de reentrancia: una carga vieja en vuelo para el repo
// anterior ya no cuenta como "en curso" para el contexto nuevo.
watch(() => [props.id, props.path] as const, () => {
  gen.value++
  log.value = []; skip.value = 0; atEnd.value = false
  loadingMore.value = false
  if (showAll.value) loadMore()
})
watch(showAll, (on) => { if (on && !log.value.length) loadMore() })
</script>

<template>
  <!-- Dos alcances del mismo historial. El botón dice a dónde te lleva, no
       dónde estás, y el encabezado nombra el alcance actual. -->
  <section class="flex flex-col gap-1.5">
    <h4 :class="GROUP_H4">
      {{ showAll ? 'Historial completo' : `Commits sobre ${props.status.overview.default}` }}
      <button type="button" class="ml-auto" :class="BTN" data-test="git-commit-toggle" @click="showAll = !showAll">
        {{ showAll ? 'sólo mi rama' : 'historial completo' }}
      </button>
    </h4>

    <template v-if="showAll">
      <div v-for="c in log" :key="c.sha" data-test="git-commit-row" class="border-b border-border py-2 text-base">
        <div class="flex items-center gap-1.5">
          <code class="shrink-0 font-mono text-sm tabular-nums text-accent">{{ c.shortSha }}</code>
          <span class="min-w-0 flex-1 text-text [overflow-wrap:anywhere]">{{ c.subject }}</span>
        </div>
        <div class="mt-0.5 pl-1" :class="MUTED">{{ c.author }} · {{ c.date }}</div>
      </div>
      <p v-if="!log.length && !loadingMore" :class="MUTED">sin commits en este repo</p>
      <button v-if="!atEnd" type="button" class="mt-1.5" :class="BTN" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? 'cargando…' : 'cargar más' }}
      </button>
      <p v-else-if="log.length" :class="MUTED">fin del historial</p>
    </template>

    <template v-else>
      <div v-for="c in props.status.commits" :key="c.sha" data-test="git-commit-row" class="border-b border-border py-2 text-base">
        <div class="flex items-center gap-1.5">
          <!-- Pusheado o no: icono + title, no sólo el color del glifo. -->
          <span class="inline-flex shrink-0" :class="c.pushed ? 'text-state-done' : 'text-muted'" :title="c.pushed ? 'pusheado' : 'sin pushear'">
            <GitIcon :name="c.pushed ? 'check' : 'dot'" />
          </span>
          <code class="shrink-0 font-mono text-sm tabular-nums text-accent">{{ c.shortSha }}</code>
          <span class="min-w-0 flex-1 text-text [overflow-wrap:anywhere]">{{ c.subject }}</span>
        </div>
        <ul :class="UL">
          <li v-for="f in c.files" :key="c.sha + f.rel" :class="LI">
            <span class="w-4 text-center font-mono text-xs" :class="stColor(f.status)">{{ f.status }}</span>
            <a :class="FLAT_A" @click="emit('diff', f.rel, `commit:${c.sha}`)">{{ f.rel }}</a>
          </li>
        </ul>
      </div>
      <p v-if="!props.status.commits.length" :class="MUTED">
        Tu rama no tiene commits por encima de {{ props.status.overview.default }}.
      </p>
    </template>
  </section>
</template>
