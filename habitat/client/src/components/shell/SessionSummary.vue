<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../../stores/sessions'

const store = useSessions()
const working = computed(() => store.list.filter((s) => s.status === 'working').length)
</script>

<template>
  <span data-test="session-summary" class="flex min-w-0 items-center gap-2 overflow-hidden text-sm text-muted tabular-nums">
    <b class="text-text">{{ store.list.length }}</b>
    <span v-if="working" class="hidden items-center gap-1 sm:flex"><i class="size-2 rounded-full bg-state-working" />{{ working }} trabajando</span>
    <!-- En teléfono sólo números: el texto "te necesita" aparece desde sm. -->
    <span v-if="store.needCount" data-test="need-count" class="flex shrink-0 items-center gap-1 font-semibold text-state-waiting" :title="`${store.needCount} te necesita`"><i class="size-2 rounded-full bg-state-waiting" />{{ store.needCount }}<span data-test="need-label" class="hidden sm:inline"> te necesita</span></span>
  </span>
</template>
