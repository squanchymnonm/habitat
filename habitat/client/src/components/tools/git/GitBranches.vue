<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGit } from '../../../composables/useGit'
import { groupBranches, type BranchList } from '../../../composables/gitBranches'
import GitIcon from './GitIcon.vue'

const props = defineProps<{ id: string; path: string }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: Record<string, unknown>, confirmMsg?: string): void
}>()

const { loadBranches } = useGit()
const data = ref<BranchList | null>(null)
const failed = ref(false)
const filter = ref('')
const creating = ref(false)
const newName = ref('')
const newFrom = ref<'default' | 'HEAD'>('default')

// `failed` distingue "todavía cargando" de "no se pudo cargar": sin él, con la red
// caída la pestaña quedaba en "cargando ramas…" para siempre.
async function refresh() {
  failed.value = false
  const r = await loadBranches(props.id, props.path)
  data.value = r
  failed.value = r === null
}
watch(() => [props.id, props.path] as const, refresh, { immediate: true })

const groups = computed(() => (data.value ? groupBranches(data.value, filter.value) : null))

function doCheckout(branch: string) { emit('run', 'checkout', { branch }) }
function doCreate() {
  if (!newName.value.trim()) return
  emit('run', 'branch-create', { branch: newName.value.trim(), from: newFrom.value })
  newName.value = ''; creating.value = false
}
defineExpose({ refresh })

// Clases compartidas (ex git.css), token por token.
const BTN = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:cursor-default disabled:opacity-50'
const BTN_PRIMARY = 'bg-accent text-accent-foreground hover:text-accent-foreground'
const GROUP_H4 = 'm-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted'
const MUTED = 'text-sm text-muted'
const INPUT = 'rounded-[var(--radius)] border border-border bg-background px-2 py-1 font-[inherit] text-sm text-text'
const UL = 'm-0 list-none divide-y divide-border p-0'
const LI = 'flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-base'
const FLAT = 'min-w-0 flex-1 bg-transparent font-mono text-sm text-text [overflow-wrap:anywhere]'
const FLAT_A = 'min-w-0 flex-1 cursor-pointer font-mono text-sm text-text underline decoration-dotted underline-offset-[3px] hover:text-accent [overflow-wrap:anywhere]'
</script>

<template>
  <div v-if="groups">
    <div class="mb-1.5 flex gap-1.5">
      <input v-model="filter" class="min-w-0 flex-1" :class="INPUT" placeholder="buscar rama" aria-label="Buscar rama" />
      <button type="button" :class="BTN" :aria-expanded="creating" @click="creating = !creating">
        <GitIcon name="plus" />
        nueva
      </button>
    </div>

    <div v-if="creating" class="mb-3 flex flex-wrap gap-1.5 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-2.5">
      <input v-model="newName" class="min-w-36 flex-1" :class="INPUT" placeholder="nombre de la rama" @keyup.enter="doCreate" />
      <select v-model="newFrom" :class="INPUT" aria-label="Punto de partida de la rama nueva">
        <option value="default">desde {{ data?.default }}</option>
        <option value="HEAD">desde HEAD</option>
      </select>
      <button type="button" :class="[BTN, newName.trim() ? BTN_PRIMARY : '']" :disabled="!newName.trim()"
        @click="doCreate">Crear</button>
    </div>

    <ul :class="UL">
      <li v-for="b in groups.local" :key="b.name" :class="[LI, b.current ? 'bg-accent/10' : '']">
        <!-- La rama actual no se marca sólo con un asterisco: lleva icono, el
             fondo del item y la etiqueta "actual". -->
        <span class="flex w-4 justify-center text-center font-mono text-xs" :class="b.current ? 'text-accent' : ''">
          <GitIcon v-if="b.current" name="branch" />
        </span>
        <a v-if="!b.current && !b.takenBy" :class="FLAT_A" @click="doCheckout(b.name)">{{ b.name }}</a>
        <span v-else :class="FLAT">{{ b.name }}</span>
        <span v-if="b.current" class="shrink-0 rounded-full border border-accent px-1.5 py-0.5 text-xs text-accent">actual</span>
        <span v-else-if="b.takenBy" :class="MUTED">abierta en {{ b.takenBy }}</span>
      </li>
      <li v-if="!groups.local.length" :class="MUTED">
        {{ filter.trim() ? 'ninguna rama local coincide con el filtro' : 'sin ramas locales' }}
      </li>
    </ul>

    <h4 v-if="groups.remote.length" :class="GROUP_H4">remotas</h4>
    <ul v-if="groups.remote.length" :class="UL">
      <!-- checkout, no branch-create: `git switch <short>` DWIMea la rama remota
           (la crea local siguiendo a origin/<short>, con SU contenido). Con
           branch-create/from:HEAD la rama nueva salía del HEAD local, sin el trabajo
           de la remota y sin upstream — y como groupBranches esconde las remotas que
           ya tienen local homónima, la remota real desaparecía de la lista. -->
      <li v-for="r in groups.remote" :key="r.name" :class="LI">
        <span class="w-4 text-center font-mono text-xs"></span>
        <span :class="FLAT">{{ r.name }}</span>
        <button type="button" :class="BTN" :title="`crear la rama local ${r.short} siguiendo a ${r.name}`"
          @click="doCheckout(r.short)">
          <GitIcon name="download" />
          traer
        </button>
      </li>
    </ul>
  </div>
  <p v-else-if="failed" class="m-0 text-sm text-danger">no se pudieron cargar las ramas</p>
  <p v-else :class="MUTED">cargando ramas…</p>
</template>
