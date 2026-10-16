// Teclado en pantalla (tablet/celular). Dos problemas que resolver:
//
// 1. El alto de la app. En Chrome Android lo resuelve el meta viewport
//    (`interactive-widget=resizes-content`: 100dvh se achica con el teclado). Safari
//    (iPad/iPhone) ignora esa opción y sólo achica el visualViewport, así que el alto
//    visible se publica en `--app-h` y #app lo usa (ver theme.css). Sin esto el teclado
//    tapa lo que se escribe.
//
// 2. El modo de layout. Al achicarse la ventana con el teclado, una tablet acostada
//    (1280x800 -> ~1280x420) pasaría a "phone" mientras escribís. En touch, con el
//    mismo ancho, el alto que cuenta para el layout es el mayor visto; rotar (cambia
//    el ancho) lo reinicia.

export interface LayoutHeight { width: number; height: number }

export function nextLayoutHeight(prev: LayoutHeight | null, w: number, h: number, touch: boolean): LayoutHeight {
  if (!touch || !prev || prev.width !== w) return { width: w, height: h }
  return { width: w, height: Math.max(prev.height, h) }
}

const isTouch = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

let held: LayoutHeight | null = null

// Tamaño de ventana para decidir el layout (useLayoutMode, router).
export function layoutSize(): [number, number] {
  if (typeof window === 'undefined') return [1440, 900]
  held = nextLayoutHeight(held, window.innerWidth, window.innerHeight, isTouch())
  return [held.width, held.height]
}

// Publica el alto visible en --app-h y lo mantiene al día.
export function installViewportHeight() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return // sin visualViewport queda el fallback 100dvh del CSS
  const style = document.documentElement.style
  const update = () => {
    // * scale: con pinch-zoom el visualViewport también se achica, pero eso no es teclado.
    style.setProperty('--app-h', `${vv.height * vv.scale}px`)
    // Safari scrollea el documento para mostrar el input enfocado; con la app ya del
    // alto visible eso sólo la corre hacia arriba y deja un hueco abajo.
    if (window.scrollY) window.scrollTo(0, 0)
  }
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
}
