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
    image_guidance_scale: 4.0,
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
