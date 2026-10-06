import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'
import { watch } from 'vue'
import type { useSessions } from './stores/sessions'
import { layoutModeFor } from './composables/useLayoutMode'

// Celular según el tamaño actual de la ventana (sin window, p. ej. SSR/tests sin DOM: no).
const isPhone = () => typeof window !== 'undefined' && layoutModeFor(window.innerWidth, window.innerHeight) === 'phone'

// Hash history: funciona detrás de Tailscale/LAN sin tocar el server (no hay rutas server-side).
export function createHabitatRouter(history: RouterHistory = createWebHashHistory()): Router {
  return createRouter({
    history,
    routes: [
      // En celular la pantalla principal es la lista: redirigir antes de montar nada, así un
      // snapshot del WS que llegue mientras carga el chunk no alcanza a mandarnos al foco.
      { path: '/', name: 'focus', component: () => import('./views/FocusRoute.vue'), beforeEnter: () => (isPhone() ? '/sessions' : true) },
      { path: '/s/:id', name: 'session', component: () => import('./views/FocusRoute.vue') },
      { path: '/board', name: 'board', component: () => import('./views/BoardRoute.vue') },
      { path: '/sessions', name: 'list', component: () => import('./views/SessionListRoute.vue') },
      { path: '/settings', redirect: '/settings/general' },
      { path: '/settings/:section(general|appearance|projects|account)', name: 'settings', component: () => import('./views/SettingsRoute.vue') },
      { path: '/settings/projects/:name/:tab?', name: 'project', component: () => import('./views/SettingsRoute.vue') },
      { path: '/settings/:pathMatch(.*)*', redirect: '/settings/general' },
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
    // En celular #/ es (o va a ser) la lista: una selección automática no saca de ahí.
    if (r.name === 'focus' && isPhone()) return
    const target = id ? `/s/${id}` : '/'
    if (r.fullPath !== target) router.replace(target)
  })
}
