import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'
import { watch } from 'vue'
import type { useSessions } from './stores/sessions'

// Hash history: funciona detrás de Tailscale/LAN sin tocar el server (no hay rutas server-side).
export function createHabitatRouter(history: RouterHistory = createWebHashHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'focus', component: () => import('./views/FocusRoute.vue') },
      { path: '/s/:id', name: 'session', component: () => import('./views/FocusRoute.vue') },
      { path: '/board', redirect: '/' }, // el tablero llega en el PR 3
      { path: '/settings/:section?', name: 'settings', component: () => import('./views/SettingsRoute.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })
}

// Selección del store <-> ruta, en ambos sentidos. Sólo actúa en las rutas de foco:
// estar en ajustes no cambia la selección ni la URL.
export function syncSelectionWithRoute(router: Router, store: ReturnType<typeof useSessions>) {
  const fromRoute = () => {
    const r = router.currentRoute.value
    if (r.name !== 'session') return
    const id = String(r.params.id)
    if (store.list.some((s) => s.id === id)) {
      if (store.selectedId !== id) store.select(id)
    } else if (store.list.length) {
      router.replace('/') // id inexistente (sesión cerrada, link viejo)
    }
  }
  watch(() => router.currentRoute.value.fullPath, fromRoute, { immediate: true })
  // La lista puede llegar después que la ruta (snapshot del WS): reintentar.
  watch(() => store.list.map((s) => s.id).join(','), fromRoute)
  watch(() => store.selectedId, (id) => {
    const r = router.currentRoute.value
    if (r.name !== 'focus' && r.name !== 'session') return
    const target = id ? `/s/${id}` : '/'
    if (r.fullPath !== target) router.replace(target)
  })
}
