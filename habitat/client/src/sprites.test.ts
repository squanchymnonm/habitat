import { describe, it, expect } from 'vitest'
import { heroPoseFor, heroSprite, POSE_RENDER } from './sprites'
import type { Status } from './types'

const base = { status: 'idle' as Status, inCombat: false, jabbing: false, celebrating: false }

describe('heroPoseFor', () => {
  it('celebrating gana sobre todo', () => {
    expect(heroPoseFor({ ...base, celebrating: true, status: 'offline', inCombat: true })).toBe('jump')
  })
  it('offline -> dead (incluso en combate)', () => {
    expect(heroPoseFor({ ...base, status: 'offline', inCombat: true })).toBe('dead')
  })
  it('combate sin jab -> combat', () => {
    expect(heroPoseFor({ ...base, status: 'working', inCombat: true })).toBe('combat')
  })
  it('combate con jab -> item', () => {
    expect(heroPoseFor({ ...base, status: 'working', inCombat: true, jabbing: true })).toBe('item')
  })
  it('working -> walk', () => {
    expect(heroPoseFor({ ...base, status: 'working' })).toBe('walk')
  })
  it('done -> jump', () => {
    expect(heroPoseFor({ ...base, status: 'done' })).toBe('jump')
  })
  it('idle/waiting/error -> rest', () => {
    expect(heroPoseFor({ ...base, status: 'idle' })).toBe('rest')
    expect(heroPoseFor({ ...base, status: 'waiting' })).toBe('rest')
    expect(heroPoseFor({ ...base, status: 'error' })).toBe('rest')
  })
})

describe('heroSprite', () => {
  it('mapea pose -> archivo correcto', () => {
    expect(heroSprite('Ann', 'NinjaBlue', 'rest')).toBe('assets/char/NinjaBlue/anim_idle.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'combat')).toBe('assets/char/NinjaBlue/idle.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'walk')).toBe('assets/char/NinjaBlue/walk.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'dead')).toBe('assets/char/NinjaBlue/dead.png')
  })
})

describe('POSE_RENDER', () => {
  it('rest=strip, walk=grid, combat=static frame 3', () => {
    expect(POSE_RENDER.rest.mode).toBe('strip')
    expect(POSE_RENDER.walk.mode).toBe('grid')
    expect(POSE_RENDER.combat.mode).toBe('static')
    expect(POSE_RENDER.combat.frame).toBe(3)
  })
})
