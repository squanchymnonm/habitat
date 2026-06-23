#!/usr/bin/env node
// Genera animaciones de avatar por estado para cada personaje, usando PixelLab.
// Uso: PIXELLAB_TOKEN=xxx node habitat/scripts/animate-chars.mjs [--only Char] [--anim idle]
// Idempotente: saltea archivos ya generados (borralos para regenerar).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { cropFrame, upscaleNearest, despeckle, downscaleBox, assembleStrip } from './lib/imgproc.mjs'
import { animateWithText } from './lib/pixellab.mjs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..')
const SRC = path.join(ROOT, 'habitat/assets-src/char')
const PUB = path.join(ROOT, 'habitat/client/public/assets/char')
const FRAME = 16   // tamaño del frame en idle.png del pack
const GEN = 64     // tamaño que exige la API
const TARGET = 32  // resolución final por frame

const CHARS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']

const CHAR_DESC = {
  Boy: 'young boy in green tunic', Cavegirl: 'cavegirl in animal fur with ponytail',
  Knight: 'knight in gray steel armor and helmet', NinjaBlue: 'ninja in blue outfit and mask',
  Monk: 'bald monk in orange robe', Hunter: 'hunter in brown leather with hood',
  FighterRed: 'fighter in red martial arts gi', DemonRed: 'red-skinned demon with horns',
  Eskimo: 'eskimo in blue fur parka', GreenPig: 'green pig humanoid character',
  Lion: 'lion humanoid warrior with mane', Monkey: 'brown monkey humanoid',
  Inspector: 'detective in beige trench coat and hat', Master: 'old martial arts master with white beard',
  KnightGold: 'knight in golden armor and helmet', Caveman: 'caveman in animal fur with club',
}

const ANIMS = {
  anim_idle: 'breathing idle, subtle up and down bob',
  anim_work: 'concentrated, looking down and nodding slightly while busy',
  anim_waiting: 'waving one arm to get attention, impatient',
  anim_done: 'happy and excited, bouncing up and down cheerfully',
  anim_error: 'shaking head side to side, dizzy and confused',
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }

async function main() {
  const token = process.env.PIXELLAB_TOKEN
  if (!token) { console.error('Falta PIXELLAB_TOKEN'); process.exit(1) }
  const onlyChar = arg('--only')
  const onlyAnim = arg('--anim') ? `anim_${arg('--anim')}` : null
  let gens = 0, wrote = 0, skipped = 0

  for (const char of CHARS) {
    if (onlyChar && char !== onlyChar) continue
    const idlePath = path.join(PUB, char, 'idle.png')
    if (!fs.existsSync(idlePath)) { console.error(`SKIP ${char}: sin idle.png`); continue }
    const idle = PNG.sync.read(fs.readFileSync(idlePath))
    const refPng = upscaleNearest(cropFrame(idle, 0, 0, FRAME), GEN / FRAME) // pose sur (frame 0) -> 64x64
    const refBase64 = PNG.sync.write(refPng).toString('base64')

    for (const [name, action] of Object.entries(ANIMS)) {
      if (onlyAnim && name !== onlyAnim) continue
      const outSrc = path.join(SRC, char, `${name}.png`)
      const outPub = path.join(PUB, char, `${name}.png`)
      if (fs.existsSync(outSrc)) { skipped++; continue }

      process.stdout.write(`gen ${char}/${name} ... `)
      const { framesBase64, usage } = await animateWithText({
        token, description: CHAR_DESC[char] || char, action, refBase64,
      })
      gens += usage?.generations ?? 0
      const frames = framesBase64.map((b64) => {
        const p = PNG.sync.read(Buffer.from(b64, 'base64'))
        despeckle(p)
        return downscaleBox(p, TARGET)
      })
      const strip = assembleStrip(frames) // 128x32
      const buf = PNG.sync.write(strip)
      fs.mkdirSync(path.dirname(outSrc), { recursive: true })
      fs.mkdirSync(path.dirname(outPub), { recursive: true })
      fs.writeFileSync(outSrc, buf)
      fs.writeFileSync(outPub, buf)
      wrote++
      console.log(`ok (${strip.width}x${strip.height})`)
    }
  }
  console.log(`\nListo. escritos=${wrote} salteados=${skipped} generations~=${gens}`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
