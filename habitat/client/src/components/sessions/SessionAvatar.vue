<script setup lang="ts">
import { computed } from 'vue'
import { faceFor } from '../../sprites'
import { send } from '../../composables/useSocket'
import { STATE_TOKEN, STATUS_LABEL, type Session } from '../../types'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{ session: Session; size?: 'sm' | 'md' }>(), { size: 'md' })
// Clases literales (no interpoladas) para que Tailwind las detecte.
const LIGHT: Record<string, string> = {
  working: 'bg-state-working', waiting: 'bg-state-waiting', done: 'bg-state-done', idle: 'bg-state-idle', error: 'bg-state-error',
}
const light = computed(() => LIGHT[STATE_TOKEN[props.session.status]])
const dismissable = computed(() => props.session.status === 'waiting' || props.session.status === 'error')
function onLight(e: MouseEvent) {
  if (!dismissable.value) return
  e.stopPropagation() // descartar la alerta no selecciona la sesión
  send({ type: 'dismiss', id: props.session.id })
}
</script>

<template>
  <span :class="cn('relative inline-block shrink-0', size === 'sm' ? 'size-7' : 'size-9')">
    <img :src="faceFor(session.name, session.char)" alt="" class="pixel size-full rounded-[var(--radius)] bg-surface-raised" />
    <span
      data-test="state-light"
      :class="cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface', light, dismissable && 'cursor-pointer animate-pulse motion-reduce:animate-none')"
      :title="dismissable ? `${STATUS_LABEL[session.status]} · tocar para descartar` : STATUS_LABEL[session.status]"
      @click="onLight"
    />
  </span>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
