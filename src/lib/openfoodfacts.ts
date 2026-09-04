import type { Nutrition, ProductFacts, Unit } from '../types/database'

const API_ROOT = 'https://world.openfoodfacts.org/api/v2/product'

const FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'image_front_small_url',
  'image_small_url',
  'nutriments',
  'nutriscore_grade',
  'serving_size',
  'ingredients_text',
  'allergens_tags',
  'categories_tags',
].join(',')

interface OffNutriments {
  [key: string]: number | string | undefined
}

interface OffProduct {
  code?: string
  product_name?: string
  generic_name?: string
  brands?: string
  quantity?: string
  product_quantity?: number | string
  product_quantity_unit?: string
  image_front_small_url?: string
  image_small_url?: string
  nutriments?: OffNutriments
  nutriscore_grade?: string
  serving_size?: string
  ingredients_text?: string
  allergens_tags?: string[]
  categories_tags?: string[]
}

export class ProductNotFoundError extends Error {
  barcode: string

  constructor(barcode: string) {
    super('That barcode is not in the Open Food Facts database yet.')
    this.name = 'ProductNotFoundError'
    this.barcode = barcode
  }
}

/** Open Food Facts stores retail codes as EAN-13, so a 12-digit UPC-A gains a leading zero. */
export function normalizeBarcode(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12) return `0${digits}`
  return digits
}

/** GS1 modulo-10 check digit, used to reject misreads before a network round trip. */
export function isValidBarcode(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(digits.length)) return false
  const body = digits.slice(0, -1).split('').reverse()
  const expected = Number(digits.slice(-1))
  const sum = body.reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  )
  return (10 - (sum % 10)) % 10 === expected
}

function readNumber(value: number | string | undefined) {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number | null, places = 2) {
  if (value === null) return null
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Converts a package size such as "1.5 l" or "500 cl" into a unit the inventory understands. */
export function toInventoryQuantity(
  amount: number | null,
  rawUnit: string | undefined,
): { quantity: number; unit: Unit } | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null
  const unit = (rawUnit ?? 'g').trim().toLowerCase()
  const convert = (quantity: number, target: Unit) => ({
    quantity: Math.round(quantity * 1000) / 1000,
    unit: target,
  })
  switch (unit) {
    case 'g':
      return convert(amount, 'g')
    case 'mg':
      return convert(amount / 1000, 'g')
    case 'kg':
      return convert(amount, 'kg')
    case 'ml':
      return convert(amount, 'ml')
    case 'cl':
      return convert(amount * 10, 'ml')
    case 'dl':
      return convert(amount * 100, 'ml')
    case 'l':
    case 'liter':
    case 'litre':
      return convert(amount, 'l')
    default:
      return null
  }
}

function readNutrition(product: OffProduct): Nutrition | null {
  const nutriments = product.nutriments
  if (!nutriments) return null
  const values = {
    energy_kcal: round(readNumber(nutriments['energy-kcal_100g']), 0),
    fat: round(readNumber(nutriments.fat_100g)),
    saturated_fat: round(readNumber(nutriments['saturated-fat_100g'])),
    carbohydrates: round(readNumber(nutriments.carbohydrates_100g)),
    sugars: round(readNumber(nutriments.sugars_100g)),
    fibre: round(readNumber(nutriments.fiber_100g)),
    proteins: round(readNumber(nutriments.proteins_100g)),
    salt: round(readNumber(nutriments.salt_100g)),
  }
  if (Object.values(values).every((value) => value === null)) return null
  const packageUnit = (product.product_quantity_unit ?? '').toLowerCase()
  return {
    ...values,
    basis: ['ml', 'cl', 'dl', 'l'].includes(packageUnit) ? 'ml' : 'g',
    per: 100,
    serving_size: product.serving_size?.trim() || null,
    nutriscore: product.nutriscore_grade?.trim().toLowerCase() || null,
    source: 'openfoodfacts',
    updated_at: new Date().toISOString(),
  }
}

function readAllergens(product: OffProduct) {
  return (product.allergens_tags ?? [])
    .map((tag) => tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40)
}

export function productFromOpenFoodFacts(product: OffProduct, barcode: string): ProductFacts {
  const size = toInventoryQuantity(
    readNumber(product.product_quantity),
    product.product_quantity_unit,
  )
  const name = product.product_name?.trim() || product.generic_name?.trim() || ''
  return {
    barcode,
    name,
    brand: product.brands?.split(',')[0]?.trim() || null,
    image_url: product.image_front_small_url ?? product.image_small_url ?? null,
    package_quantity: size?.quantity ?? null,
    package_unit: size?.unit ?? null,
    nutrition: readNutrition(product),
    ingredients_text: product.ingredients_text?.trim().slice(0, 4000) || null,
    allergens: readAllergens(product),
    source: 'openfoodfacts',
    origin: 'network',
  }
}

/**
 * Looks a barcode up in the community Open Food Facts database. The data is
 * crowd-sourced and can be incomplete, so every field it returns stays editable.
 */
export async function lookupBarcode(
  rawBarcode: string,
  signal?: AbortSignal,
): Promise<ProductFacts> {
  const barcode = normalizeBarcode(rawBarcode)
  if (!barcode) throw new Error('Enter a barcode.')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8_000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(
      `${API_ROOT}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`,
      { signal: controller.signal, headers: { Accept: 'application/json' } },
    )
    if (response.status === 404) throw new ProductNotFoundError(barcode)
    if (!response.ok) throw new Error('Open Food Facts could not be reached right now.')
    const body = await response.json() as { status?: number; product?: OffProduct }
    if (body.status !== 1 || !body.product) throw new ProductNotFoundError(barcode)
    const facts = productFromOpenFoodFacts(body.product, barcode)
    if (!facts.name) throw new ProductNotFoundError(barcode)
    return facts
  } catch (error) {
    if (error instanceof ProductNotFoundError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The product lookup timed out.', { cause: error })
    }
    if (error instanceof TypeError) {
      throw new Error('Open Food Facts could not be reached. Check your connection.', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Open Food Facts category tags map loosely onto the household's own category names. */
export function suggestCategory(
  facts: Pick<ProductFacts, 'name'> & { categories?: string[] },
  categories: { id: string; name: string }[],
) {
  const haystack = [...(facts.categories ?? []), facts.name].join(' ').toLowerCase()
  const rules: { match: RegExp; category: RegExp }[] = [
    { match: /milk|cheese|yog|yaourt|butter|cream|egg/, category: /dairy|egg/ },
    { match: /beef|pork|chicken|fish|salmon|tuna|meat|ham|sausage/, category: /meat|fish/ },
    { match: /bread|baguette|bakery|pastry|croissant/, category: /bakery|bread/ },
    { match: /fruit|vegetable|salad|tomato|apple|banana|potato/, category: /produce|fruit|veg/ },
    { match: /frozen|ice cream/, category: /frozen/ },
    { match: /water|juice|soda|cola|coffee|tea|beer|wine|drink|beverage/, category: /beverage|drink/ },
    { match: /spice|herb|pepper|salt|seasoning/, category: /spice/ },
    { match: /pasta|rice|flour|sugar|oil|sauce|cereal|snack|biscuit|chocolate|spread/, category: /pantry|dry|staple/ },
  ]
  for (const rule of rules) {
    if (!rule.match.test(haystack)) continue
    const category = categories.find((candidate) => rule.category.test(candidate.name.toLowerCase()))
    if (category) return category.id
  }
  return ''
}
