<script setup lang="ts">
import type { GitStatus, DiffBase } from '../../../composables/useGit'
import { UL, LI, FLAT_A, MUTED, stColor } from './gitClasses'

const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()
</script>

<template>
  <ul :class="UL">
    <li v-for="f in props.status.overview.files" :key="f.rel" :class="LI">
      <span class="w-4 text-center font-mono text-xs" :class="stColor(f.status)">{{ f.status }}</span>
      <a :class="FLAT_A" @click="emit('diff', f.rel, 'branch')">{{ f.rel }}</a>
    </li>
    <li v-if="!props.status.overview.files.length" :class="MUTED">
      sin diferencias con {{ props.status.overview.default }}
    </li>
  </ul>
</template>
