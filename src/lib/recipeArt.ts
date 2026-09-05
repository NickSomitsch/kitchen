/**
 * A picture for every recipe, drawn from the recipe itself.
 *
 * Suggestions arrive as text, and a shared placeholder makes six of them look like
 * one thing repeated. These illustrations are derived entirely from the dish — its
 * name picks the palette and the vessel, its ingredients pick the colours on the
 * plate — so each recipe gets a stable picture of its own without a network call,
 * an API key, or anything to pay for. A real photograph, once someone has one,
 * always wins: this is what fills the gap until then.
 */

export type Motif = 'bowl' | 'plate' | 'pan' | 'bake' | 'glass'

export interface RecipePalette {
  base: string
  shade: string
  vessel: string
  rim: string
}

export interface RecipeArtSpec {
  palette: RecipePalette
  motif: Motif
  /** Ingredient colours, most telling first. Always at least three. */
  fills: string[]
  seed: number
}

const PALETTES: RecipePalette[] = [
  { base: '#f7f0e1', shade: '#e6d9bf', vessel: '#fffdf8', rim: '#e0d3b9' },
  { base: '#eaf1e7', shade: '#d2e1ce', vessel: '#fbfcf7', rim: '#c8dbc4' },
  { base: '#fbeade', shade: '#f2d2c0', vessel: '#fffbf7', rim: '#eecbb7' },
  { base: '#e7eef4', shade: '#ccdae7', vessel: '#fbfdff', rim: '#c4d6e5' },
  { base: '#f3eaf1', shade: '#e2d0dd', vessel: '#fffbfe', rim: '#dbc6d4' },
  { base: '#eff1e3', shade: '#dcdfc4', vessel: '#fdfdf6', rim: '#d4d8bc' },
]

/**
 * Ordered longest-first when matching, so "sweet potato" is not read as "potato"
 * and "spring onion" is not read as "onion".
 */
const INGREDIENT_COLOURS: [string, string][] = [
  ['sweet potato', '#d98b45'], ['spring onion', '#7fa855'], ['red pepper', '#cf4a3e'],
  ['bell pepper', '#d4574a'], ['green bean', '#5f9455'], ['cherry tomato', '#cf4436'],
  ['sun-dried tomato', '#a83c33'], ['tomato', '#d1503f'], ['carrot', '#e08a3c'],
  ['pumpkin', '#dd8b3a'], ['butternut', '#dd9440'], ['squash', '#dd9440'],
  ['spinach', '#4a8b4e'], ['kale', '#437c46'], ['broccoli', '#4f8b52'],
  ['courgette', '#7ba85f'], ['zucchini', '#7ba85f'], ['cucumber', '#74a45f'],
  ['pea', '#66a35a'], ['asparagus', '#6f9c55'], ['basil', '#4d8a4a'],
  ['parsley', '#4f8f4c'], ['coriander', '#529150'], ['cilantro', '#529150'],
  ['herb', '#4f8b52'], ['lettuce', '#82ad6a'], ['cabbage', '#7fa06a'],
  ['avocado', '#6f9455'], ['olive', '#6d7b46'], ['potato', '#ddb56a'],
  ['rice', '#eeddb8'], ['pasta', '#e9d3a4'], ['spaghetti', '#e9d3a4'],
  ['noodle', '#e6cd9c'], ['bread', '#d9b477'], ['toast', '#d9b477'],
  ['flour', '#eee2ca'], ['oat', '#e2cfa8'], ['couscous', '#e7d5ac'],
  ['quinoa', '#dcc9a2'], ['tortilla', '#e5cfa3'], ['cheese', '#edc75c'],
  ['parmesan', '#e8ca77'], ['mozzarella', '#f4ecd8'], ['feta', '#f2eee2'],
  ['egg', '#f2d16b'], ['chicken', '#d8a86c'], ['turkey', '#d3a06a'],
  ['beef', '#a05445'], ['steak', '#9c4f42'], ['lamb', '#9d5648'],
  ['mince', '#a85a49'], ['pork', '#c07a63'], ['bacon', '#c25f4e'],
  ['chorizo', '#b84a3c'], ['ham', '#dd8f80'], ['sausage', '#a9614a'],
  ['salmon', '#e2846b'], ['tuna', '#c06a55'], ['prawn', '#ea9a7d'],
  ['shrimp', '#ea9a7d'], ['fish', '#dfa07f'], ['mushroom', '#a98567'],
  ['onion', '#e6ddc9'], ['garlic', '#eee7d6'], ['leek', '#c9d8b0'],
  ['lemon', '#edd25e'], ['lime', '#b7cc55'], ['orange', '#e3843c'],
  ['corn', '#ecc84e'], ['sweetcorn', '#ecc84e'], ['bean', '#b98f5b'],
  ['lentil', '#c08a52'], ['chickpea', '#d8b878'], ['aubergine', '#6b4b7a'],
  ['eggplant', '#6b4b7a'], ['beet', '#8c3a5c'], ['chocolate', '#6b4230'],
  ['strawberry', '#cf4459'], ['raspberry', '#c0455f'], ['blueberry', '#4d5a91'],
  ['berry', '#b8455f'], ['apple', '#b8443f'], ['banana', '#e8c964'],
  ['milk', '#f4efe4'], ['cream', '#f4ecdc'], ['yoghurt', '#f3eee2'],
  ['yogurt', '#f3eee2'], ['butter', '#f0d99a'], ['coconut', '#f0ece2'],
  ['tofu', '#ecd9b0'], ['curry', '#dda23a'], ['turmeric', '#dda23a'],
  ['paprika', '#c8583c'], ['chilli', '#c8402f'], ['chili', '#c8402f'],
  ['soy', '#7b5334'], ['honey', '#e0a83f'], ['walnut', '#a5794f'],
  ['almond', '#d9be92'], ['nut', '#c19a68'], ['pesto', '#6a9350'],
]

const MOTIF_WORDS: [string, Motif][] = [
  ['soup', 'bowl'], ['stew', 'bowl'], ['broth', 'bowl'], ['chowder', 'bowl'],
  ['curry', 'bowl'], ['ramen', 'bowl'], ['pho', 'bowl'], ['chilli', 'bowl'],
  ['chili', 'bowl'], ['risotto', 'bowl'], ['porridge', 'bowl'], ['oatmeal', 'bowl'],
  ['dal', 'bowl'], ['daal', 'bowl'], ['congee', 'bowl'], ['bowl', 'bowl'],
  ['casserole', 'bake'], ['gratin', 'bake'], ['lasagne', 'bake'], ['lasagna', 'bake'],
  ['bake', 'bake'], ['roast', 'bake'], ['tray', 'bake'], ['pie', 'bake'],
  ['tart', 'bake'], ['quiche', 'bake'], ['pizza', 'bake'], ['moussaka', 'bake'],
  ['stir-fry', 'pan'], ['stir fry', 'pan'], ['fry', 'pan'], ['omelette', 'pan'],
  ['omelet', 'pan'], ['frittata', 'pan'], ['pancake', 'pan'], ['hash', 'pan'],
  ['scramble', 'pan'], ['skillet', 'pan'], ['shakshuka', 'pan'], ['paella', 'pan'],
  ['smoothie', 'glass'], ['shake', 'glass'], ['juice', 'glass'], ['lassi', 'glass'],
  ['salad', 'plate'], ['sandwich', 'plate'], ['wrap', 'plate'], ['burger', 'plate'],
  ['taco', 'plate'], ['steak', 'plate'], ['schnitzel', 'plate'],
]

/** FNV-1a: small, stable, and good enough to scatter similar names apart. */
export function hashString(value: string) {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function motifFor(haystack: string): Motif {
  // The latest match wins, because an English dish name puts its head noun last:
  // "roasted pepper salad" is a salad, not a roast. Length breaks ties so a word
  // is never beaten by another that merely starts later inside it.
  let best: Motif = 'plate'
  let bestAt = -1
  let bestLength = 0
  for (const [word, motif] of MOTIF_WORDS) {
    const at = haystack.lastIndexOf(word)
    if (at > bestAt || (at === bestAt && word.length > bestLength)) {
      if (at === -1) continue
      best = motif
      bestAt = at
      bestLength = word.length
    }
  }
  return best
}

function colourFor(ingredient: string) {
  const name = ingredient.toLowerCase()
  let best: string | null = null
  let bestLength = 0
  for (const [word, colour] of INGREDIENT_COLOURS) {
    if (word.length > bestLength && name.includes(word)) {
      best = colour
      bestLength = word.length
    }
  }
  return best
}

/**
 * Padding colours for a dish whose ingredients we do not recognise. Derived from the
 * seed so an unknown dish still looks like itself rather than like every other one.
 */
function fallbackFills(seed: number) {
  const hues = [28, 44, 96, 12, 200]
  return hues.map((offset, index) => {
    const hue = (seed + offset * (index + 3)) % 360
    return `hsl(${hue} 42% ${58 + ((seed >> (index * 3)) % 12)}%)`
  })
}

export function recipeArt(
  name: string,
  tags: readonly string[] = [],
  ingredients: readonly string[] = [],
): RecipeArtSpec {
  const seed = hashString(name.trim().toLowerCase() || 'recipe')
  const haystack = [name, ...tags].join(' ').toLowerCase()

  const known = ingredients
    .map(colourFor)
    .filter((colour): colour is string => Boolean(colour))
  // Duplicates carry no information on a plate, so keep the first of each.
  const unique = [...new Set(known)].slice(0, 5)
  const fills = unique.length >= 3
    ? unique
    : [...unique, ...fallbackFills(seed).filter((colour) => !unique.includes(colour))].slice(0, 3)

  return {
    palette: PALETTES[seed % PALETTES.length],
    motif: motifFor(haystack),
    fills,
    seed,
  }
}

/** Deterministic 0..1 stream, so a dish is plated the same way every time. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
