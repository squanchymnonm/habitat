<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useProjects } from '../../composables/useProjects'
import { CHARACTERS, faceFor } from '../../sprites'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Contenido compartido por el Dialog (desktop) y el Sheet (celular) de NewSessionDialog:
// proyecto → nombre (opcional) y personaje → crear.
// `project-change` avisa al contenedor (Dialog/Sheet) qué proyecto está elegido, para que
// muestre su nombre en la descripción del header (ese estado vive acá, no ahí).
const emit = defineEmits<{ (e: 'done'): void; (e: 'project-change', name: string | null): void }>()
const { projects, error, spawn } = useProjects()
// `error` es un ref compartido a nivel de módulo (useProjects): si quedó seteado por un
// intento fallido anterior, no debe reaparecer al reabrir el diálogo. Como este componente
// sólo existe mientras el diálogo está abierto (v-if="open" en NewSessionDialog), se crea de
// cero en cada apertura: limpiarlo acá alcanza.
error.value = ''

const dir = ref('')
const name = ref('')
const char = ref<string | undefined>(undefined)
const busy = ref(false)
const project = computed(() => projects.value.find((p) => p.dir === dir.value) ?? null)
watch(project, (p) => emit('project-change', p ? p.name : null), { immediate: true })
// La allowlist del proyecto manda; si está vacía, cualquier personaje.
const chars = computed(() => (project.value?.chars?.length ? project.value.chars : CHARACTERS))

function reset() { dir.value = ''; name.value = ''; char.value = undefined; error.value = '' }
async function create() {
  if (!dir.value || busy.value) return
  busy.value = true
  const ok = await spawn(dir.value, name.value.trim(), char.value)
  busy.value = false
  if (ok) { emit('done'); reset() }
}

const opt = 'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-surface-raised px-3 text-left font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50'
</script>

<template>
  <ul v-if="!project" class="m-0 flex list-none flex-col gap-2 p-0">
    <li v-for="p in projects" :key="p.dir">
      <button data-test="ns-project" type="button" :class="opt" :disabled="busy" @click="dir = p.dir">
        <i class="size-2.5 shrink-0 rounded-sm" :style="{ background: p.color }" />{{ p.name }}
      </button>
    </li>
  </ul>

  <div v-else class="flex flex-col gap-3">
    <button type="button" data-test="ns-back" :disabled="busy" @click="reset()"
      class="inline-flex min-h-10 w-fit cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 font-[inherit] text-sm text-muted hover:text-text">
      <ArrowLeft class="size-4" />Cambiar proyecto
    </button>
    <label class="flex flex-col gap-1 text-xs text-muted">
      Nombre (vacío = al azar)
      <Input v-model="name" data-test="ns-name" :disabled="busy" placeholder="ezio" @keyup.enter="create" />
    </label>
    <div class="flex flex-wrap gap-2">
      <button v-for="c in chars" :key="c" data-test="ns-char" type="button" :title="c" :disabled="busy"
        :class="cn('min-h-10 min-w-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised p-1', char === c && 'ring-2 ring-accent')"
        @click="char = char === c ? undefined : c">
        <img :src="faceFor('', c)" alt="" class="pixel size-8" />
      </button>
      <button data-test="ns-char-auto" type="button" :disabled="busy"
        :class="cn('min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text', !char && 'ring-2 ring-accent')"
        @click="char = undefined">Auto</button>
    </div>
    <button data-test="ns-create" type="button" :disabled="busy" @click="create"
      class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-accent px-4 font-[inherit] text-sm font-semibold text-accent-foreground disabled:opacity-50">
      {{ busy ? 'Creando…' : 'Crear' }}
    </button>
  </div>
  <p v-if="error" data-test="ns-error" class="m-0 rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger">
    <span aria-hidden="true">! </span>{{ error }}
  </p>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
