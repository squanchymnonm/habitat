import { useRouter } from 'vue-router'

// Click en una sesión de la nav: siempre navega a /s/<id>. La selección del store la
// aplica syncSelectionWithRoute (fromRoute), así funciona también desde /settings/*
// y no se dispara store.select dos veces.
export function useGoToSession() {
  const router = useRouter()
  return (id: string) => {
    const target = `/s/${id}`
    if (router.currentRoute.value.fullPath !== target) router.push(target)
  }
}
