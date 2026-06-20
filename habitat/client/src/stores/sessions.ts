import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, FightResult } from '../types'

export const useSessions = defineStore('sessions', () => {
  const list = ref<Session[]>([])
  const selectedId = ref<string | null>(null)
  // último fightResult; `seq` permite a los pods reaccionar aunque se repita el id
  const lastFight = ref<{ id: string; result: FightResult; seq: number } | null>(null)
  let seq = 0

  const selected = computed(() => list.value.find((s) => s.id === selectedId.value) ?? null)
  const needCount = computed(() => list.value.filter((s) => s.status === 'waiting').length)

  function setAll(sessions: Session[]) {
    list.value = sessions
  }
  function upsert(s: Session) {
    const i = list.value.findIndex((x) => x.id === s.id)
    if (i === -1) list.value.push(s)
    else list.value[i] = s
  }
  function remove(id: string) {
    list.value = list.value.filter((s) => s.id !== id)
    if (selectedId.value === id) selectedId.value = null
  }
  function fight(id: string, result: FightResult) {
    lastFight.value = { id, result, seq: ++seq }
  }
  function select(id: string | null) {
    selectedId.value = id
  }

  return { list, selected, selectedId, needCount, lastFight, setAll, upsert, remove, fight, select }
})
