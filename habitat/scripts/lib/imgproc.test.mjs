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
