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

// Primer nombre de NAMES no presente en `used`. Si están todos, sufija -2, -3, ...
export function autoName(used = []) {
  const set = new Set(used);
  for (const n of NAMES) if (!set.has(n)) return n;
  for (let i = 2; ; i++) {
    for (const n of NAMES) {
      const cand = `${n}-${i}`;
      if (!set.has(cand)) return cand;
    }
  }
}
