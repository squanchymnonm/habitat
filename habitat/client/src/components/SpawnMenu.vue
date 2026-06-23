<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import { CHARACTERS, faceFor } from '../sprites'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const step = ref<'proj' | 'detail'>('proj')
const pickedDir = ref('')
const busy = ref(false)
const branch = ref('')
const base = ref('main')

function toggle() {
  open.value = !open.value
  step.value = 'proj'
  pickedDir.value = ''
}
function pickProject(dir: string) {
  pickedDir.value = dir
  branch.value = ''
  base.value = 'main'
  step.value = 'detail'
}
function back() {
  step.value = 'proj'
  pickedDir.value = ''
}
async function create(char?: string) {
  if (!pickedDir.value || !branch.value.trim()) return
  busy.value = true
  const ok = await spawn(pickedDir.value, branch.value.trim(), base.value.trim() || 'main', char)
  busy.value = false
  if (ok) {
    open.value = false
    step.value = 'proj'
    pickedDir.value = ''
  }
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="toggle" :disabled="busy">+ NUEVO AGENTE</button>
    <div class="spawn-menu" v-if="open">
      <!-- Paso 1: elegir proyecto -->
      <template v-if="step === 'proj'">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="pickProject(p.dir)"
        >
          {{ p.name }}
        </button>
      </template>

      <!-- Paso 2: rama + base + personaje -->
      <template v-else>
        <button class="ctl spawn-back" :disabled="busy" @click="back">← volver</button>
        <input class="spawn-input" v-model="branch" placeholder="rama (ej. feature/x)" :disabled="busy" />
        <input class="spawn-input" v-model="base" placeholder="base" :disabled="busy" />
        <div class="spawn-chars">
          <button
            v-for="c in CHARACTERS"
            :key="c"
            class="spawn-char"
            :disabled="busy || !branch.trim()"
            :title="c"
            @click="create(c)"
          >
            <img :src="faceFor('', c)" alt="" />
          </button>
          <button class="ctl spawn-auto" :disabled="busy || !branch.trim()" @click="create()">Auto</button>
        </div>
      </template>

      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.spawn-chars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 6px;
}
.spawn-char {
  background: transparent;
  border: 2px solid #3a3a4a;
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
}
.spawn-char:hover {
  border-color: #e7c14a;
}
.spawn-char img {
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
  display: block;
}
.spawn-auto {
  grid-column: span 4;
}
</style>
