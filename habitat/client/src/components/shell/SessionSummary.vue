<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../../stores/sessions'

const store = useSessions()
const working = computed(() => store.list.filter((s) => s.status === 'working').length)
</script>

<template>
  <span data-test="session-summary" class="flex items-center gap-2 text-sm text-muted tabular-nums">
    <b class="text-text">{{ store.list.length }}</b>
    <span v-if="working" class="hidden items-center gap-1 sm:flex"><i class="size-2 rounded-full bg-state-working" />{{ working }} trabajando</span>
    <span v-if="store.needCount" class="flex items-center gap-1 font-semibold text-state-waiting"><i class="size-2 rounded-full bg-state-waiting" />{{ store.needCount }} te necesita</span>
  </span>
</template>
