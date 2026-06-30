import { describe, it, expect } from 'vitest'
import { findLinks, createLinkProvider } from './terminalLinks'
import type { Terminal, ILink } from '@xterm/xterm'

describe('findLinks', () => {
  it('detecta una URL https y conserva texto y rango', () => {
    const line = 'abrí https://ejemplo.com ya'
    const [m, ...rest] = findLinks(line)
    expect(rest).toHaveLength(0)
    expect(m.url).toBe('https://ejemplo.com')
    expect(line.slice(m.start, m.end)).toBe('https://ejemplo.com')
  })

  it('detecta http://localhost con esquema', () => {
    const line = 'server en http://localhost:5173/'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://localhost:5173/')
    expect(line.slice(m.start, m.end)).toBe('http://localhost:5173/')
  })

  it('detecta localhost:PORT sin esquema y normaliza a http://', () => {
    const line = 'corriendo en localhost:3000'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://localhost:3000')
    expect(line.slice(m.start, m.end)).toBe('localhost:3000')
  })

  it('detecta 127.0.0.1 con path', () => {
    const line = 'ping 127.0.0.1:8080/health'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://127.0.0.1:8080/health')
    expect(line.slice(m.start, m.end)).toBe('127.0.0.1:8080/health')
  })

  it('detecta 0.0.0.0:PORT sin esquema', () => {
    const line = 'listening on 0.0.0.0:4000'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://0.0.0.0:4000')
    expect(line.slice(m.start, m.end)).toBe('0.0.0.0:4000')
  })

  it('una línea sin links devuelve []', () => {
    expect(findLinks('no hay nada acá, solo texto.')).toEqual([])
  })

  it('recorta puntuación final colgada', () => {
    const line = 'visitá https://ejemplo.com.'
    const [m] = findLinks(line)
    expect(m.url).toBe('https://ejemplo.com')
    expect(line.slice(m.start, m.end)).toBe('https://ejemplo.com')
  })

  it('detecta múltiples links en orden', () => {
    const ms = findLinks('a https://uno.com b localhost:3000 c')
    expect(ms.map((m) => m.url)).toEqual(['https://uno.com', 'http://localhost:3000'])
  })

  it('excluye brackets de la URL', () => {
    const line = 'see https://ejemplo.com/x[0]'
    const [m] = findLinks(line)
    expect(m.url).toBe('https://ejemplo.com/x')
    expect(line.slice(m.start, m.end)).toBe('https://ejemplo.com/x')
  })

  it('rechaza puertos inválidos (> 65535)', () => {
    const ms = findLinks('open localhost:99999')
    expect(ms).toEqual([])
  })

  it('acepta puerto límite válido (65535)', () => {
    const line = 'open localhost:65535'
    const [m] = findLinks(line)
    expect(m.url).toBe('http://localhost:65535')
    expect(line.slice(m.start, m.end)).toBe('localhost:65535')
  })
})

function termWith(line: string): Terminal {
  return {
    buffer: { active: { getLine: (_n: number) => ({ translateToString: (_t?: boolean) => line }) } },
  } as unknown as Terminal
}

function firstLink(line: string, openLink: (url: string) => void): ILink {
  const provider = createLinkProvider(termWith(line), openLink)
  let links: ILink[] | undefined
  provider.provideLinks(1, (l) => { links = l })
  if (!links || links.length === 0) throw new Error('sin links')
  return links[0]
}

describe('createLinkProvider.activate', () => {
  it('abre el link con click simple (sin Ctrl/Cmd)', () => {
    let opened = ''
    const link = firstLink('ver https://ejemplo.com', (u) => { opened = u })
    link.activate({ ctrlKey: false, metaKey: false } as MouseEvent, 'https://ejemplo.com')
    expect(opened).toBe('https://ejemplo.com')
  })

  it('sigue abriendo con Ctrl+click', () => {
    let opened = ''
    const link = firstLink('ver https://ejemplo.com', (u) => { opened = u })
    link.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'https://ejemplo.com')
    expect(opened).toBe('https://ejemplo.com')
  })
})
