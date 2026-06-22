#!/usr/bin/env node
// Genera un idle "respirando" procedural (sin IA) para cada personaje, a partir
// de la pose sur estática (idle.png frame 0). Identidad y transparencia garantizadas.
// Uso: node habitat/scripts/idle-bob.mjs [--only Char]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { cropFrame, upscaleNearest, assembleStrip } from './lib/imgproc.mjs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..')
const SRC = path.join(ROOT, 'habitat/assets-src/char')
const PUB = path.join(ROOT, 'habitat/client/public/assets/char')
const FRAME = 16, TARGET = 32
const CHARS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']
// bob vertical sutil (en px de 32): respiración de 1px. Loop suave de 4 frames.
// Se desplaza hacia arriba (las filas superiores del sprite son margen vacío, así
// no se recorta la cabeza; abajo queda transparente revelando el piso).
const DY = [0, -1, -1, 0]

function shiftY(png, dy) {
  const { width: W, height: H } = png
  const out = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sy = y - dy
    const di = (y * W + x) << 2
    if (sy < 0 || sy >= H) { out.data[di + 3] = 0; continue }
    const si = (sy * W + x) << 2
    for (let k = 0; k < 4; k++) out.data[di + k] = png.data[si + k]
  }
  return out
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }

const onlyChar = arg('--only')
let wrote = 0
for (const char of CHARS) {
  if (onlyChar && char !== onlyChar) continue
  const idlePath = path.join(PUB, char, 'idle.png')
  if (!fs.existsSync(idlePath)) { console.error(`SKIP ${char}: sin idle.png`); continue }
  const idle = PNG.sync.read(fs.readFileSync(idlePath))
  const base = upscaleNearest(cropFrame(idle, 0, 0, FRAME), TARGET / FRAME) // pose sur -> 32x32
  const frames = DY.map((dy) => shiftY(base, dy))
  const strip = assembleStrip(frames) // 128x32
  const buf = PNG.sync.write(strip)
  const outSrc = path.join(SRC, char, 'anim_idle.png')
  const outPub = path.join(PUB, char, 'anim_idle.png')
  fs.mkdirSync(path.dirname(outSrc), { recursive: true })
  fs.mkdirSync(path.dirname(outPub), { recursive: true })
  fs.writeFileSync(outSrc, buf)
  fs.writeFileSync(outPub, buf)
  wrote++
  console.log(`idle ${char} ok`)
}
console.log(`\nListo. idles procedurales escritos=${wrote}`)
