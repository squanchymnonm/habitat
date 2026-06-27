// Helpers puros del ciclo día/noche (mismo modelo que el mock aprobado).

const STOPS = [
  { p: 0.00, top: '#3f2c40', bot: '#62381f' }, // amanecer
  { p: 0.16, top: '#33445c', bot: '#3d3318' }, // día
  { p: 0.52, top: '#384a60', bot: '#42371b' }, // día (media tarde)
  { p: 0.78, top: '#47283b', bot: '#4c2010' }, // atardecer
  { p: 1.00, top: '#131028', bot: '#191020' }, // noche
]
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function hex(h: string) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] }
function mix(h1: string, h2: string, t: number) {
  const a = hex(h1), b = hex(h2)
  return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`
}

export function skyGradient(cyclePos: number | null): string {
  if (cyclePos == null) return ''
  const p = Math.max(0, Math.min(1, cyclePos))
  let i = 0
  while (i < STOPS.length - 1 && p > STOPS[i + 1].p) i++
  const a = STOPS[i], b = STOPS[Math.min(i + 1, STOPS.length - 1)]
  const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p)
  return `linear-gradient(180deg, ${mix(a.top, b.top, t)}, ${mix(a.bot, b.bot, t)})`
}

export function dialPositions(cyclePos: number | null): { sun: number; moon: number } {
  const p = cyclePos ?? 0
  const y = (q: number) => 120 - 240 * q
  return { sun: y(p), moon: y((p + 0.5) % 1) }
}
