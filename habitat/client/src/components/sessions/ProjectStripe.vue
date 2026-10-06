<script setup lang="ts">
import { computed } from 'vue'
import { useProjects } from '../../composables/useProjects'

// Franja con el color del proyecto de la sesión (dato del usuario, va por :style).
const props = defineProps<{ project: string }>()
const { colorForProject } = useProjects()
const color = computed(() => colorForProject(props.project))
</script>

<template>
  <i v-if="color" data-test="project-stripe" aria-hidden="true" class="w-1 shrink-0 self-stretch rounded-full" :style="{ background: color }" />
</template>
