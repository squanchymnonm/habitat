// Detector de long-press agnóstico del DOM: el componente le pasa coordenadas
// de touch y este decide cuándo "disparar" (mantener apretado sin desplazarse).
export interface LongPress {
  start(x: number, y: number): void
  move(x: number, y: number): void
  cancel(): void
}

export function createLongPress(
  fire: (x: number, y: number) => void,
  opts: { ms?: number; moveTol?: number } = {},
): LongPress {
  const ms = opts.ms ?? 500
  const moveTol = opts.moveTol ?? 10
  let timer: ReturnType<typeof setTimeout> | null = null
  let sx = 0
  let sy = 0

  function clear() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  return {
    start(x, y) {
      clear()
      sx = x
      sy = y
      timer = setTimeout(() => { timer = null; fire(x, y) }, ms)
    },
    move(x, y) {
      if (timer !== null && Math.hypot(x - sx, y - sy) > moveTol) clear()
    },
    cancel() { clear() },
  }
}
