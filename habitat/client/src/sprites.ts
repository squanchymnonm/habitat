// Selección estable de sprites desde assets/ (ver habitat/scripts/import-assets.sh).
export const CHARACTERS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function charFor(name: string): string {
  return CHARACTERS[hash('spr' + name) % CHARACTERS.length]
}
// Personaje a usar: el elegido (si es válido) o el derivado del nombre.
function resolveChar(name: string, char?: string): string {
  return char && CHARACTERS.includes(char) ? char : charFor(name)
}
export function heroIdle(name: string, char?: string): string {
  return `assets/char/${resolveChar(name, char)}/idle.png`
}
export function faceFor(name: string, char?: string): string {
  return `assets/char/${resolveChar(name, char)}/face.png`
}

export function fmt(n: number): string {
  return (n || 0).toLocaleString('es-AR')
}
export function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'recién'
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}

// Hue HSL para la pelotita de stamina: gradiente continuo rojo->amarillo->verde.
// 0%=hue 0 (rojo), 50%=hue 60 (amarillo), 100%=hue 120 (verde).
export function staminaHue(stamina: number): number {
  const s = Math.max(0, Math.min(100, stamina))
  return Math.round(s * 1.2)
}
