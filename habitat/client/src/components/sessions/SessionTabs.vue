<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { ChevronsUp, ChevronsDown } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { postOrder } from '../../composables/useSessionOrder'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { STATUS_LABEL, type Session } from '../../types'
import SessionAvatar from './SessionAvatar.vue'
import { cn } from '@/lib/utils'

const store = useSessions()
const { collapsed, toggleCollapsed, mode } = useLayoutMode()
const items = computed<Session[]>({
  get: () => store.list,
  set: (val) => { const ids = val.map((s) => s.id); store.reorder(ids); postOrder(ids) },
})
// Clases literales (no interpoladas) para que Tailwind las detecte.
const INFRA_DOT: Record<string, string> = { up: 'bg-state-done', partial: 'bg-state-working', off: 'bg-state-idle' }
// vuedraggable no tipa el slot `element`; esta función sólo acota el tipo al indexar STATUS_LABEL.
const statusLabel = (s: Session) => STATUS_LABEL[s.status]
// La rueda vertical scrollea las pestañas en horizontal.
function onWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.scrollWidth > el.clientWidth && e.deltaY) { el.scrollLeft += e.deltaY; e.preventDefault() }
}
</script>

<template>
  <nav data-test="session-tabs" :class="cn('flex items-end gap-1 border-b border-border bg-surface px-2 pt-1.5', collapsed && 'collapsed')">
    <draggable v-model="items" item-key="id" tag="div" class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
      :animation="150" :delay="200" :delay-on-touch-only="true" @wheel="onWheel">
      <template #item="{ element: s }">
        <button
          data-test="session-item" type="button" :title="`${s.name} · ${statusLabel(s)}`"
          :aria-current="store.selectedId === s.id ? 'true' : undefined"
          :class="cn('flex shrink-0 items-center gap-2 rounded-t-[var(--radius)] px-2.5 py-1.5 text-sm text-muted hover:text-text min-h-10',
            store.selectedId === s.id ? 'bg-surface-raised text-text shadow-[inset_0_2px_0_var(--accent)]' : 'bg-background/40')"
          @click="store.select(s.id)"
        >
          <SessionAvatar :session="s" size="sm" />
          <span v-if="!collapsed" class="flex min-w-0 max-w-32 items-center gap-1.5">
            <span data-test="session-name" class="min-w-0 truncate font-medium">{{ s.name }}</span>
            <span v-if="s.infra?.dir" data-test="infra-dot" :class="cn('size-1.5 shrink-0 rounded-full', INFRA_DOT[s.infra.state ?? 'off'])" :title="`infra: ${s.infra.state ?? 'off'}`" />
          </span>
        </button>
      </template>
    </draggable>
    <button v-if="mode !== 'phone'" data-test="nav-collapse" type="button"
      class="mb-1 rounded-[var(--radius)] p-2 text-muted hover:bg-surface-raised hover:text-text"
      :aria-label="collapsed ? 'Expandir pestañas' : 'Colapsar pestañas'" @click="toggleCollapsed">
      <ChevronsDown v-if="collapsed" class="size-4" /><ChevronsUp v-else class="size-4" />
    </button>
  </nav>
</template>
