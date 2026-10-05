<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useQuestBook } from '../../composables/useQuestBook'
import { questIcon } from '../../composables/questIcons'
import { ago } from '../../sprites'

const props = defineProps<{ sessionId: string }>()

const { book, loading, error, load } = useQuestBook()
const expanded = ref<string | null>(null)
// intercambios de Claude expandidos: clave `${questId}:${index}`
const openText = ref<Set<string>>(new Set())

watch(() => props.sessionId, (id) => { if (id) load(id) }, { immediate: true })

// El progreso X/Y cuenta solo quests de plan (no la quest suelta de la sesión).
const planQuests = computed(() => book.value?.quests.filter((q) => !q.loose) ?? [])
const total = computed(() => planQuests.value.length)
const done = computed(() => planQuests.value.filter((q) => q.status === 'completed').length)
const pct = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0))

function toggle(id: string) { expanded.value = expanded.value === id ? null : id }
function exKey(qid: string, i: number) { return `${qid}:${i}` }
function toggleText(key: string) {
  const next = new Set(openText.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  openText.value = next
}

const TITLE_COLOR: Record<string, string> = { completed: 'text-muted line-through', in_progress: 'text-state-working' }
function titleClass(status: string) { return TITLE_COLOR[status] ?? 'text-text' }
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div v-if="loading" class="py-12 text-center text-sm text-muted">Abriendo el libro…</div>
    <div v-else-if="error" class="py-12 text-center text-sm text-muted">No se pudo abrir el libro ({{ error }})</div>
    <template v-else-if="book">
      <header class="mb-4">
        <div class="text-xs uppercase tracking-wider text-muted">Quest Book</div>
        <h2 class="m-0 mt-1 font-display text-lg text-text">{{ book.synopsis || 'Sin sinopsis' }}</h2>
        <div class="mt-3 flex items-center gap-3">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
            <span class="block h-full rounded-full bg-accent" :style="{ width: pct + '%' }"></span>
          </div>
          <span data-test="quest-progress" class="shrink-0 font-mono text-xs text-muted">{{ done }}/{{ total }}</span>
        </div>
      </header>

      <div v-if="!book.quests.length" class="text-sm italic text-muted">Sin quests registradas todavía.</div>
      <ul v-else class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="q in book.quests" :key="q.id">
          <button
            type="button"
            data-test="quest-row"
            class="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] text-text hover:bg-surface-raised"
            :aria-expanded="expanded === q.id"
            @click="toggle(q.id)"
          >
            <img class="pixel size-4 shrink-0" :src="questIcon(q.status)" alt="" />
            <span class="flex-1 text-sm" :class="titleClass(q.status)">{{ q.title }}</span>
            <ChevronDown class="size-4 shrink-0 text-muted transition-transform" :class="{ 'rotate-180': expanded === q.id }" />
          </button>
          <div v-if="expanded === q.id" class="ml-6 border-l border-border py-2 pl-3">
            <p v-if="q.originPrompt && !q.loose" class="m-0 mb-2 text-sm text-text">
              <span class="mb-0.5 block text-[11px] uppercase tracking-wide text-muted">Pedido</span>{{ q.originPrompt }}
            </p>

            <div v-if="!q.dialogue.length" class="text-sm italic text-muted">Sin diálogo todavía.</div>
            <div v-for="(ex, i) in q.dialogue" :key="i" class="mt-2 border-l border-border pl-2.5">
              <button
                type="button"
                class="flex w-full cursor-pointer flex-col gap-0.5 border-0 bg-transparent p-0 text-left font-[inherit] text-text"
                :aria-expanded="openText.has(exKey(q.id, i))"
                @click="toggleText(exKey(q.id, i))"
              >
                <span class="flex items-baseline gap-2">
                  <span class="text-[11px] text-muted">🗨️ Claude</span>
                  <time class="text-[11px] text-muted">{{ ago(ex.ts) }}</time>
                </span>
                <span class="whitespace-pre-wrap text-sm text-text" :class="{ 'line-clamp-2': !openText.has(exKey(q.id, i)) }">{{ ex.claude }}</span>
              </button>
              <div class="mt-1.5 flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">✍️ Vos</span>
                <span class="whitespace-pre-wrap text-sm text-state-done">{{ ex.you || '…esperando tu respuesta' }}</span>
              </div>
            </div>

            <p v-if="q.monster" class="mt-2 text-xs text-muted">Vencido: {{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
