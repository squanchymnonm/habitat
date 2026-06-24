<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useQuestBook } from '../composables/useQuestBook'
import { questIcon } from '../composables/questIcons'
import { ago } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { book, loading, error, load } = useQuestBook()
const expanded = ref<string | null>(null)

watch(() => props.id, (id) => { if (id) load(id) }, { immediate: true })

const total = computed(() => book.value?.quests.length ?? 0)
const done = computed(() => book.value?.quests.filter((q) => q.status === 'completed').length ?? 0)
const pct = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0))

function toggle(id: string) { expanded.value = expanded.value === id ? null : id }
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
                <p v-if="q.originPrompt"><span class="qb-dt">Pedido</span>{{ q.originPrompt }}</p>
                <p v-if="q.claudeSummary"><span class="qb-dt">Resumen</span>{{ q.claudeSummary }}</p>
                <p v-if="q.monster" class="qb-loot"><span class="qb-dt">Vencido</span>{{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
                <p v-if="!q.originPrompt && !q.claudeSummary && !q.monster" class="qb-muted">Sin detalle registrado.</p>
              </div>
            </li>
          </ul>
        </section>

        <section class="qb-section">
          <div class="qb-label">Eventos</div>
          <div v-if="!book.events.length" class="qb-empty">Sin eventos.</div>
          <ul v-else class="qb-events">
            <li v-for="(e, i) in [...book.events].reverse()" :key="e.ts + '-' + i" class="qb-event" :class="e.type">
              <span class="qb-dot" aria-hidden="true"></span>
              <div class="qb-ebody">
                <span class="qb-elabel">{{ e.label }}</span>
                <span v-if="e.detail" class="qb-edetail">{{ e.detail }}</span>
              </div>
              <time class="qb-etime">{{ ago(e.ts) }}</time>
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
  background: var(--surface); color: var(--ink); font-family: var(--f-ui);
  border: 1px solid var(--soft); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .5), var(--bevel);
  padding: 22px 22px 26px;
  animation: qb-rise 180ms ease-out;
}
.qb-close {
  position: absolute; top: 10px; right: 10px; width: 32px; height: 32px;
  display: grid; place-items: center; background: transparent;
  border: 1px solid transparent; border-radius: 8px; color: var(--dim);
  font-size: 18px; cursor: pointer; transition: background 150ms, color 150ms;
}
.qb-close:hover { background: rgba(255, 255, 255, .06); color: var(--ink); }
.qb-close:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }

.qb-state { padding: 48px 8px; text-align: center; color: var(--dim); font-size: 15px; }

/* Header */
.qb-head { margin-bottom: 22px; padding-right: 32px; }
.qb-kicker { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
.qb-syn { font-family: var(--f-body); font-size: 22px; font-weight: 700; line-height: 1.3; margin: 0; color: var(--ink); }
.qb-progrow { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.qb-bar { flex: 1; height: 8px; border-radius: 99px; background: rgba(0, 0, 0, .35); overflow: hidden; box-shadow: var(--bevel); }
.qb-bar-fill { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--gold), var(--coral)); box-shadow: var(--glow-gold); transition: width 300ms ease-out; }
.qb-count { font-size: 13px; color: var(--dim); font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

/* Sections */
.qb-section + .qb-section { margin-top: 22px; }
.qb-label { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--gold); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.qb-empty { font-size: 14px; color: var(--dim); padding: 8px 2px; font-style: italic; }

/* Quests */
.qb-quests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.qb-qrow {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px 8px;
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  color: var(--ink); text-align: left; font: inherit; transition: background 150ms;
}
.qb-qrow:hover { background: rgba(255, 255, 255, .05); }
.qb-qrow:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
.qb-qicon { width: 20px; height: 20px; image-rendering: pixelated; flex: 0 0 auto; }
.qb-qicon.prog { animation: qb-pulse 1.2s ease-in-out infinite; }
.qb-qtitle { flex: 1; font-size: 15px; line-height: 1.35; }
.qb-chev { flex: 0 0 auto; color: var(--dim); transition: transform 180ms ease; }
.qb-quest.open .qb-chev { transform: rotate(180deg); }
.qb-quest.completed .qb-qtitle { color: var(--dim); text-decoration: line-through; }
.qb-quest.in_progress .qb-qtitle { color: var(--coral); }

.qb-qdetail {
  margin: 2px 0 8px 30px; padding: 10px 12px; border-left: 2px solid var(--soft);
  border-radius: 0 8px 8px 0; background: rgba(0, 0, 0, .22);
  font-family: var(--f-body); font-size: 14px; line-height: 1.5; color: var(--ink);
}
.qb-qdetail p { margin: 0 0 8px; }
.qb-qdetail p:last-child { margin-bottom: 0; }
.qb-dt { display: block; font-family: var(--f-ui); font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--dim); margin-bottom: 2px; }
.qb-loot { color: var(--coral); }
.qb-muted { color: var(--dim); font-style: italic; }

/* Events */
.qb-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.qb-event { display: flex; align-items: flex-start; gap: 10px; padding: 8px 4px; border-top: 1px solid rgba(255, 255, 255, .04); }
.qb-event:first-child { border-top: none; }
.qb-dot { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: var(--dim); }
.qb-ebody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qb-elabel { font-size: 14px; line-height: 1.35; color: var(--ink); }
.qb-edetail { font-size: 12px; color: var(--dim); }
.qb-etime { flex: 0 0 auto; font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.qb-event.quest_completed .qb-dot, .qb-event.dungeon_cleared .qb-dot { background: var(--green); }
.qb-event.boss_defeated .qb-dot { background: var(--gold); }
.qb-event.error .qb-dot { background: var(--red); }
.qb-event.waiting .qb-dot { background: var(--coral); }
.qb-event.cleared .qb-dot { background: var(--lav); }

@keyframes qb-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.7); } }
@keyframes qb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes qb-rise { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .qb-overlay, .qb-book { animation: none; }
  .qb-qicon.prog { animation: none; }
  .qb-bar-fill, .qb-chev, .qb-close, .qb-qrow { transition: none; }
}
</style>
