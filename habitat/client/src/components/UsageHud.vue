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
    <div class="mana" title="Uso de Claude restante (ventana 5h)">
      <span class="mana-lbl">Maná</span>
      <span class="mana-track"><i class="mana-fill" :style="{ width: (mana ?? 0) + '%' }"></i></span>
      <img v-if="moteSrc" class="mana-mote" :src="moteSrc" alt="" />
    </div>
    <div class="reset" title="Tiempo hasta el reset · ciclo día/noche">
      <span class="dial"><span class="dn-sun" ref="sunEl">☀️</span><span class="dn-moon" ref="moonEl">🌙</span></span>
      <span class="reset-lbl">próxima</span>
      <span class="reset-val">{{ resetLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.usage-hud{ display:inline-flex; align-items:center; gap:10px; }
.mana{ display:inline-flex; align-items:center; gap:8px; padding:6px 11px; border-radius:999px;
  background:var(--color-surface); border:1px solid #214a63; color:#bfe2ff; font-size:12px; position:relative; }
.mana-lbl{ font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:#9cd0f2; }
.mana-track{ position:relative; width:70px; height:8px; border-radius:5px; background:#0c1016; overflow:hidden;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.5); }
.mana-fill{ position:absolute; inset:0 auto 0 0; height:100%; border-radius:5px;
  background:linear-gradient(90deg,#2f86d8,var(--color-mana)); box-shadow:0 0 9px rgba(63,168,255,.8);
  transition:width .5s linear; }
.mana-fill::before{ content:""; position:absolute; top:0; left:0; right:0; height:2px; background:#9fd6ff; }
.mana-mote{ position:absolute; right:6px; top:50%; margin-top:-10px; width:20px; height:20px; image-rendering:pixelated; }
.reset{ display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border-radius:999px;
  background:var(--color-surface); border:1px solid var(--color-edge); color:var(--color-dim); font-size:12px; }
.dial{ position:relative; width:20px; height:18px; overflow:hidden; flex:0 0 auto; }
.dial span{ position:absolute; left:0; right:0; text-align:center; font-size:14px; line-height:18px; transform:translateY(120%); }
.reset-lbl{ font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--color-faint); }
.reset-val{ font-family:var(--font-machine); color:var(--color-ink-2); font-variant-numeric:tabular-nums; }
</style>
