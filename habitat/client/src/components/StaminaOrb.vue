<script setup lang="ts">
// Orbe de stamina estilo RPG (Receptacle Sphere): marco de madera + líquido que
// llena desde abajo + brillo de vidrio. value: 0..100 = context restante.
const props = defineProps<{ value: number }>()
const pct = () => Math.max(0, Math.min(100, props.value))
const color = () => (pct() > 50 ? 'green' : pct() > 20 ? 'yellow' : 'red')
</script>

<template>
  <div class="orb" :title="'STAMINA ' + Math.round(pct()) + '%'">
    <div class="orb-frame"></div>
    <div class="orb-fill" :class="color()" :style="{ height: pct() + '%' }"></div>
    <div class="orb-over"></div>
    <span class="orb-pct">{{ Math.round(pct()) }}</span>
  </div>
</template>

<style scoped>
.orb {
  position: relative;
  width: 56px;
  height: 56px;
  image-rendering: pixelated;
  flex: 0 0 auto;
}
.orb-frame {
  position: absolute;
  inset: 0;
  background: url('/assets/ui/orb-bg.png') no-repeat;
  background-size: 56px 56px;
}
/* el socket del marco 32x32 está centrado ~22x22 -> inset 16% */
.orb-fill {
  position: absolute;
  left: 16%;
  right: 16%;
  bottom: 16%;
  background-repeat: no-repeat;
  background-position: bottom;
  background-size: 38px 38px;
  transition: height 0.4s steps(8);
}
.orb-fill.green {
  background-image: url('/assets/ui/orb-green.png');
}
.orb-fill.yellow {
  background-image: url('/assets/ui/orb-yellow.png');
}
.orb-fill.red {
  background-image: url('/assets/ui/orb-red.png');
}
.orb-over {
  position: absolute;
  inset: 0;
  background: url('/assets/ui/orb-over.png') no-repeat;
  background-size: 56px 56px;
  pointer-events: none;
}
.orb-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--f-ui);
  font-size: 11px;
  color: #fff;
  text-shadow: 1px 1px 0 #000;
  pointer-events: none;
}
</style>
