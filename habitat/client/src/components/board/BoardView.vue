<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../../stores/sessions'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { boardColumns } from './boardColumns'
import BoardColumn from './BoardColumn.vue'
import { cn } from '@/lib/utils'

const store = useSessions()
const { mode } = useLayoutMode()
const columns = computed(() => boardColumns(store.list))
</script>

<template>
  <!-- landscape: cuatro columnas en fila; portrait y phone: apiladas, scrolleando la página. -->
  <div data-test="board" :class="cn('grid h-full min-h-0 gap-3 p-3 sm:p-4', mode === 'landscape' ? 'grid-cols-4' : 'grid-cols-1 content-start overflow-y-auto')">
    <BoardColumn v-for="c in columns" :key="c.id" :column="c" />
  </div>
</template>
