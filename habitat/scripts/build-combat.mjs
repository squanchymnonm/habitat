#!/usr/bin/env node
// Construye anim_combat.png para cada personaje: 2 frames (guardia + golpe) mirando a la
// derecha (hacia el monstruo), combinando Idle.png + Attack.png del pack Ninja Adventure.
// Es pixel art a mano (con el arma del pack), coherente entre frames — a diferencia de la
// generación por IA, que a 32px mutaba. Idempotente: sobrescribe siempre.
//
// Uso: node habitat/scripts/build-combat.mjs   (desde la raíz del repo)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { cropFrame, assembleStrip } from './lib/imgproc.mjs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..')
const PACK = path.join(ROOT, 'Ninja Adventure - Asset Pack/Actor/Character')
// assets-src es la fuente canónica (import-assets.sh restaura anim_*.png desde acá);
// public es lo que sirve el front. Escribimos en ambos para que un re-import no lo borre.
const SRC = path.join(ROOT, 'habitat/assets-src/char')
const PUB = path.join(ROOT, 'habitat/client/public/assets/char')
const FRAME = 16
const DIR_EAST = 3 // columna que mira a la derecha (el monstruo se dibuja a la derecha)

const CHARS = ['Boy', 'Cavegirl', 'Knight', 'NinjaBlue', 'Monk', 'Hunter', 'FighterRed', 'DemonRed', 'Eskimo', 'GreenPig', 'Lion', 'Monkey', 'Inspector', 'Master', 'KnightGold', 'Caveman']

let wrote = 0, skipped = 0
for (const c of CHARS) {
  const sa = path.join(PACK, c, 'SeparateAnim')
  const idleP = path.join(sa, 'Idle.png')
  const atkP = path.join(sa, 'Attack.png')
  if (!fs.existsSync(idleP) || !fs.existsSync(atkP)) {
    console.error(`SKIP ${c}: falta Idle.png o Attack.png`); skipped++; continue
  }
  const idle = PNG.sync.read(fs.readFileSync(idleP))
  const attack = PNG.sync.read(fs.readFileSync(atkP))
  const guard = cropFrame(idle, DIR_EAST, 0, FRAME)
  const strike = cropFrame(attack, DIR_EAST, 0, FRAME)
  const strip = assembleStrip([guard, strike]) // 32x16
  const buf = PNG.sync.write(strip)
  for (const base of [SRC, PUB]) {
    const out = path.join(base, c, 'anim_combat.png')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, buf)
  }
  wrote++
  console.log(`ok ${c}/anim_combat.png (${strip.width}x${strip.height})`)
}
console.log(`\nListo. escritos=${wrote} salteados=${skipped}`)
