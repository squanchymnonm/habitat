<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { postOrder } from '../../composables/useSessionOrder'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { STATUS_LABEL, STATE_TOKEN, type Session } from '../../types'
import SessionAvatar from './SessionAvatar.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useGoToSession } from '../../composables/useGoToSession'

const store = useSessions()
const goTo = useGoToSession()
const { collapsed, toggleCollapsed } = useLayoutMode()
// vuedraggable v-model: aplica el orden local (optimista) y lo persiste; el WS sincroniza otros clientes.
const items = computed<Session[]>({
  get: () => store.list,
  set: (val) => { const ids = val.map((s) => s.id); store.reorder(ids); postOrder(ids) },
})
// Clases literales (no interpoladas) para que Tailwind las detecte.
const INFRA_DOT: Record<string, string> = { up: 'bg-state-done', partial: 'bg-state-working', off: 'bg-state-idle' }
const TXT: Record<string, string> = { working: 'text-state-working', waiting: 'text-state-waiting', done: 'text-state-done', idle: 'text-muted', error: 'text-state-error' }
// vuedraggable no tipa el slot `element`; esta función sólo acota el tipo al indexar STATUS_LABEL.
const statusLabel = (s: Session) => STATUS_LABEL[s.status]
const statusClass = (s: Session) => TXT[STATE_TOKEN[s.status]]
</script>

<template>
  <aside
    data-test="session-sidebar"
    :class="cn('flex h-full flex-col border-r border-border bg-surface transition-[width] duration-150 motion-reduce:transition-none', collapsed ? 'collapsed w-14' : 'w-56')"
  >
    <TooltipProvider :delay-duration="300">
      <draggable v-model="items" item-key="id" tag="div" class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
        :animation="150" :delay="200" :delay-on-touch-only="true">
        <!-- Raíz real del item: TooltipRoot (reka) renderiza un fragmento y vuedraggable
             necesita un elemento donde colgar __draggable_context, si no el drag revienta.
             (El comentario va acá afuera: dentro del slot cuenta como un hijo más.) -->
        <template #item="{ element: s }">
          <div data-test="session-item-root">
          <Tooltip :disabled="!collapsed">
            <TooltipTrigger as-child>
              <button
                data-test="session-item" type="button"
                :aria-current="store.selectedId === s.id ? 'true' : undefined"
                :class="cn('flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius)] border-0 bg-transparent p-1.5 text-left font-[inherit] text-inherit hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent',
                  store.selectedId === s.id && 'bg-surface-raised shadow-[inset_2px_0_0_var(--accent)]', collapsed && 'justify-center')"
                @click="goTo(s.id)"
              >
                <SessionAvatar :session="s" />
                <span v-if="!collapsed" class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span data-test="session-name" class="min-w-0 truncate font-semibold text-text">{{ s.name }}</span>
                    <span v-if="s.infra?.dir" data-test="infra-dot" :class="cn('size-1.5 shrink-0 rounded-full', INFRA_DOT[s.infra.state ?? 'off'])" :title="`infra: ${s.infra.state ?? 'off'}`" />
                  </span>
                  <span class="block truncate text-xs text-muted">{{ s.project }}<template v-if="s.branch"> · {{ s.branch }}</template></span>
                  <span data-test="session-status" class="block truncate text-xs" :class="statusClass(s)">{{ statusLabel(s) }}</span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{{ s.name }} · {{ statusLabel(s) }}</TooltipContent>
          </Tooltip>
          </div>
        </template>
      </draggable>
    </TooltipProvider>
    <button data-test="nav-collapse" type="button"
      class="m-2 flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border-0 bg-transparent p-2 text-sm font-[inherit] text-muted hover:bg-surface-raised hover:text-text"
      :aria-label="collapsed ? 'Expandir barra de sesiones' : 'Colapsar barra de sesiones'" @click="toggleCollapsed">
      <PanelLeftOpen v-if="collapsed" class="size-4" /><PanelLeftClose v-else class="size-4" />
      <span v-if="!collapsed">Colapsar</span>
    </button>
  </aside>
</template>
