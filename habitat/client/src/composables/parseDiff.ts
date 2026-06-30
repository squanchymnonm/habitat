export interface DiffLine { type: 'ctx' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string }
export interface DiffHunk { header: string; lines: DiffLine[] }

// Parser chico de diff unificado de git. Ignora las cabeceras de archivo
// (diff/index/---/+++) y arma hunks numerando líneas viejas/nuevas.
export function parseDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      cur = { header: line, lines: [] }
      hunks.push(cur)
      continue
    }
    if (!cur) continue // cabeceras previas al primer hunk
    if (line.startsWith('+')) {
      cur.lines.push({ type: 'add', oldNo: null, newNo, text: line.slice(1) }); newNo++
    } else if (line.startsWith('-')) {
      cur.lines.push({ type: 'del', oldNo, newNo: null, text: line.slice(1) }); oldNo++
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignorar
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      cur.lines.push({ type: 'ctx', oldNo, newNo, text }); oldNo++; newNo++
    }
  }
  return hunks
}
