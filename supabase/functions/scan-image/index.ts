// Product and receipt recognition.
//
// The provider API key lives only in this function's secrets and never reaches the
// browser. The caller's own JWT is used for the daily credit check, so row level
// security still decides who may scan. Nothing here writes to the inventory: the
// function only proposes candidates, and a person confirms them in the app.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { ProviderError, corsHeaders, json, notConfigured, resolveProvider } from '../_shared/ai.ts'
import { recognize, type ScanMode } from './providers.ts'

const MAX_IMAGE_CHARS = 4_500_000
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const
const DAILY_SCAN_LIMIT = Number(Deno.env.get('SCAN_DAILY_LIMIT') ?? '40')

/** Splits a `data:image/jpeg;base64,...` URL into the parts a model needs. */
function parseDataUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(value.trim())
  if (!match) return null
  const [, mediaType, data] = match
  if (!(ALLOWED_MEDIA as readonly string[]).includes(mediaType)) return null
  if (data.length > MAX_IMAGE_CHARS) return null
  return { mediaType, data }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const provider = resolveProvider()
  if (!provider) return notConfigured()

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'You must be signed in.' }, 401)

  let body: { mode?: unknown; image?: unknown; categories?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Send a JSON body.' }, 400)
  }

  const mode: ScanMode | null = body.mode === 'receipt'
    ? 'receipt'
    : body.mode === 'product' ? 'product' : null
  if (!mode) return json({ error: 'Choose either product or receipt recognition.' }, 400)

  const image = parseDataUrl(body.image)
  if (!image) {
    return json({
      error: 'Send a JPEG, PNG, or WebP photo under 3 MB as a base64 data URL.',
    }, 400)
  }

  const categories = Array.isArray(body.categories)
    ? body.categories.filter((entry): entry is string => typeof entry === 'string').slice(0, 40)
    : []

  // The credit check runs as the caller, so household membership and the daily
  // limit are both enforced by the database rather than by this function.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  )
  const { data: remaining, error: creditError } = await supabase.rpc('claim_scan_credit', {
    daily_limit: DAILY_SCAN_LIMIT,
  })
  if (creditError) {
    const status = creditError.code === '53400' ? 429 : creditError.code === '42501' ? 403 : 400
    return json({ error: creditError.message }, status)
  }

  try {
    const outcome = await recognize(provider, { mode, image, categories })
    return json({
      mode,
      ...outcome,
      provider,
      remaining_today: typeof remaining === 'number' ? remaining : null,
    })
  } catch (error) {
    if (error instanceof ProviderError) return json({ error: error.message }, error.status)
    console.error('scan-image error', error)
    return json({ error: 'Image recognition failed. Try again.' }, 500)
  }
})
