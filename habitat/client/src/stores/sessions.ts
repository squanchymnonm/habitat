import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, FightResult } from '../types'
import { pickSelection } from './pickSelection'

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
    reconcile()
  }
  function upsert(s: Session) {
    const i = list.value.findIndex((x) => x.id === s.id)
    if (i === -1) list.value.push(s)
    else list.value[i] = s
    reconcile()
  }
  function remove(id: string) {
    list.value = list.value.filter((s) => s.id !== id)
    reconcile()
  }
  function fight(id: string, result: FightResult) {
    lastFight.value = { id, result, seq: ++seq }
  }
  function select(id: string | null) {
    selectedId.value = id
  }
  // Mantiene una selección válida: conserva la actual o cae al primero.
  function reconcile() {
    selectedId.value = pickSelection(list.value.map((s) => s.id), selectedId.value)
  }

  return { list, selected, selectedId, needCount, lastFight, setAll, upsert, remove, fight, select }
})
