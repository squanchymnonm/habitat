// Clases Tailwind compartidas por la familia de componentes de git (ex git.css),
// token por token. Centralizadas acá para no repetir la misma cadena larga en
// cada componente — ver el brief de la Task 6 para la tabla de equivalencias.

// Objetivo táctil ≥40px (spec §5): min-h-10 en botones/inputs/pestañas.
export const BTN = 'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:cursor-default disabled:opacity-50'
// Para botones de sólo ícono (sin texto visible): además del alto, necesitan
// ancho mínimo — si no, el ícono solo queda angosto y por debajo del target.
export const BTN_ICON = 'min-w-10 justify-center'
export const BTN_PRIMARY = 'bg-accent text-accent-foreground hover:text-accent-foreground'
export const BTN_DANGER = 'hover:text-danger'

export const COUNT = 'rounded-full bg-surface px-1.5 text-[10px] tabular-nums text-muted'
export const COUNT_PRIMARY = 'bg-accent-foreground/20 text-accent-foreground'

// mb-4 reemplaza el margin-bottom:1rem de .g-group: sin esto los grupos
// hermanos (conflicto/staged/sin-stagear, local/remotas, etc.) quedan pegados.
export const GROUP = 'mb-4 flex flex-col gap-1.5'
export const GROUP_H4 = 'm-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted'

export const MUTED = 'text-sm text-muted'
// El error no se comunica sólo por color: el "!" es el cue no-color (ex g-err::before).
export const ERR = 'mb-2 flex items-start gap-1.5 rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger'

export const INPUT = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-2 py-1 font-[inherit] text-sm text-text'

export const UL = 'm-0 list-none divide-y divide-border p-0'
export const LI = 'flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-base'
export const FLAT = 'min-w-0 flex-1 bg-transparent font-mono text-sm text-text [overflow-wrap:anywhere]'
export const FLAT_A = 'min-w-0 flex-1 cursor-pointer font-mono text-sm text-text underline decoration-dotted underline-offset-[3px] hover:text-accent [overflow-wrap:anywhere]'

export const TAB = 'min-h-10 cursor-pointer border-0 border-b-2 bg-transparent px-3 py-1.5 font-[inherit] text-sm'

// Color de la letra de estado de git (M/A/D/?…) por token semántico.
const ST_COLOR: Record<string, string> = { M: 'text-state-working', A: 'text-state-done', D: 'text-danger' }
export function stColor(status: string) { return ST_COLOR[status] ?? 'text-muted' }
