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
