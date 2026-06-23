# Animaciones de avatar por estado del agente — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el avatar de cada sesión en el pod se anime según el estado del agente (idle/work/waiting/done/error), con frames generados por PixelLab desde el sprite estático existente y guardados como PNG en `assets/char/`.

**Architecture:** Un pipeline Node (`habitat/scripts/`) genera, por personaje y animación, un strip `128×32` (4 frames south-facing) llamando a la API de PixelLab y post-procesando localmente (despeckle + downscale + ensamblado). Los PNG canónicos se committean en `habitat/assets-src/char/` y `import-assets.sh` los copia a `habitat/client/public/assets/char/`. El frontend (`Sprite.vue` ya soporta `mode="strip"`) elige el strip según `session.status`.

**Tech Stack:** Node 20 (ESM), `node --test` + `node:assert/strict`, `pngjs` (procesamiento de imágenes JS puro), Vue 3 + TypeScript (`vue-tsc`), PixelLab REST API.

> **Pivot al ejecutar:** el free tier de PixelLab tope a 40 generaciones y la
> calidad AI salió despareja. Task 4 se reemplazó por un **idle procedural**
> (`scripts/idle-bob.mjs`, sin IA) para los 16 personajes, y `STATUS_ANIM`
> (Task 6) quedó con **todos los estados → `anim_idle`**. Las acciones AI quedan
> diferidas; las Tasks 1-3 (pipeline AI) siguen vigentes y testeadas para
> regenerar con crédito (ahora con `negative_description` anti-fondo). Tasks 5-7
> se implementaron tal cual.

## Global Constraints

- Runtime: **Node ESM** (`"type":"module"`). Tests con el runner integrado: `node --test` (`node:test` + `node:assert/strict`). No hay vitest/jest.
- El cliente (`habitat/client`) **no tiene framework de tests**: el frontend se verifica con `npm run typecheck` (vue-tsc) + `npm run build` + inspección visual. No agregar runner de tests al cliente.
- Sprites generados: **32×32 px por frame**, strip horizontal **128×32** (4 frames), **fondo transparente**, **solo south-facing**.
- PixelLab: base `https://api.pixellab.ai/v1`, endpoint `POST /animate-with-text`, `image_size` **fijo 64×64**. Token vía env **`PIXELLAB_TOKEN`** (nunca hardcodear). El free tier factura en `generations`; 1 animación de 4 frames = 1 generation.
- Lista de personajes (16), **verbatim** (igual que `import-assets.sh` y `client/src/sprites.ts`):
  `Boy Cavegirl Knight NinjaBlue Monk Hunter FighterRed DemonRed Eskimo GreenPig Lion Monkey Inspector Master KnightGold Caveman`
- Mapeo estado→archivo (`Status` en `client/src/types.ts`):
  `idle→anim_idle`, `working→anim_work`, `waiting→anim_waiting`, `done→anim_done`, `error→anim_error`, `offline→anim_idle` (atenuado por CSS).
- Los PNG canónicos viven committeados en `habitat/assets-src/char/<Char>/anim_*.png`; `assets/` (público) es reproducible vía `import-assets.sh`.

---

### Task 1: Lib de procesamiento de imágenes (`imgproc.mjs`)

Funciones puras sobre objetos PNG de `pngjs` (`{width,height,data}` con `data` = Buffer RGBA). Son la base testeable del pipeline; no tocan red ni disco.

**Files:**
- Create: `habitat/scripts/lib/imgproc.mjs`
- Test: `habitat/scripts/lib/imgproc.test.mjs`
- Modify: `habitat/package.json` (agregar `pngjs` a `devDependencies`)

**Interfaces:**
- Consumes: `pngjs` (`new PNG({width,height})`, `.data` Buffer RGBA, índice `(y*width+x)<<2`).
- Produces:
  - `cropFrame(png, fx, fy, size) -> PNG` — recorta un sub-cuadro `size×size` con esquina sup-izq en `(fx*size, fy*size)`.
  - `upscaleNearest(png, scale) -> PNG` — escala nearest-neighbor (entero).
  - `despeckle(png) -> void` — muta `png`: pone alpha=0 a píxeles opacos (alpha≥128) con <3 vecinos opacos (8-conexo).
  - `downscaleBox(png, target) -> PNG` — reduce a `target×target` con box-filter alpha-aware: cada celda destino es transparente si <50% de sus fuentes son opacas; si no, promedio RGB de las opacas, alpha=255. Requiere `png.width % target === 0`.
  - `assembleStrip(frames) -> PNG` — concatena horizontalmente N PNG cuadrados del mismo tamaño en un strip `(N*size)×size`.

- [ ] **Step 1: Agregar dependencia `pngjs`**

En `habitat/package.json`, agregar bloque `devDependencies` (no existe aún):

```json
  "devDependencies": {
    "pngjs": "^7.0.0"
  }
```

Luego instalar:

Run: `cd habitat && npm install`
Expected: `pngjs` aparece en `node_modules`, sin errores.

- [ ] **Step 2: Escribir los tests (fallan)**

Create `habitat/scripts/lib/imgproc.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { cropFrame, upscaleNearest, despeckle, downscaleBox, assembleStrip } from './imgproc.mjs'

// helper: crea un PNG y lo pinta con un callback (x,y)->[r,g,b,a]
function make(w, h, fn) {
  const p = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fn(x, y)
    const i = (y * w + x) << 2
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = a
  }
  return p
}
const A = (p, x, y) => p.data[((y * p.width + x) << 2) + 3]
const R = (p, x, y) => p.data[(y * p.width + x) << 2]

test('cropFrame extrae el sub-cuadro correcto', () => {
  // 4 columnas de 2x2: col c pintada con r=c*10
  const src = make(8, 2, (x) => [(x >> 1) * 10, 0, 0, 255])
  const f = cropFrame(src, 2, 0, 2) // tercer cuadro -> r=20
  assert.equal(f.width, 2)
  assert.equal(R(f, 0, 0), 20)
})

test('upscaleNearest duplica dimensiones y replica píxeles', () => {
  const src = make(2, 2, (x, y) => [x === 0 ? 255 : 0, 0, 0, 255])
  const up = upscaleNearest(src, 2)
  assert.equal(up.width, 4)
  assert.equal(R(up, 0, 0), 255)
  assert.equal(R(up, 1, 0), 255) // mismo píxel fuente
  assert.equal(R(up, 2, 0), 0)
})

test('despeckle borra píxeles opacos aislados', () => {
  // un solo píxel opaco en el centro, resto transparente
  const p = make(3, 3, (x, y) => (x === 1 && y === 1 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
  despeckle(p)
  assert.equal(A(p, 1, 1), 0) // aislado -> borrado
})

test('despeckle conserva píxeles con suficientes vecinos', () => {
  // bloque 2x2 opaco: cada uno tiene 3 vecinos opacos
  const p = make(3, 3, (x, y) => (x < 2 && y < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
  despeckle(p)
  assert.equal(A(p, 0, 0), 255)
})

test('downscaleBox reduce 4x y respeta transparencia mayoritaria', () => {
  // 4x4 totalmente opaco rojo -> 1x1 rojo opaco
  const opaque = make(4, 4, () => [255, 0, 0, 255])
  const d1 = downscaleBox(opaque, 1)
  assert.equal(d1.width, 1)
  assert.equal(A(d1, 0, 0), 255)
  assert.equal(R(d1, 0, 0), 255)
  // 4x4 con 1 solo píxel opaco (<50%) -> transparente
  const sparse = make(4, 4, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
  const d2 = downscaleBox(sparse, 1)
  assert.equal(A(d2, 0, 0), 0)
})

test('assembleStrip concatena horizontalmente', () => {
  const a = make(2, 2, () => [10, 0, 0, 255])
  const b = make(2, 2, () => [20, 0, 0, 255])
  const strip = assembleStrip([a, b])
  assert.equal(strip.width, 4)
  assert.equal(strip.height, 2)
  assert.equal(R(strip, 0, 0), 10)
  assert.equal(R(strip, 2, 0), 20)
})
```

- [ ] **Step 3: Correr los tests (deben fallar)**

Run: `cd habitat && node --test scripts/lib/imgproc.test.mjs`
Expected: FAIL — `Cannot find module './imgproc.mjs'` o `imgproc.mjs` sin exports.

- [ ] **Step 4: Implementar `imgproc.mjs`**

Create `habitat/scripts/lib/imgproc.mjs`:

```js
import { PNG } from 'pngjs'

export function cropFrame(png, fx, fy, size) {
  const out = new PNG({ width: size, height: size })
  const ox = fx * size, oy = fy * size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const si = ((oy + y) * png.width + (ox + x)) << 2
    const di = (y * size + x) << 2
    for (let k = 0; k < 4; k++) out.data[di + k] = png.data[si + k]
  }
  return out
}

export function upscaleNearest(png, scale) {
  const W = png.width * scale, H = png.height * scale
  const out = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = (x / scale) | 0, sy = (y / scale) | 0
    const si = (sy * png.width + sx) << 2, di = (y * W + x) << 2
    for (let k = 0; k < 4; k++) out.data[di + k] = png.data[si + k]
  }
  return out
}

export function despeckle(png) {
  const { width: W, height: H, data } = png
  const a = (i) => data[(i << 2) + 3]
  const kill = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (a(i) < 128) continue
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      if (a(ny * W + nx) >= 128) n++
    }
    if (n < 3) kill.push(i)
  }
  for (const i of kill) data[(i << 2) + 3] = 0
}

export function downscaleBox(png, target) {
  const S = png.width / target
  if (!Number.isInteger(S)) throw new Error(`downscaleBox: ${png.width} no es múltiplo de ${target}`)
  const out = new PNG({ width: target, height: target })
  for (let y = 0; y < target; y++) for (let x = 0; x < target; x++) {
    let r = 0, g = 0, b = 0, cnt = 0, tot = 0
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const sx = (x * S + xx) | 0, sy = (y * S + yy) | 0
      const si = (sy * png.width + sx) << 2
      tot++
      if (png.data[si + 3] >= 128) { r += png.data[si]; g += png.data[si + 1]; b += png.data[si + 2]; cnt++ }
    }
    const di = (y * target + x) << 2
    if (cnt * 2 >= tot) {
      out.data[di] = (r / cnt) | 0; out.data[di + 1] = (g / cnt) | 0
      out.data[di + 2] = (b / cnt) | 0; out.data[di + 3] = 255
    } else {
      out.data[di + 3] = 0
    }
  }
  return out
}

export function assembleStrip(frames) {
  const size = frames[0].width
  const strip = new PNG({ width: size * frames.length, height: size })
  frames.forEach((p, fi) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const si = (y * size + x) << 2
      const di = (y * strip.width + fi * size + x) << 2
      for (let k = 0; k < 4; k++) strip.data[di + k] = p.data[si + k]
    }
  })
  return strip
}
```

- [ ] **Step 5: Correr los tests (deben pasar)**

Run: `cd habitat && node --test scripts/lib/imgproc.test.mjs`
Expected: PASS — 6 tests ok.

- [ ] **Step 6: Commit**

```bash
git add habitat/package.json habitat/package-lock.json habitat/scripts/lib/imgproc.mjs habitat/scripts/lib/imgproc.test.mjs
git commit -m "feat(habitat): lib imgproc para procesar sprites generados (despeckle/downscale/strip)"
```

---

### Task 2: Cliente PixelLab (`pixellab.mjs`)

Wrapper fino de `POST /animate-with-text`. Inyecta `fetch` para poder testear el armado del request y el parseo de frames sin pegarle a la API.

**Files:**
- Create: `habitat/scripts/lib/pixellab.mjs`
- Test: `habitat/scripts/lib/pixellab.test.mjs`

**Interfaces:**
- Consumes: nada de tasks previas.
- Produces:
  - `buildAnimateRequest({ description, action, refBase64 }) -> object` — body JSON para `/animate-with-text` (image_size 64×64, view `high top-down`, direction `south`, n_frames 4, image_guidance_scale 3, text_guidance_scale 7, reference_image y color_image = `{type:'base64',base64:refBase64}`, seed = `seedFor(description+action)`).
  - `seedFor(str) -> number` — hash FNV-1a determinístico (mismo que `sprites.ts`) → seed reproducible.
  - `async animateWithText({ token, description, action, refBase64, fetchImpl = globalThis.fetch }) -> { framesBase64: string[], usage }` — hace el POST, devuelve los 4 base64 (sin prefijo `data:`).

- [ ] **Step 1: Escribir los tests (fallan)**

Create `habitat/scripts/lib/pixellab.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnimateRequest, seedFor, animateWithText } from './pixellab.mjs'

test('seedFor es determinístico y entero no-negativo', () => {
  const s1 = seedFor('knight|idle')
  const s2 = seedFor('knight|idle')
  assert.equal(s1, s2)
  assert.ok(Number.isInteger(s1) && s1 >= 0)
  assert.notEqual(seedFor('knight|idle'), seedFor('knight|work'))
})

test('buildAnimateRequest arma el body con los campos fijos', () => {
  const body = buildAnimateRequest({ description: 'knight', action: 'breathing idle', refBase64: 'AAA' })
  assert.deepEqual(body.image_size, { width: 64, height: 64 })
  assert.equal(body.view, 'high top-down')
  assert.equal(body.direction, 'south')
  assert.equal(body.n_frames, 4)
  assert.equal(body.reference_image.base64, 'AAA')
  assert.equal(body.color_image.base64, 'AAA')
  assert.equal(body.description, 'knight')
  assert.equal(body.action, 'breathing idle')
})

test('animateWithText postea y parsea frames (con prefijo data: removido)', async () => {
  let captured
  const fakeFetch = async (url, opts) => {
    captured = { url, opts }
    return {
      ok: true,
      json: async () => ({
        images: [
          { type: 'base64', base64: 'data:image/png;base64,FRAME0' },
          { type: 'base64', base64: 'FRAME1' },
          { type: 'base64', base64: 'FRAME2' },
          { type: 'base64', base64: 'FRAME3' },
        ],
        usage: { type: 'generations', generations: 1 },
      }),
    }
  }
  const res = await animateWithText({
    token: 'tok', description: 'knight', action: 'idle', refBase64: 'AAA', fetchImpl: fakeFetch,
  })
  assert.equal(captured.url, 'https://api.pixellab.ai/v1/animate-with-text')
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok')
  assert.deepEqual(res.framesBase64, ['FRAME0', 'FRAME1', 'FRAME2', 'FRAME3'])
  assert.equal(res.usage.generations, 1)
})

test('animateWithText lanza si la respuesta no es ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 402, text: async () => 'no balance' })
  await assert.rejects(
    () => animateWithText({ token: 't', description: 'd', action: 'a', refBase64: 'x', fetchImpl: fakeFetch }),
    /402/,
  )
})
```

- [ ] **Step 2: Correr los tests (deben fallar)**

Run: `cd habitat && node --test scripts/lib/pixellab.test.mjs`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `pixellab.mjs`**

Create `habitat/scripts/lib/pixellab.mjs`:

```js
const BASE = 'https://api.pixellab.ai/v1'

export function seedFor(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0)
}

export function buildAnimateRequest({ description, action, refBase64 }) {
  const img = { type: 'base64', base64: refBase64 }
  return {
    image_size: { width: 64, height: 64 },
    description,
    action,
    view: 'high top-down',
    direction: 'south',
    n_frames: 4,
    image_guidance_scale: 3.0,
    text_guidance_scale: 7.0,
    reference_image: img,
    color_image: img,
    seed: seedFor(`${description}|${action}`),
  }
}

export async function animateWithText({ token, description, action, refBase64, fetchImpl = globalThis.fetch }) {
  const body = buildAnimateRequest({ description, action, refBase64 })
  const resp = await fetchImpl(`${BASE}/animate-with-text`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`PixelLab ${resp.status}: ${detail}`)
  }
  const data = await resp.json()
  const framesBase64 = (data.images || []).map((im) => im.base64.replace(/^data:image\/png;base64,/, ''))
  return { framesBase64, usage: data.usage }
}
```

- [ ] **Step 4: Correr los tests (deben pasar)**

Run: `cd habitat && node --test scripts/lib/pixellab.test.mjs`
Expected: PASS — 4 tests ok.

- [ ] **Step 5: Commit**

```bash
git add habitat/scripts/lib/pixellab.mjs habitat/scripts/lib/pixellab.test.mjs
git commit -m "feat(habitat): cliente PixelLab animate-with-text (testeable con fetch inyectable)"
```

---

### Task 3: Script de orquestación (`animate-chars.mjs`)

CLI que, por cada personaje × animación, lee la pose sur de `idle.png`, llama a PixelLab, post-procesa y escribe el strip. Idempotente (saltea destinos existentes). No tiene unit test (pega a la API y a disco); se valida corriéndolo en la Task 4.

**Files:**
- Create: `habitat/scripts/animate-chars.mjs`

**Interfaces:**
- Consumes: `imgproc.mjs` (`cropFrame`, `upscaleNearest`, `despeckle`, `downscaleBox`, `assembleStrip`), `pixellab.mjs` (`animateWithText`), `pngjs` (`PNG.sync`).
- Produces (efectos): escribe `habitat/assets-src/char/<Char>/anim_<name>.png` y copia a `habitat/client/public/assets/char/<Char>/anim_<name>.png`.

- [ ] **Step 1: Implementar el script**

Create `habitat/scripts/animate-chars.mjs`:

```js
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
  anim_work: 'working, busy repetitive gesture, hammering',
  anim_waiting: 'waving one arm to get attention, impatient',
  anim_done: 'celebrating, raising arms, cheerful',
  anim_error: 'dizzy stumble, hurt flinch',
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
```

- [ ] **Step 2: Verificar que arranca y valida el token**

Run: `cd habitat && node scripts/animate-chars.mjs --only Knight --anim idle` (sin `PIXELLAB_TOKEN`)
Expected: imprime `Falta PIXELLAB_TOKEN` y sale con código 1.

- [ ] **Step 3: Commit**

```bash
git add habitat/scripts/animate-chars.mjs
git commit -m "feat(habitat): script animate-chars para generar animaciones de avatar con PixelLab"
```

---

### Task 4: Generar los assets (corrida real, gated por cuota)

Ejecuta el pipeline de verdad. **Requiere `PIXELLAB_TOKEN`** y consume free tier (~80 generations). Hacerlo por tandas; el script es idempotente, así que si la cuota corta se reanuda re-corriéndolo.

**Files:**
- Create (generados): `habitat/assets-src/char/<Char>/anim_*.png` y `habitat/client/public/assets/char/<Char>/anim_*.png` (80 PNG c/u).

- [ ] **Step 1: Smoke test con 1 personaje**

Run: `cd habitat && PIXELLAB_TOKEN=$PIXELLAB_TOKEN node scripts/animate-chars.mjs --only Knight`
Expected: escribe 5 archivos `anim_*.png` para Knight en ambas carpetas; log `escritos=5`.

- [ ] **Step 2: Inspección visual del smoke test**

Verificar que `habitat/client/public/assets/char/Knight/anim_idle.png` es un strip `128×32` con fondo transparente y se reconoce al Knight. (Abrir el PNG o ampliarlo con un visor.)
Expected: 4 frames coherentes, fondo transparente, identidad preservada. Si un frame sale con ruido/fondo, anotarlo; el despeckle debería haberlo limpiado.

- [ ] **Step 3: Generar el lote completo**

Run: `cd habitat && PIXELLAB_TOKEN=$PIXELLAB_TOKEN node scripts/animate-chars.mjs`
Expected: salta los 5 de Knight ya hechos, genera el resto (75). Si la API rechaza por cuota, el proceso corta con error; re-correr el mismo comando reanuda (saltea lo ya escrito).

- [ ] **Step 4: Commit de los assets**

```bash
git add habitat/assets-src/char habitat/client/public/assets/char
git commit -m "feat(habitat): assets de animaciones de avatar (idle/work/waiting/done/error x16)"
```

---

### Task 5: `import-assets.sh` preserva las animaciones

Hacer que la reconstrucción de `assets/` (que arranca con `rm -rf`) vuelva a copiar las animaciones canónicas desde `assets-src/`, para que re-correr el import no las pierda.

**Files:**
- Modify: `habitat/scripts/import-assets.sh`

- [ ] **Step 1: Agregar el paso de copia**

En `habitat/scripts/import-assets.sh`, **al final** (antes del resumen `echo`/exit), agregar:

```bash
# --- Animaciones de avatar generadas (canónicas en assets-src, fuera del pack) ---
ANIM_SRC="$ROOT/habitat/assets-src/char"
if [ -d "$ANIM_SRC" ]; then
  for cdir in "$ANIM_SRC"/*/; do
    c="$(basename "$cdir")"
    [ -d "$DST/char/$c" ] || continue
    for f in "$cdir"anim_*.png; do
      [ -f "$f" ] || continue
      cp "$f" "$DST/char/$c/"
      copied=$((copied+1))
    done
  done
fi
```

- [ ] **Step 2: Verificar idempotencia**

Run: `bash habitat/scripts/import-assets.sh && ls habitat/client/public/assets/char/Knight/anim_*.png`
Expected: tras el `rm -rf`+rebuild, los `anim_*.png` de Knight vuelven a estar presentes (copiados desde `assets-src`).

- [ ] **Step 3: Commit**

```bash
git add habitat/scripts/import-assets.sh
git commit -m "feat(habitat): import-assets restaura las animaciones de avatar desde assets-src"
```

---

### Task 6: Helper `heroAnim` en `sprites.ts`

Exponer al frontend qué strip usar según el estado.

**Files:**
- Modify: `habitat/client/src/sprites.ts`

**Interfaces:**
- Consumes: `resolveChar(name, char)` (ya existe en el archivo), tipo `Status` de `./types`.
- Produces:
  - `STATUS_ANIM: Record<Status, string>` — estado → nombre de archivo sin extensión.
  - `heroAnim(name: string, char: string | undefined, status: Status): string` — ruta `assets/char/<Char>/<anim>.png`.

- [ ] **Step 1: Implementar el helper**

En `habitat/client/src/sprites.ts`, agregar el import del tipo y las exports (cerca de `heroIdle`):

```ts
import type { Status } from './types'

export const STATUS_ANIM: Record<Status, string> = {
  idle: 'anim_idle',
  working: 'anim_work',
  waiting: 'anim_waiting',
  done: 'anim_done',
  error: 'anim_error',
  offline: 'anim_idle',
}

export function heroAnim(name: string, char: string | undefined, status: Status): string {
  return `assets/char/${resolveChar(name, char)}/${STATUS_ANIM[status]}.png`
}
```

(`resolveChar` ya está definido más arriba en el archivo; reutilizarlo, no redefinir.)

- [ ] **Step 2: Typecheck**

Run: `cd habitat/client && npm run typecheck`
Expected: sin errores de TypeScript.

- [ ] **Step 3: Commit**

```bash
git add habitat/client/src/sprites.ts
git commit -m "feat(habitat): heroAnim mapea estado de sesión a strip de animación"
```

---

### Task 7: `SessionPod.vue` anima el héroe según estado

Fuera de combate, reemplazar el héroe estático por el strip animado según `status`; en combate, sin cambios. `offline` se atenúa por CSS.

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue`

**Interfaces:**
- Consumes: `heroAnim` de `../sprites` (Task 6), `Sprite` con `mode="strip"` (ya soportado por `Sprite.vue`).

- [ ] **Step 1: Importar `heroAnim`**

En el `<script setup>` de `SessionPod.vue`, agregar `heroAnim` al import existente desde `../sprites`:

```ts
import { heroIdle, heroAnim, monsterSprite, bossSprite, fmt, ago } from '../sprites'
```

- [ ] **Step 2: Renderizar animado fuera de combate**

Reemplazar el bloque `<Sprite ... class="fighter phero" ...>` actual por dos ramas (con monstruo = comportamiento actual; sin monstruo = animado):

```html
<Sprite
  v-if="monster"
  class="fighter phero"
  :class="{ flinch }"
  :src="heroIdle(session.name, session.char)"
  :height="88"
  mode="static"
  :frame="3"
/>
<Sprite
  v-else
  class="fighter phero"
  :class="{ flinch, dim: session.status === 'offline' }"
  :key="session.status"
  :src="heroAnim(session.name, session.char, session.status)"
  :height="88"
  mode="strip"
  :duration="900"
/>
```

(El `:key="session.status"` fuerza a `Sprite.vue` a re-aplicar la animación al cambiar de estado.)

- [ ] **Step 3: Atenuar `offline` por CSS**

En el `<style scoped>` de `SessionPod.vue`, agregar:

```css
.phero.dim {
  filter: grayscale(1) brightness(0.6);
}
```

- [ ] **Step 4: Typecheck + build**

Run: `cd habitat/client && npm run build`
Expected: `vue-tsc` sin errores y build de vite ok.

- [ ] **Step 5: Verificación visual**

Levantar la GUI (`cd habitat && npm start` + cliente con `cd habitat/client && npm run dev`) y, para una sesión en cada estado, confirmar: idle respira, working/waiting/done/error muestran su gesto, offline se ve atenuado, y en combate el héroe queda como antes.
Expected: avatar animado por estado; sin regresiones en combate.

- [ ] **Step 6: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue
git commit -m "feat(habitat): el avatar del pod se anima según el estado de la sesión"
```

---

## Self-Review

**Spec coverage:**
- Generación con PixelLab `animate-with-text` desde sprite estático → Tasks 2–4. ✓
- 32×32, strip 128×32, south-facing, transparente → imgproc (Task 1) + script (Task 3). ✓
- Set de 5 animaciones + mapeo de estados → `ANIMS` (Task 3) + `STATUS_ANIM` (Task 6). ✓
- PNG en `assets/char/` versionado + reproducible (no se pierde con import-assets) → Tasks 4–5. ✓
- Frontend anima el héroe; combate intacto; offline atenuado → Task 7. ✓
- Token vía env, idempotencia, riesgo de cuota → Task 3/4. ✓

**Placeholder scan:** sin TBD/TODO; todo paso con código muestra el código. ✓

**Type consistency:** `STATUS_ANIM`/`heroAnim` (Task 6) usados en Task 7 con la misma firma; nombres de archivo `anim_*` consistentes entre `ANIMS` (Task 3), `STATUS_ANIM` (Task 6) e `import-assets.sh` (Task 5). `cropFrame/upscaleNearest/despeckle/downscaleBox/assembleStrip` y `animateWithText` usados en Task 3 con las firmas definidas en Tasks 1–2. ✓
