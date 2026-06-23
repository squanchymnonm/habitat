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
