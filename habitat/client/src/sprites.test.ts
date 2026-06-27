import { describe, it, expect } from 'vitest'
import { heroPoseFor, heroSprite, POSE_RENDER, staminaHue } from './sprites'
import type { Status } from './types'

const base = { status: 'idle' as Status, inCombat: false, celebrating: false }

describe('heroPoseFor', () => {
  it('celebrating gana sobre todo', () => {
    expect(heroPoseFor({ ...base, celebrating: true, status: 'offline', inCombat: true })).toBe('jump')
  })
  it('offline -> dead (incluso en combate)', () => {
    expect(heroPoseFor({ ...base, status: 'offline', inCombat: true })).toBe('dead')
  })
  it('en combate -> combat', () => {
    expect(heroPoseFor({ ...base, status: 'working', inCombat: true })).toBe('combat')
    expect(heroPoseFor({ ...base, status: 'waiting', inCombat: true })).toBe('combat')
  })
  it('working sin monstruo -> walk', () => {
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
    expect(heroSprite('Ann', 'NinjaBlue', 'combat')).toBe('assets/char/NinjaBlue/anim_combat.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'walk')).toBe('assets/char/NinjaBlue/walk.png')
    expect(heroSprite('Ann', 'NinjaBlue', 'dead')).toBe('assets/char/NinjaBlue/dead.png')
  })
})

describe('POSE_RENDER', () => {
  it('rest anima (strip), walk es grid, combat es estático en idle (frame 0)', () => {
    expect(POSE_RENDER.rest.mode).toBe('strip')
    expect(POSE_RENDER.walk.mode).toBe('grid')
    expect(POSE_RENDER.combat.mode).toBe('static')
    expect(POSE_RENDER.combat.frame).toBe(0)
    expect(POSE_RENDER.combat.file).toBe('anim_combat')
  })
})

describe('staminaHue', () => {
  it('mapea 0/50/100 a rojo/amarillo/verde', () => {
    expect(staminaHue(0)).toBe(0)
    expect(staminaHue(50)).toBe(60)
    expect(staminaHue(100)).toBe(120)
  })
  it('clampa fuera de rango', () => {
    expect(staminaHue(-10)).toBe(0)
    expect(staminaHue(150)).toBe(120)
  })
  it('redondea a entero', () => {
    expect(staminaHue(33)).toBe(40) // 33 * 1.2 = 39.6 -> 40
  })
})
