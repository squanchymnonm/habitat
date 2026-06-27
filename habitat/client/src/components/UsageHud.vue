<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useUsage } from '../composables/useUsage'
import { dialPositions } from '../composables/useDayNight'

const { usage, mana, resetLabel, cyclePos } = useUsage()

const used = computed(() => (usage.value ? usage.value.pct : 0))
const moteSrc = computed(() => {
  if (used.value >= 90) return 'assets/emote/22.png'
  if (used.value >= 75) return 'assets/emote/21.png'
  return ''
})

// Dial ☀️/🌙: aplicar translateY por refs y suprimir la transición en el salto de reaparición.
const sunEl = ref<HTMLElement | null>(null)
const moonEl = ref<HTMLElement | null>(null)
let prevSun = 120, prevMoon = 0
function setY(el: HTMLElement | null, y: number, prev: number) {
  if (!el) return
  el.style.transition = Math.abs(y - prev) > 200 ? 'none' : 'transform .5s ease'
  el.style.transform = `translateY(${y}%)`
}
watch(cyclePos, (p) => {
  const { sun, moon } = dialPositions(p)
  setY(sunEl.value, sun, prevSun); setY(moonEl.value, moon, prevMoon)
  prevSun = sun; prevMoon = moon
}, { immediate: true })
</script>

<template>
  <div class="usage-hud" v-if="usage">
    <div class="mana-box">
      <span class="mana-lbl">Maná</span>
      <span class="mana-track"><i class="mana-fill" :style="{ width: (mana ?? 0) + '%' }"></i></span>
      <img v-if="moteSrc" class="usage-mote" :src="moteSrc" alt="" />
    </div>
    <div class="time-box">
      <span class="dn"><span class="dn-sun" ref="sunEl">☀️</span><span class="dn-moon" ref="moonEl">🌙</span></span>
      <span class="time-lbl">próxima</span>
      <span class="time-val">{{ resetLabel }}</span>
    </div>
  </div>
</template>
