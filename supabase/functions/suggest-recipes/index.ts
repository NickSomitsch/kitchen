// Recipe suggestions built from what the household actually has on hand.
//
// The inventory is read here with the caller's own token rather than accepted from
// the browser, so row level security decides what the model ever sees. Suggestions
// are returned but never stored: a person picks the ones worth keeping, and the
// app recomputes real ingredient coverage itself rather than trusting the model.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { z } from 'npm:zod@4.5.4'
import {
  ProviderError,
  corsHeaders,
  generateJson,
  json,
  notConfigured,
  resolveProvider,
} from '../_shared/ai.ts'

const DAILY_LIMIT = Number(Deno.env.get('SUGGEST_DAILY_LIMIT') ?? '20')
const UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'package'] as const
const MAX_SUGGESTIONS = 6

const SYSTEM_PROMPT = `You are a practical home cook planning meals from one household's kitchen.

Rules:
- Suggest only dishes that are genuinely cookable from the listed items, allowing for
  everyday staples most kitchens have: water, salt, pepper, cooking oil.
- When an ingredient is one of the listed items, copy that item's name exactly. This is
  how the app matches ingredients to the kitchen, so an inexact name breaks it.
- Prefer dishes that use items closest to their best-before date.
- Never suggest a dish containing anything on the avoid list. This may be an allergy.
- Give realistic quantities for the stated number of servings, and honest timings.
- Write instructions as short numbered steps.
- Suggest fewer dishes rather than padding with ones the kitchen cannot support.`

const SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      description: 'Dishes cookable from the listed items, best first.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The dish name.' },
          description: { type: 'string', description: 'One sentence on why it suits this kitchen right now.' },
          servings: { type: 'number', description: 'How many people it serves.' },
          prep_minutes: { type: 'number' },
          cook_minutes: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short lower-case tags.' },
          instructions: { type: 'string', description: 'Short numbered steps separated by newlines.' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Copy the kitchen item name exactly when it is one of them.' },
                quantity: { type: 'number', description: 'Amount for the stated servings; omit if any amount will do.' },
                unit: { type: 'string', enum: [...UNITS] },
                optional: { type: 'boolean' },
              },
              required: ['name'],
            },
          },
        },
        required: ['name', 'servings', 'ingredients', 'instructions'],
      },
    },
    notice: { type: 'string', description: 'One sentence if the kitchen is too bare to suggest much.' },
  },
  required: ['suggestions'],
} as const

const SuggestionSchema = z.object({
  suggestions: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    servings: z.number(),
    prep_minutes: z.number().nullable(),
    cook_minutes: z.number().nullable(),
    tags: z.array(z.string()),
    instructions: z.string(),
    ingredients: z.array(z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit: z.enum(UNITS).nullable(),
      optional: z.boolean().nullable(),
    })),
  })),
  notice: z.string().nullable(),
})

interface InventoryRow {
  name: string
  quantity: number
  unit: string
  expires_on: string | null
}

function daysUntil(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  const target = Date.UTC(y, m - 1, d)
  const today = new Date()
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - start) / 86_400_000)
}

/** The kitchen, written the way a person would read a shopping list. */
function describeInventory(rows: InventoryRow[]) {
  return rows.map((row) => {
    const amount = `${row.quantity} ${row.unit}`
    if (!row.expires_on) return `- ${row.name} (${amount})`
    const days = daysUntil(row.expires_on)
    if (days === null) return `- ${row.name} (${amount})`
    if (days < 0) return `- ${row.name} (${amount}, ${Math.abs(days)} days past its date)`
    if (days === 0) return `- ${row.name} (${amount}, use today)`
    return `- ${row.name} (${amount}, ${days} days left)`
  }).join('\n')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalize(raw: unknown) {
  const source = (raw ?? {}) as Record<string, unknown>
  const rows = Array.isArray(source.suggestions) ? source.suggestions : []
  const suggestions = rows
    .map((entry) => (entry ?? {}) as Record<string, unknown>)
    .filter((entry) => text(entry.name) && Array.isArray(entry.ingredients))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => {
      const servings = num(entry.servings)
      return {
        name: text(entry.name)!,
        description: text(entry.description),
        servings: servings && servings >= 1 && servings <= 100 ? Math.round(servings) : 2,
        prep_minutes: num(entry.prep_minutes),
        cook_minutes: num(entry.cook_minutes),
        tags: (Array.isArray(entry.tags) ? entry.tags : [])
          .map((tag) => text(tag))
          .filter((tag): tag is string => Boolean(tag))
          .map((tag) => tag.toLowerCase())
          .slice(0, 4),
        instructions: text(entry.instructions),
        ingredients: (entry.ingredients as unknown[])
          .map((item) => (item ?? {}) as Record<string, unknown>)
          .filter((item) => text(item.name))
          .slice(0, 40)
          .map((item) => {
            const quantity = num(item.quantity)
            const unit = typeof item.unit === 'string' && (UNITS as readonly string[]).includes(item.unit)
              ? item.unit
              : null
            return {
              name: text(item.name)!,
              // Quantity and unit only mean anything together.
              quantity: unit === null ? null : quantity,
              unit: quantity === null ? null : unit,
              optional: item.optional === true,
            }
          }),
      }
    })
    .filter((entry) => entry.ingredients.length > 0)
  return { suggestions, notice: text(source.notice) }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const provider = resolveProvider()
  if (!provider) return notConfigured()

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'You must be signed in.' }, 401)

  let body: { servings?: unknown; note?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // A body is optional for this endpoint.
  }
  const servings = typeof body.servings === 'number' && body.servings >= 1 && body.servings <= 12
    ? Math.round(body.servings)
    : 2
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : ''

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  )

  const { data: remaining, error: creditError } = await supabase.rpc('claim_ai_credit', {
    ai_feature: 'suggest',
    daily_limit: DAILY_LIMIT,
  })
  if (creditError) {
    const status = creditError.code === '53400' ? 429 : creditError.code === '42501' ? 403 : 400
    return json({ error: creditError.message }, status)
  }

  // Read the kitchen as the caller, so RLS decides what the model can ever see.
  const [inventoryResult, householdResult] = await Promise.all([
    supabase.from('inventory_items')
      .select('name, quantity, unit, expires_on')
      .gt('quantity', 0)
      .order('expires_on', { nullsFirst: false })
      .limit(200),
    supabase.from('households').select('diet_tags, avoid_ingredients').limit(1).maybeSingle(),
  ])
  if (inventoryResult.error) return json({ error: inventoryResult.error.message }, 400)

  const inventory = (inventoryResult.data ?? []) as InventoryRow[]
  if (inventory.length < 3) {
    return json({
      suggestions: [],
      notice: 'Add a few more items to your inventory and there will be more to suggest.',
      provider,
      remaining_today: typeof remaining === 'number' ? remaining : null,
    })
  }

  const diet = householdResult.data?.diet_tags ?? []
  const avoid = householdResult.data?.avoid_ingredients ?? []

  const prompt = [
    `This kitchen currently holds:`,
    describeInventory(inventory),
    '',
    `Suggest up to ${MAX_SUGGESTIONS} dishes for ${servings} ${servings === 1 ? 'person' : 'people'}.`,
    diet.length ? `Preferred styles: ${diet.join(', ')}.` : '',
    avoid.length ? `Never include, under any circumstances: ${avoid.join(', ')}.` : '',
    note ? `The cook also asked: ${note}` : '',
  ].filter(Boolean).join('\n')

  try {
    const raw = await generateJson(provider, {
      system: SYSTEM_PROMPT,
      prompt,
      jsonSchema: SUGGESTION_JSON_SCHEMA,
      zodSchema: SuggestionSchema,
      maxOutputTokens: 12000,
    })
    return json({
      ...normalize(raw),
      provider,
      remaining_today: typeof remaining === 'number' ? remaining : null,
    })
  } catch (error) {
    if (error instanceof ProviderError) return json({ error: error.message }, error.status)
    console.error('suggest-recipes error', error)
    return json({ error: 'Suggestions failed. Try again.' }, 500)
  }
})
