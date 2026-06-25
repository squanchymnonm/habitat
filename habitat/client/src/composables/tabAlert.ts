// Lógica pura de las alertas de tab, aislada para testear sin DOM.

/** ids que están en `current` pero no estaban en `prev` (orden de `current`). */
export function newlyWaiting(prev: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const id of current) if (!prev.has(id)) out.push(id)
  return out
}
