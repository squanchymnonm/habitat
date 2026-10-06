<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Trash2 } from 'lucide-vue-next'
import { useProjects } from '../../../composables/useProjects'
import { PALETTE } from '../../../palette'
import { CHARACTERS, faceFor } from '../../../sprites'
import type { Project } from '../../../types'
import ConfirmDialog from '../../focus/ConfirmDialog.vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ project: Project }>()
const { updateProject, removeProject } = useProjects()
const router = useRouter()

// El label se guarda al confirmar el input (change: Enter o al salir del campo).
const label = ref(props.project.name)
watch(() => props.project.name, (n) => { label.value = n })
async function saveLabel() {
  const l = label.value.trim()
  if (!l || l === props.project.name) { label.value = props.project.name; return }
  await updateProject({ dir: props.project.dir, label: l })
}

async function setColor(color: string) {
  await updateProject({ dir: props.project.dir, color })
}

// Personajes permitidos: vacío = todos.
async function toggleChar(c: string) {
  const cur = props.project.chars ?? []
  const chars = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
  await updateProject({ dir: props.project.dir, chars })
}

const confirming = ref(false)
async function remove() {
  if (await removeProject(props.project.dir)) router.push('/settings/projects')
}

const input = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text'
</script>

<template>
  <div class="flex flex-col gap-6">
    <label class="flex max-w-sm flex-col gap-1 text-sm text-text">Nombre
      <input v-model="label" data-test="project-label" :class="input" @change="saveLabel" />
    </label>

    <div class="flex flex-col gap-1">
      <span class="text-sm text-text">Color</span>
      <div class="flex flex-wrap gap-2">
        <button v-for="c in PALETTE" :key="c" type="button" data-test="project-color" :style="{ background: c }" :title="c"
          :aria-pressed="c === project.color ? 'true' : 'false'"
          :class="cn('size-10 cursor-pointer rounded-[var(--radius)] border-0', c === project.color && 'ring-2 ring-accent')"
          @click="setColor(c)" />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-sm text-text">Personajes permitidos (vacío = todos)</span>
      <div class="flex flex-wrap gap-2">
        <button v-for="c in CHARACTERS" :key="c" type="button" data-test="project-char" :title="c"
          :aria-pressed="(project.chars ?? []).includes(c) ? 'true' : 'false'"
          :class="cn('min-h-10 min-w-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised p-1', (project.chars ?? []).includes(c) && 'ring-2 ring-accent')"
          @click="toggleChar(c)">
          <img :src="faceFor('', c)" alt="" class="pixel size-8" />
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-2 border-0 border-t border-border pt-4">
      <p class="m-0 text-sm text-muted">Quitarlo de Habitat no borra nada del disco.</p>
      <div>
        <button type="button" data-test="project-remove" @click="confirming = true"
          class="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-danger/10 px-3 font-[inherit] text-sm text-danger">
          <Trash2 class="size-4" />Quitar de la lista
        </button>
      </div>
    </div>

    <ConfirmDialog v-model:open="confirming" :title="`¿Quitar “${project.name}” de la lista?`"
      description="No se borra nada del disco." confirm-label="Quitar" danger @confirm="remove" />
  </div>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
