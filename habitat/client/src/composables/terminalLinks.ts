export interface LinkMatch {
  start: number // índice 0-based de inicio en lineText
  end: number   // índice 0-based exclusivo de fin
  url: string   // URL normalizada (con esquema), lista para window.open
}

// http(s) con esquema, o host pelado localhost/127.0.0.1/0.0.0.0 con puerto y path opcional.
const LINK_RE =
  /(https?:\/\/[^\s"'<>()]+)|((?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}(?:\/[^\s"'<>()]*)?)/g

// Puntuación de cierre que no forma parte de la URL si queda colgada al final.
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'"])

export function findLinks(lineText: string): LinkMatch[] {
  const out: LinkMatch[] = []
  LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(lineText)) !== null) {
    const raw = match[0]
    let end = match.index + raw.length
    let text = raw
    while (text.length > 0 && TRAILING.has(text[text.length - 1])) {
      text = text.slice(0, -1)
      end -= 1
    }
    if (text.length === 0) continue
    const url = /^https?:\/\//i.test(text) ? text : `http://${text}`
    out.push({ start: match.index, end, url })
  }
  return out
}
