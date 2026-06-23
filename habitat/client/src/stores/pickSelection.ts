// Decide qué sesión queda seleccionada tras un cambio en la lista.
// Conserva la selección actual si sigue existiendo; si no, cae al primero.
export function pickSelection(ids: string[], current: string | null): string | null {
  if (current && ids.includes(current)) return current
  return ids[0] ?? null
}
