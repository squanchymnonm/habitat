<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { useGoToSession } from '../../composables/useGoToSession'
import { STATUS_LABEL, STATE_TOKEN, type Session } from '../../types'
import { ago } from '../../sprites'
import SessionAvatar from './SessionAvatar.vue'
import { cn } from '@/lib/utils'

// Pantalla principal del celular: filas grandes, "te necesita" primero.
const store = useSessions()
const goTo = useGoToSession()
const needs = (s: Session) => s.status === 'waiting' || s.status === 'error'
const rows = computed(() => [...store.list.filter(needs), ...store.list.filter((s) => !needs(s))])
// Clases literales para que Tailwind las detecte.
const TXT: Record<string, string> = { working: 'text-state-working', waiting: 'text-state-waiting', done: 'text-state-done', idle: 'text-muted', error: 'text-state-error' }
</script>

<template>
  <ul data-test="session-list" class="m-0 flex list-none flex-col gap-2 overflow-y-auto p-3">
    <li v-for="s in rows" :key="s.id">
      <button data-test="session-row" :data-id="s.id" type="button" @click="goTo(s.id)"
        :class="cn('flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[calc(var(--radius)+4px)] border-0 bg-surface px-3 py-2 text-left font-[inherit] text-text hover:bg-surface-raised',
          needs(s) && 'ring-1 ring-state-waiting', s.status === 'offline' && 'opacity-60')">
        <SessionAvatar :session="s" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-2">
            <b class="min-w-0 truncate font-semibold">{{ s.name }}</b>
            <span :class="cn('shrink-0 text-xs font-semibold', TXT[STATE_TOKEN[s.status]])">{{ STATUS_LABEL[s.status] }}</span>
          </span>
          <span class="truncate text-xs text-muted">{{ s.project }}<template v-if="s.branch"> · {{ s.branch }}</template></span>
          <span v-if="s.action" class="truncate text-xs text-text">{{ s.action }} <span class="text-muted">· hace {{ ago(s.since) }}</span></span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted" />
      </button>
    </li>
  </ul>
</template>
