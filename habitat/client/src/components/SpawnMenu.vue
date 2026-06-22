<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const busy = ref(false)
const selected = ref<string | null>(null)
const branch = ref('')
const base = ref('main')

function choose(dir: string) {
  selected.value = dir
  branch.value = ''
  base.value = 'main'
}

async function create() {
  if (!selected.value || !branch.value.trim()) return
  busy.value = true
  const ok = await spawn(selected.value, branch.value.trim(), base.value.trim() || 'main')
  busy.value = false
  if (ok) { open.value = false; selected.value = null }
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="open = !open" :disabled="busy">+ NUEVO AGENTE</button>
    <div class="spawn-menu" v-if="open">
      <template v-if="!selected">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="choose(p.dir)"
        >
          {{ p.name }}
        </button>
      </template>
      <template v-else>
        <input class="spawn-input" v-model="branch" placeholder="rama (ej. feature/x)" :disabled="busy" @keyup.enter="create" />
        <input class="spawn-input" v-model="base" placeholder="base" :disabled="busy" @keyup.enter="create" />
        <button class="ctl spawn-item" :disabled="busy || !branch.trim()" @click="create">CREAR</button>
        <button class="ctl spawn-item" :disabled="busy" @click="selected = null">← VOLVER</button>
      </template>
      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>
