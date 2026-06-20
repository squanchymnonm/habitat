// Selección estable de sprites desde assets/ (ver habitat/scripts/import-assets.sh).
const CHARS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']
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
  return CHARS[hash('spr' + name) % CHARS.length]
}
export function heroIdle(name: string): string {
  return `assets/char/${charFor(name)}/idle.png`
}
export function faceFor(name: string): string {
  return `assets/char/${charFor(name)}/face.png`
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
