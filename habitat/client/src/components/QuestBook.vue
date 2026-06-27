<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useQuestBook } from '../composables/useQuestBook'
import { questIcon } from '../composables/questIcons'
import { ago } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { book, loading, error, load } = useQuestBook()
const expanded = ref<string | null>(null)
// intercambios de Claude expandidos: clave `${questId}:${index}`
const openText = ref<Set<string>>(new Set())

watch(() => props.id, (id) => { if (id) load(id) }, { immediate: true })

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
</script>

<template>
  <div class="qb-overlay" @click.self="emit('close')">
    <div class="qb-book" role="dialog" aria-label="Quest Book">
      <button class="qb-close" @click="emit('close')" aria-label="cerrar">✕</button>

      <div v-if="loading" class="qb-state">Abriendo el libro…</div>
      <div v-else-if="error" class="qb-state">No se pudo abrir el libro ({{ error }})</div>
      <template v-else-if="book">
        <header class="qb-head">
          <div class="qb-kicker">Quest Book</div>
          <h2 class="qb-syn">{{ book.synopsis || 'Sin sinopsis' }}</h2>
          <div class="qb-progrow">
            <div class="qb-bar"><span class="qb-bar-fill" :style="{ width: pct + '%' }"></span></div>
            <div class="qb-count">{{ done }}/{{ total }}</div>
          </div>
        </header>

        <section class="qb-section">
          <div class="qb-label">Quests</div>
          <div v-if="!book.quests.length" class="qb-empty">Sin quests registradas todavía.</div>
          <ul v-else class="qb-quests">
            <li v-for="q in book.quests" :key="q.id" class="qb-quest" :class="[q.status, { open: expanded === q.id }]">
              <button class="qb-qrow" @click="toggle(q.id)" :aria-expanded="expanded === q.id">
                <img class="qb-qicon" :class="{ prog: q.status === 'in_progress' }" :src="questIcon(q.status)" alt="" />
                <span class="qb-qtitle">{{ q.title }}</span>
                <svg class="qb-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <div v-if="expanded === q.id" class="qb-qdetail">
                <p v-if="q.originPrompt && !q.loose"><span class="qb-dt">Pedido</span>{{ q.originPrompt }}</p>

                <div v-if="!q.dialogue.length" class="qb-muted">Sin diálogo todavía.</div>
                <div v-for="(ex, i) in q.dialogue" :key="i" class="qb-ex">
                  <button
                    class="qb-ex-claude"
                    @click="toggleText(exKey(q.id, i))"
                    :aria-expanded="openText.has(exKey(q.id, i))"
                  >
                    <span class="qb-ex-head">
                      <span class="qb-ex-tag">🗨️ Claude</span>
                      <time class="qb-ex-time">{{ ago(ex.ts) }}</time>
                    </span>
                    <span class="qb-ex-text" :class="{ clamp: !openText.has(exKey(q.id, i)) }">{{ ex.claude }}</span>
                  </button>
                  <div class="qb-ex-you">
                    <span class="qb-ex-tag">✍️ Vos</span>
                    <span class="qb-ex-text qb-ex-you-text">{{ ex.you || '…esperando tu respuesta' }}</span>
                  </div>
                </div>

                <p v-if="q.monster" class="qb-loot"><span class="qb-dt">Vencido</span>{{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.qb-overlay {
  position: absolute; inset: 0; z-index: 20;
  display: flex; justify-content: center; align-items: stretch;
  background: rgba(0, 0, 0, .58); backdrop-filter: blur(2px);
  animation: qb-fade 160ms ease-out;
}
.qb-book {
  position: relative; margin: 16px; flex: 1; max-width: 580px; overflow-y: auto;
  background: var(--color-surface-2); color: var(--color-ink); font-family: var(--font-system);
  border: 1px solid var(--color-edge); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .5), var(--shadow-sh1);
  padding: 22px 22px 26px;
  animation: qb-rise 180ms ease-out;
}
.qb-close {
  position: absolute; top: 10px; right: 10px; width: 32px; height: 32px;
  display: grid; place-items: center; background: transparent;
  border: 1px solid transparent; border-radius: 8px; color: var(--color-dim);
  font-size: 18px; cursor: pointer; transition: background 150ms, color 150ms;
}
.qb-close:hover { background: rgba(255, 255, 255, .06); color: var(--color-ink); }
.qb-close:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 1px; }

.qb-state { padding: 48px 8px; text-align: center; color: var(--color-dim); font-size: 15px; }

/* Header */
.qb-head { margin-bottom: 22px; padding-right: 32px; }
.qb-kicker { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--color-brass); margin-bottom: 6px; }
.qb-syn { font-family: var(--font-lore); font-size: 22px; font-weight: 700; line-height: 1.3; margin: 0; color: var(--color-ink); }
.qb-progrow { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.qb-bar { flex: 1; height: 8px; border-radius: 99px; background: rgba(0, 0, 0, .35); overflow: hidden; box-shadow: var(--shadow-sh1); }
.qb-bar-fill { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--color-brass), var(--color-amber)); box-shadow: var(--shadow-glow-brass); transition: width 300ms ease-out; }
.qb-count { font-size: 13px; color: var(--color-dim); font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

/* Sections */
.qb-section + .qb-section { margin-top: 22px; }
.qb-label { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--color-brass); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--color-edge); }
.qb-empty { font-size: 14px; color: var(--color-dim); padding: 8px 2px; font-style: italic; }

/* Quests */
.qb-quests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.qb-qrow {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px 8px;
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  color: var(--color-ink); text-align: left; font: inherit; transition: background 150ms;
}
.qb-qrow:hover { background: rgba(255, 255, 255, .05); }
.qb-qrow:focus-visible { outline: 2px solid var(--color-brass); outline-offset: -2px; }
.qb-qicon { width: 20px; height: 20px; image-rendering: pixelated; flex: 0 0 auto; }
.qb-qicon.prog { animation: qb-pulse 1.2s ease-in-out infinite; }
.qb-qtitle { flex: 1; font-size: 15px; line-height: 1.35; }
.qb-chev { flex: 0 0 auto; color: var(--color-dim); transition: transform 180ms ease; }
.qb-quest.open .qb-chev { transform: rotate(180deg); }
.qb-quest.completed .qb-qtitle { color: var(--color-dim); text-decoration: line-through; }
.qb-quest.in_progress .qb-qtitle { color: var(--color-amber); }

.qb-qdetail {
  margin: 2px 0 8px 30px; padding: 10px 12px; border-left: 2px solid var(--color-edge);
  border-radius: 0 8px 8px 0; background: rgba(0, 0, 0, .22);
  font-family: var(--font-system); font-size: 14px; line-height: 1.5; color: var(--color-ink);
}
.qb-qdetail p { margin: 0 0 8px; }
.qb-qdetail p:last-child { margin-bottom: 0; }
.qb-dt { display: block; font-family: var(--font-system); font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--color-dim); margin-bottom: 2px; }
.qb-loot { color: var(--color-amber); margin-top: 8px; }
.qb-muted { color: var(--color-dim); font-style: italic; }

/* Diálogo (pregunta de Claude ↔ tu respuesta) */
.qb-ex { margin-top: 10px; padding-left: 10px; border-left: 2px solid var(--color-edge); }
.qb-ex:first-of-type { margin-top: 4px; }
.qb-ex-claude {
  display: flex; flex-direction: column; gap: 3px; width: 100%;
  background: transparent; border: none; padding: 0; margin: 0;
  color: var(--color-ink); text-align: left; font: inherit; cursor: pointer;
}
.qb-ex-claude:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 2px; }
.qb-ex-head { display: flex; align-items: baseline; gap: 8px; }
.qb-ex-you { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.qb-ex-tag { font-family: var(--font-system); font-size: 11px; letter-spacing: .5px; color: var(--color-dim); }
.qb-ex-time { font-size: 11px; color: var(--color-dim); font-variant-numeric: tabular-nums; }
.qb-ex-text { font-size: 14px; line-height: 1.5; color: var(--color-ink); white-space: pre-wrap; }
.qb-ex-text.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qb-ex-you-text { color: var(--color-moss); }

@keyframes qb-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.7); } }
@keyframes qb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes qb-rise { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .qb-overlay, .qb-book { animation: none; }
  .qb-qicon.prog { animation: none; }
  .qb-bar-fill, .qb-chev, .qb-close, .qb-qrow { transition: none; }
}
</style>
