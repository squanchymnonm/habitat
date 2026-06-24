// Paleta fija de colores de proyecto. DEBE quedar idéntica a
// habitat/client/src/palette.ts (mismo contrato duplicado client/server que
// characters.js <-> sprites.ts). Elegidos por contraste sobre --surface (#1a1a24).
export const PALETTE = [
  '#e7c14a', '#4ec9b0', '#6db74e', '#e06c75',
  '#61afef', '#c678dd', '#e59e54', '#56b6c2',
  '#d19a66', '#98c379', '#ff79c6', '#bd93f9',
];

// Color determinístico a partir de un seed (p.ej. el dir del proyecto): FNV-1a.
export function pickColor(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
