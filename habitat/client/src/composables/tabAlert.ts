// Lógica pura de las alertas de tab, aislada para testear sin DOM.

/** ids que están en `current` pero no estaban en `prev` (orden de `current`). */
export function newlyWaiting(prev: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const id of current) if (!prev.has(id)) out.push(id)
  return out
}

/**
 * Qué disparar cuando hay sesiones recién en `waiting`:
 * - `sound`: siempre que haya nuevas (estés mirando la pestaña o no).
 * - `notify`: notificación del SO solo si la pestaña está en background.
 */
export function alertActions(freshCount: number, hidden: boolean): { sound: boolean; notify: boolean } {
  return { sound: freshCount > 0, notify: freshCount > 0 && hidden }
}
