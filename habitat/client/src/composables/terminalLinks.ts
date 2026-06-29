import type { Terminal, ILinkProvider, ILink } from '@xterm/xterm'

export interface LinkMatch {
  start: number // índice 0-based de inicio en lineText
  end: number   // índice 0-based exclusivo de fin
  url: string   // URL normalizada (con esquema), lista para window.open
}

// Puntuación de cierre que no forma parte de la URL si queda colgada al final.
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'"])

export function findLinks(lineText: string): LinkMatch[] {
  // http(s) con esquema, o host pelado localhost/127.0.0.1/0.0.0.0 con puerto y path opcional.
  // Excluimos: whitespace, comillas, < > ( ) [ ] { }
  const linkRe =
    /(https?:\/\/[^\s"'<>(){}\[\]]+)|((?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}(?:\/[^\s"'<>(){}\[\]]*)?)/g

  const out: LinkMatch[] = []
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(lineText)) !== null) {
    const raw = match[0]
    let end = match.index + raw.length
    let text = raw
    while (text.length > 0 && TRAILING.has(text[text.length - 1])) {
      text = text.slice(0, -1)
      end -= 1
    }
    if (text.length === 0) continue

    // Validar puerto si es un link sin esquema (localhost/127.0.0.1/0.0.0.0:PORT)
    const schemeMatch = /^https?:\/\//i.test(text)
    if (!schemeMatch) {
      const portMatch = text.match(/:(\d+)/)
      if (portMatch) {
        const port = parseInt(portMatch[1], 10)
        if (port > 65535) continue
      }
    }

    const url = schemeMatch ? text : `http://${text}`
    out.push({ start: match.index, end, url })
  }
  return out
}

// Provider de links para xterm v6: por cada línea pedida, mapea findLinks() a ILink[].
// La activación abre el link con un tap/click simple (sirve en touch y desktop).
export function createLinkProvider(term: Terminal, openLink: (url: string) => void): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      const text = line ? line.translateToString(true) : ''
      const matches = findLinks(text)
      if (matches.length === 0) { callback(undefined); return }
      const links: ILink[] = matches.map((m) => ({
        // xterm: coordenadas 1-based; range.end.x es inclusivo.
        range: {
          start: { x: m.start + 1, y: bufferLineNumber },
          end: { x: m.end, y: bufferLineNumber },
        },
        text: m.url,
        activate(_event: MouseEvent, url: string) {
          openLink(url)
        },
      }))
      callback(links)
    },
  }
}
