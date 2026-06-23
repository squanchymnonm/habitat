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

export type Pose = 'rest' | 'walk' | 'jump' | 'item' | 'dead' | 'combat'

export interface PoseRender {
  file: string
  mode: 'static' | 'grid' | 'strip'
  frame?: number
  duration?: number
}

// Cómo renderiza cada pose en <Sprite>. file = nombre del .png en assets/char/<char>/.
export const POSE_RENDER: Record<Pose, PoseRender> = {
  rest: { file: 'anim_idle', mode: 'strip', duration: 1600 },
  walk: { file: 'walk', mode: 'grid', duration: 600 },
  jump: { file: 'jump', mode: 'static', frame: 0 },
  item: { file: 'item', mode: 'static', frame: 0 },
  dead: { file: 'dead', mode: 'static', frame: 0 },
  combat: { file: 'idle', mode: 'static', frame: 3 },
}

export function heroSprite(name: string, char: string | undefined, pose: Pose): string {
  return `assets/char/${resolveChar(name, char)}/${POSE_RENDER[pose].file}.png`
}

export interface HeroPoseInput {
  status: Status
  inCombat: boolean
  jabbing: boolean
  celebrating: boolean
}

// Precedencia estado+combate -> pose. Pura y testeable.
export function heroPoseFor(s: HeroPoseInput): Pose {
  if (s.celebrating) return 'jump'
  if (s.status === 'offline') return 'dead'
  if (s.inCombat) return s.jabbing ? 'item' : 'combat'
  if (s.status === 'working') return 'walk'
  if (s.status === 'done') return 'jump'
  return 'rest'
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
