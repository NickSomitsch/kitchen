import { describe, expect, it } from 'vitest'
import { hashString, recipeArt, seededRandom } from './recipeArt'

describe('recipeArt', () => {
  it('draws the same picture for the same dish every time', () => {
    const first = recipeArt('Tomato and lentil soup', ['quick'], ['Tomato', 'Lentils'])
    const second = recipeArt('Tomato and lentil soup', ['quick'], ['Tomato', 'Lentils'])
    expect(first).toEqual(second)
  })

  it('ignores casing and surrounding space, so a saved copy matches its suggestion', () => {
    expect(recipeArt('  Leek Gratin  ').seed).toBe(recipeArt('leek gratin').seed)
  })

  it('gives different dishes different pictures', () => {
    const soup = recipeArt('Carrot soup')
    const bake = recipeArt('Aubergine bake')
    expect(soup.seed).not.toBe(bake.seed)
    expect(soup.motif).not.toBe(bake.motif)
  })

  it('picks the vessel from the dish', () => {
    expect(recipeArt('Chicken curry').motif).toBe('bowl')
    expect(recipeArt('Potato gratin').motif).toBe('bake')
    expect(recipeArt('Mushroom stir-fry').motif).toBe('pan')
    expect(recipeArt('Banana smoothie').motif).toBe('glass')
    expect(recipeArt('Roasted pepper salad').motif).toBe('plate')
  })

  it('reads the vessel from tags when the name is silent', () => {
    expect(recipeArt('Sunday dinner', ['traybake']).motif).toBe('bake')
  })

  it('colours the plate from the ingredients', () => {
    const art = recipeArt('Weeknight pasta', [], ['Tomato', 'Spinach', 'Parmesan'])
    expect(art.fills).toContain('#d1503f')
    expect(art.fills).toContain('#4a8b4e')
  })

  it('prefers the longest ingredient match', () => {
    // "sweet potato" must not be read as plain "potato".
    const art = recipeArt('Traybake', [], ['Sweet potato'])
    expect(art.fills[0]).toBe('#d98b45')
  })

  it('never plates the same colour twice', () => {
    const art = recipeArt('Tomato three ways', [], ['Tomato', 'tomato paste', 'TOMATOES'])
    const duplicates = art.fills.length - new Set(art.fills).size
    expect(duplicates).toBe(0)
  })

  it('still fills a plate for a dish it does not recognise', () => {
    const art = recipeArt('Grandmother’s Sunday thing', [], ['mystery', 'another mystery'])
    expect(art.fills.length).toBeGreaterThanOrEqual(3)
    expect(art.fills.every((colour) => colour.length > 0)).toBe(true)
  })

  it('survives an empty name', () => {
    expect(() => recipeArt('')).not.toThrow()
    expect(recipeArt('').fills.length).toBeGreaterThanOrEqual(3)
  })
})

describe('seededRandom', () => {
  it('replays the same sequence for a seed', () => {
    const take = (seed: number) => {
      const next = seededRandom(seed)
      return [next(), next(), next()]
    }
    expect(take(42)).toEqual(take(42))
    expect(take(42)).not.toEqual(take(43))
  })

  it('stays inside 0..1', () => {
    const next = seededRandom(hashString('anything'))
    for (let index = 0; index < 500; index += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
