import { describe, expect, it } from 'vitest'
import {
  isValidBarcode,
  normalizeBarcode,
  productFromOpenFoodFacts,
  suggestCategory,
  toInventoryQuantity,
} from './openfoodfacts'
import { BarcodeStabilizer } from './barcode'

describe('barcodes', () => {
  it('pads a 12-digit UPC-A to the EAN-13 form Open Food Facts stores', () => {
    expect(normalizeBarcode('737628064502')).toBe('0737628064502')
    expect(normalizeBarcode('3017624010701')).toBe('3017624010701')
    expect(normalizeBarcode(' 4006381-333931 ')).toBe('4006381333931')
  })

  it('checks the GS1 check digit', () => {
    expect(isValidBarcode('3017624010701')).toBe(true)
    expect(isValidBarcode('4006381333931')).toBe(true)
    expect(isValidBarcode('5000112548167')).toBe(true)
    expect(isValidBarcode('3017624010702')).toBe(false)
    expect(isValidBarcode('12345')).toBe(false)
  })

  it('accepts a checksummed read immediately and an unchecked one only twice', () => {
    const stabilizer = new BarcodeStabilizer()
    expect(stabilizer.push(['3017624010701'])).toBe('3017624010701')

    const unchecked = new BarcodeStabilizer()
    expect(unchecked.push(['1234567'])).toBeNull()
    expect(unchecked.push(['1234567'])).toBe('1234567')
  })

  it('ignores frames that decode to something that is not a product code', () => {
    const stabilizer = new BarcodeStabilizer()
    expect(stabilizer.push([])).toBeNull()
    expect(stabilizer.push(['https://example.com'])).toBeNull()
    expect(stabilizer.push(['abc'])).toBeNull()
  })
})

describe('package sizes', () => {
  it('maps metric package units onto the app’s own units', () => {
    expect(toInventoryQuantity(400, 'g')).toEqual({ quantity: 400, unit: 'g' })
    expect(toInventoryQuantity(1.5, 'l')).toEqual({ quantity: 1.5, unit: 'l' })
    expect(toInventoryQuantity(50, 'cl')).toEqual({ quantity: 500, unit: 'ml' })
    expect(toInventoryQuantity(500, 'mg')).toEqual({ quantity: 0.5, unit: 'g' })
  })

  it('gives up rather than guessing an unknown or invalid size', () => {
    expect(toInventoryQuantity(12, 'oz')).toBeNull()
    expect(toInventoryQuantity(0, 'g')).toBeNull()
    expect(toInventoryQuantity(null, 'g')).toBeNull()
  })
})

describe('reading a product record', () => {
  const raw = {
    code: '3017624010701',
    product_name: 'Nutella',
    brands: 'Ferrero, Nutella',
    product_quantity: 400,
    product_quantity_unit: 'g',
    image_front_small_url: 'https://images.openfoodfacts.org/front.jpg',
    nutriscore_grade: 'e',
    serving_size: '15 g',
    ingredients_text: 'sugar, palm oil, hazelnuts',
    allergens_tags: ['en:nuts', 'en:milk'],
    nutriments: {
      'energy-kcal_100g': 539,
      fat_100g: 30.9,
      'saturated-fat_100g': 10.6,
      carbohydrates_100g: 57.5,
      sugars_100g: 56.3,
      proteins_100g: 6.3,
      salt_100g: 0.1075,
    },
  }

  it('keeps the first brand and the package size', () => {
    const facts = productFromOpenFoodFacts(raw, '3017624010701')
    expect(facts.name).toBe('Nutella')
    expect(facts.brand).toBe('Ferrero')
    expect(facts.package_quantity).toBe(400)
    expect(facts.package_unit).toBe('g')
    expect(facts.allergens).toEqual(['nuts', 'milk'])
  })

  it('rounds the nutrition panel and records where it came from', () => {
    const facts = productFromOpenFoodFacts(raw, '3017624010701')
    expect(facts.nutrition?.energy_kcal).toBe(539)
    expect(facts.nutrition?.salt).toBe(0.11)
    expect(facts.nutrition?.basis).toBe('g')
    expect(facts.nutrition?.per).toBe(100)
    expect(facts.nutrition?.source).toBe('openfoodfacts')
    expect(facts.nutrition?.nutriscore).toBe('e')
  })

  it('uses a millilitre basis for drinks', () => {
    const drink = productFromOpenFoodFacts(
      { ...raw, product_quantity: 1.5, product_quantity_unit: 'l' },
      '3017624010701',
    )
    expect(drink.nutrition?.basis).toBe('ml')
    expect(drink.package_unit).toBe('l')
  })

  it('returns no panel at all when every value is missing', () => {
    const bare = productFromOpenFoodFacts(
      { product_name: 'Mystery jar', nutriments: {} },
      '0000000000000',
    )
    expect(bare.nutrition).toBeNull()
    expect(bare.package_quantity).toBeNull()
  })
})

describe('category suggestions', () => {
  const categories = [
    { id: 'dairy', name: 'Dairy & Eggs' },
    { id: 'produce', name: 'Produce' },
    { id: 'pantry', name: 'Pantry' },
  ]

  it('matches an obvious product to an existing household category', () => {
    expect(suggestCategory({ name: 'Whole milk' }, categories)).toBe('dairy')
    expect(suggestCategory({ name: 'Basmati rice' }, categories)).toBe('pantry')
    expect(suggestCategory({ name: 'Bananas' }, categories)).toBe('produce')
  })

  it('returns nothing rather than a wrong guess', () => {
    expect(suggestCategory({ name: 'Sponge scourer' }, categories)).toBe('')
    expect(suggestCategory({ name: 'Whole milk' }, [{ id: 'other', name: 'Other' }])).toBe('')
  })
})
