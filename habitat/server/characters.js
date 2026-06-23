// Lista canónica de personajes jugables del Hábitat.
// DEBE quedar alineada con CHARACTERS en habitat/client/src/sprites.ts
// (mismo contrato duplicado client/server que types.ts <-> state.js).
export const CHARACTERS = [
  'Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed',
  'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman',
];

// Nombres de personajes de videojuegos para autogenerar el nombre de un personaje
// del Hábitat (distinto de CHARACTERS, que son sprites). Todos minúscula y válidos
// como branch/carpeta (ver validBranch en git.js).
export const NAMES = [
  'mario', 'luigi', 'link', 'zelda', 'samus', 'kirby', 'sonic', 'tails', 'kratos', 'cloud',
  'tifa', 'sephiroth', 'geralt', 'ciri', 'aloy', 'ezio', 'altair', 'sora', 'crash', 'spyro',
  'dante', 'ryu', 'ken', 'snake', 'raiden', 'megaman', 'pikachu', 'yoshi', 'bowser', 'ganondorf',
  'lara', 'gordon', 'alyx', 'shepard', 'garrus', 'joel', 'ellie', 'arthur', 'niko', 'corvo',
  'eivor', 'kassandra', 'bayek', 'doomguy', 'scorpion', 'jin', 'kazuya', 'cole',
];

// Nombre aleatorio de NAMES no presente en `used`. Si están todos, sufija -2, -3, …
export function autoName(used = []) {
  const set = new Set(used);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const free = NAMES.filter((n) => !set.has(n));
  if (free.length) return pick(free);
  for (let i = 2; ; i++) {
    const freeSuffixed = NAMES.map((n) => `${n}-${i}`).filter((c) => !set.has(c));
    if (freeSuffixed.length) return pick(freeSuffixed);
  }
}
