<script setup lang="ts">
import SessionAvatar from '../sessions/SessionAvatar.vue'
import { useGoToSession } from '../../composables/useGoToSession'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()
const goTo = useGoToSession()
</script>

<template>
  <button data-test="board-card" type="button" @click="goTo(props.session.id)"
    :class="cn('flex min-h-10 w-full cursor-pointer items-start gap-3 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-3 text-left font-[inherit] text-text hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent',
      session.status === 'offline' && 'opacity-60')">
    <SessionAvatar :session="session" />
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <b class="min-w-0 truncate text-sm font-semibold">{{ session.name }}</b>
        <span v-if="session.status === 'offline'" class="shrink-0 rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted">caída</span>
      </span>
      <span class="truncate text-xs text-muted">{{ session.project }}<template v-if="session.branch"> · {{ session.branch }}</template></span>
      <span v-if="session.action" class="truncate text-xs text-text">{{ session.action }}</span>
    </span>
  </button>
</template>
