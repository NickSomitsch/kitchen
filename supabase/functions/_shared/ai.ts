// One provider abstraction for every AI-backed feature. Callers supply a prompt and
// a schema; this module decides which provider may run and normalises its errors.
import { ApiError, GoogleGenAI } from 'npm:@google/genai@2.21.0'
import type { ZodType } from 'npm:zod@4.5.4'

export type Provider = 'gemini' | 'anthropic'

export class ProviderError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

/**
 * Gemini is the only provider that can start on its own. Anthropic is opt-in and
 * needs SCAN_PROVIDER=anthropic as well as its key, so a stray ANTHROPIC_API_KEY
 * can never begin billing by accident.
 */
export function resolveProvider(): Provider | null {
  const requested = Deno.env.get('SCAN_PROVIDER')?.trim().toLowerCase()
  const hasGemini = Boolean(Deno.env.get('GEMINI_API_KEY'))
  const hasAnthropic = Boolean(Deno.env.get('ANTHROPIC_API_KEY'))
  if (requested === 'anthropic') return hasAnthropic ? 'anthropic' : null
  if (requested === 'gemini') return hasGemini ? 'gemini' : null
  return hasGemini ? 'gemini' : null
}

export interface InlineImage {
  mediaType: string
  data: string
}

/** The subset of Anthropic's content blocks this module sends. */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface GenerateRequest {
  system: string
  prompt: string
  /** JSON Schema, used by Gemini's structured output. */
  jsonSchema: unknown
  /** The same contract as a Zod schema, used by Anthropic's structured output. */
  zodSchema: ZodType
  image?: InlineImage
  maxOutputTokens?: number
}

/**
 * Model names get retired, and a key is not always granted every model. Rather than
 * hard-failing on a stale id, ask the key what it can actually run and keep the
 * answer for the lifetime of the instance.
 */
let resolvedGeminiModel: string | null = null

function rankModel(name: string) {
  // Cheapest capable tier first. Within a tier a "-latest" alias wins, because it
  // keeps tracking the current model instead of ageing into another 404.
  const version = Number(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? '0')
  const score = name.endsWith('-latest') ? 500 : version
  if (name.includes('flash-lite')) return 3000 + score
  if (name.includes('flash')) return 2000 + score
  if (name.includes('pro')) return 1000 + score
  return score
}

async function usableModels(ai: GoogleGenAI): Promise<string[]> {
  const names: string[] = []
  const pager = await ai.models.list()
  for await (const model of pager) {
    const name = (model.name ?? '').replace(/^models\//, '')
    if (!name) continue
    if (model.supportedActions?.length && !model.supportedActions.includes('generateContent')) continue
    if (/embedding|aqa|tts|live|audio|image-generation|imagen|veo|robotics/i.test(name)) continue
    names.push(name)
    if (names.length >= 200) break
  }
  return names.sort((a, b) => rankModel(b) - rankModel(a))
}

async function withGemini(request: GenerateRequest, retried = false): Promise<unknown> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')!
  // A resolved model wins over the configured one, otherwise a stale GEMINI_MODEL
  // would be retried forever.
  const model = resolvedGeminiModel
    || Deno.env.get('GEMINI_MODEL')?.trim()
    || 'gemini-flash-lite-latest'
  const ai = new GoogleGenAI({ apiKey })

  const parts: Record<string, unknown>[] = []
  if (request.image) {
    parts.push({ inlineData: { mimeType: request.image.mediaType, data: request.image.data } })
  }
  parts.push({ text: request.prompt })

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        responseJsonSchema: request.jsonSchema,
        temperature: request.image ? 0 : 0.6,
        maxOutputTokens: request.maxOutputTokens ?? 8192,
      },
    })

    if (response.promptFeedback?.blockReason) {
      throw new ProviderError(422, 'That request could not be processed. Try again differently.')
    }
    const body = response.text
    if (!body) {
      const finish = response.candidates?.[0]?.finishReason
      throw new ProviderError(
        422,
        finish === 'MAX_TOKENS'
          ? 'The answer was too long to return in one go. Try narrowing the request.'
          : 'No usable answer came back. Try again.',
      )
    }
    return JSON.parse(body)
  } catch (error) {
    if (error instanceof ProviderError) throw error
    if (error instanceof SyntaxError) {
      throw new ProviderError(502, 'The answer could not be read. Try again.')
    }
    if (error instanceof ApiError) {
      if (error.status === 429) {
        throw new ProviderError(429, 'The free daily quota is used up. Try again tomorrow.')
      }
      // Gemini reports a bad key as 400 API_KEY_INVALID rather than 401, so match
      // on the reason as well as the status or a setup mistake looks like a fault.
      const invalidKey = /API_KEY_INVALID|API key not valid/i.test(error.message)
      if (error.status === 401 || error.status === 403 || invalidKey) {
        throw new ProviderError(503, 'The AI API key was rejected.')
      }
      if (error.status === 404) {
        const available = await usableModels(ai).catch(() => [] as string[])
        const fallback = retried ? undefined : available.find((name) => name !== model)
        if (fallback) {
          console.warn(`ai gemini: "${model}" unavailable, falling back to "${fallback}"`)
          resolvedGeminiModel = fallback
          return withGemini(request, true)
        }
        throw new ProviderError(
          503,
          `The model "${model}" is not available for this key${available.length ? `. Available: ${available.slice(0, 5).join(', ')}` : ''}.`,
        )
      }
      console.error('ai gemini error', error.status, error.message)
      throw new ProviderError(502, 'The request failed. Try again.')
    }
    throw error
  }
}

async function withAnthropic(request: GenerateRequest): Promise<unknown> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!
  const effort = (Deno.env.get('SCAN_EFFORT') ?? 'medium') as 'low' | 'medium' | 'high'
  // Imported here rather than at module scope so the SDK is never even fetched
  // unless someone explicitly opted this provider in.
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.123.0')
  const { zodOutputFormat } = await import('npm:@anthropic-ai/sdk@0.123.0/helpers/zod')
  const client = new Anthropic({ apiKey })

  const content: AnthropicContentBlock[] = []
  if (request.image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: request.image.mediaType,
        data: request.image.data,
      },
    })
  }
  content.push({ type: 'text', text: request.prompt })

  try {
    const response = await client.messages.parse({
      model: Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-opus-5',
      max_tokens: 16000,
      system: request.system,
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(request.zodSchema), effort },
      messages: [{ role: 'user', content }],
    })
    if (response.stop_reason === 'refusal') {
      throw new ProviderError(422, 'That request could not be processed. Try again differently.')
    }
    if (!response.parsed_output) {
      throw new ProviderError(422, 'No usable answer came back. Try again.')
    }
    return response.parsed_output
  } catch (error) {
    if (error instanceof ProviderError) throw error
    if (error instanceof Anthropic.RateLimitError) {
      throw new ProviderError(429, 'The service is busy right now. Try again in a moment.')
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new ProviderError(503, 'The AI API key was rejected.')
    }
    if (error instanceof Anthropic.APIError) {
      console.error('ai anthropic error', error.status, error.message)
      throw new ProviderError(502, 'The request failed. Try again.')
    }
    throw error
  }
}

export function generateJson(provider: Provider, request: GenerateRequest): Promise<unknown> {
  return provider === 'gemini' ? withGemini(request) : withAnthropic(request)
}

/* Shared HTTP helpers */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function notConfigured() {
  return json({
    error: 'AI features are not configured. Set the GEMINI_API_KEY function secret.',
  }, 501)
}
