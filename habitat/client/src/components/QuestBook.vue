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
    <div class="qb-book">
      <button class="qb-close" @click="emit('close')" aria-label="cerrar">✕</button>

      <div v-if="loading" class="qb-msg">Abriendo el libro…</div>
      <div v-else-if="error" class="qb-msg">No se pudo abrir el libro ({{ error }})</div>
      <template v-else-if="book">
        <header class="qb-head">
          <div class="qb-syn">{{ book.synopsis || 'Sin sinopsis' }}</div>
          <div class="qb-prog">{{ done }}/{{ total }} quests</div>
        </header>

        <section class="qb-quests">
          <div v-if="!book.quests.length" class="qb-empty">Sin quests registradas.</div>
          <div v-for="q in book.quests" :key="q.id" class="qb-quest" :class="q.status">
            <div class="qb-qrow" @click="toggle(q.id)">
              <img class="qb-qicon" :class="{ prog: q.status === 'in_progress' }" :src="questIcon(q.status)" alt="" />
              <span class="qb-qtitle">{{ q.title }}</span>
            </div>
            <div v-if="expanded === q.id" class="qb-qdetail">
              <p v-if="q.originPrompt && !q.loose"><b>Pedido:</b> {{ q.originPrompt }}</p>

              <div v-if="!q.dialogue.length" class="qb-empty">Sin diálogo todavía.</div>
              <div v-for="(ex, i) in q.dialogue" :key="i" class="qb-ex">
                <div class="qb-ex-claude" @click="toggleText(exKey(q.id, i))">
                  <span class="qb-ex-tag">🗨️ Claude</span>
                  <span class="qb-ex-time">{{ ago(ex.ts) }}</span>
                  <span class="qb-ex-text" :class="{ clamp: !openText.has(exKey(q.id, i)) }">{{ ex.claude }}</span>
                </div>
                <div class="qb-ex-you">
                  <span class="qb-ex-tag">✍️ Vos</span>
                  <span class="qb-ex-text">{{ ex.you || '…esperando tu respuesta' }}</span>
                </div>
              </div>

              <p v-if="q.monster" class="qb-ex-loot"><b>Vencido:</b> {{ q.monster }} · {{ q.damage }} dmg · {{ q.hits }} golpes</p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.qb-overlay { position: absolute; inset: 0; background: #0008; display: flex; justify-content: center; align-items: stretch; z-index: 20; }
.qb-book {
  position: relative; margin: 14px; flex: 1; max-width: 560px; overflow-y: auto;
  background: #2a1d0e url('/assets/ui/scroll-bg.png') top center / 100% auto no-repeat;
  border: 2px solid #c8a860; border-radius: 10px; box-shadow: 0 8px 26px #000a;
  color: #e8d4a8; font-family: var(--f-ui); padding: 16px 18px;
}
.qb-close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: #e8d4a8; font-size: 16px; cursor: pointer; }
.qb-msg { padding: 30px 6px; color: #cbb586; }
.qb-head { border-bottom: 1px solid #6b5836; padding-bottom: 10px; margin-bottom: 10px; }
.qb-syn { font-size: 14px; font-weight: bold; line-height: 1.35; }
.qb-prog { font-size: 11px; color: #cbb586; margin-top: 4px; }
.qb-quests { display: flex; flex-direction: column; gap: 4px; }
.qb-quest { border-radius: 6px; }
.qb-qrow { display: flex; align-items: center; gap: 8px; padding: 5px 4px; cursor: pointer; }
.qb-qrow:hover { background: #ffffff14; }
.qb-qicon { width: 18px; height: 18px; image-rendering: pixelated; }
.qb-qicon.prog { animation: qb-pulse 1.1s ease-in-out infinite; }
@keyframes qb-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.8); } }
.qb-quest.completed .qb-qtitle { color: #bda; text-decoration: line-through; opacity: 0.85; }
.qb-qtitle { font-size: 12px; }
.qb-qdetail { padding: 4px 8px 8px 30px; font-size: 11px; color: #d8c69e; }
.qb-qdetail p { margin: 3px 0; }
.qb-ex { margin: 6px 0; padding-left: 4px; border-left: 2px solid #6b5836; }
.qb-ex-claude { cursor: pointer; }
.qb-ex-you { margin-top: 2px; }
.qb-ex-tag { font-size: 10px; color: #cbb586; margin-right: 6px; }
.qb-ex-time { font-size: 10px; color: #9a8a6a; margin-right: 6px; }
.qb-ex-text { font-size: 11px; color: #e8d4a8; white-space: pre-wrap; }
.qb-ex-text.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qb-ex-you .qb-ex-text { color: #bda; }
.qb-ex-loot { margin: 6px 0 0; font-size: 11px; color: #d8c69e; }
.qb-empty { font-size: 11px; color: #9a8a6a; padding: 6px 2px; }
</style>
