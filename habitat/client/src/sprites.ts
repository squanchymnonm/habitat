import type { Status } from './types'

// Selección estable de sprites desde assets/ (ver habitat/scripts/import-assets.sh).
export const CHARACTERS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']
const MONSTERS = ['Slime', 'Slime3', 'Flam', 'BlueBat', 'Mushroom', 'KappaGreen', 'Eye', 'Larva', 'Mole', 'Mouse', 'Lizard', 'Bear', 'Beast', 'GreenOctopus', 'Butterfly', 'Dragon']
const BOSSES = ['GiantFrog', 'DemonCyclop', 'GiantBamboo', 'TenguRed', 'GiantRacoon', 'GiantSpirit', 'GiantFlam', 'TenguBlue']

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

// Por ahora solo existe el idle procedural (bob de respiración) para los 16
// personajes; las acciones (work/waiting/done/error) están diferidas hasta tener
// arte generado por IA. Mientras tanto todos los estados usan el idle. Cuando se
// agregue anim_work.png/etc., re-apuntar cada estado a su archivo.
export const STATUS_ANIM: Record<Status, string> = {
  idle: 'anim_idle',
  working: 'anim_idle',
  waiting: 'anim_idle',
  done: 'anim_idle',
  error: 'anim_idle',
  offline: 'anim_idle',
}

export function heroAnim(name: string, char: string | undefined, status: Status): string {
  return `assets/char/${resolveChar(name, char)}/${STATUS_ANIM[status]}.png`
}

export function monsterSprite(type: string): string {
  return `assets/monster/${MONSTERS[hash('mon' + type) % MONSTERS.length]}.png`
}
export function bossSprite(label: string): string {
  return `assets/boss/${BOSSES[hash('boss' + label) % BOSSES.length]}.png`
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
