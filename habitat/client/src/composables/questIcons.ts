import type { Quest } from '../types'

// Icono por estado de quest. pending e in_progress comparten el scroll "apagado"
// (in_progress se distingue con un glow CSS en el componente).
export function questIcon(status: Quest['status']): string {
  return status === 'completed' ? 'assets/ui/quest-done.png' : 'assets/ui/quest-pending.png'
}
