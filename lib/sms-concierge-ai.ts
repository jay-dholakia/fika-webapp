/**
 * OpenAI-powered SMS replies for confirmed upcoming Fikas (strict guardrails; no state changes).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const CONFIRMED_FIKA_CONCIERGE_AI_CONTEXT = 'confirmed_fika_concierge_ai'

export function getOpenAiKeyForSms(): string | null {
  const k = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY
  return k?.trim() ? k.trim() : null
}

export function getSmsAiMaxPer24h(): number {
  const raw = process.env.SMS_AI_MAX_PER_24H
  const n = raw != null && raw !== '' ? Number.parseInt(raw, 10) : 8
  return Number.isFinite(n) && n >= 1 ? n : 8
}

export async function countConfirmedFikaAiRepliesLast24h(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('message_ledger')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('direction', 'outbound')
    .eq('context', CONFIRMED_FIKA_CONCIERGE_AI_CONTEXT)
    .gte('created_at', since)
  if (error) {
    console.error('[sms-concierge-ai] rate count failed', error)
    return Number.MAX_SAFE_INTEGER
  }
  return count ?? 0
}

function sanitizeConciergeReply(text: string): string {
  let t = text.trim().replace(/\n+/g, ' ')
  t = t.replace(/\s{2,}/g, ' ')
  if (t.length > 420) t = t.slice(0, 417) + '…'
  return t
}

export async function fetchConfirmedFikaConciergeReply(params: {
  apiKey: string
  userMessage: string
  fikaSummary: string
  relayWindowDescription: string
  allowedActionsLine: string
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { apiKey, userMessage, fikaSummary, relayWindowDescription, allowedActionsLine } = params
  const system = `You are Fika's SMS concierge. Reply in plain text for a single SMS: max 320 characters, warm and concise. Prefer one short paragraph. Avoid emojis unless the user used one.

Rules:
- Do NOT change scheduling, reschedule, cancel, or confirm times yourself. Do NOT promise to forward or relay messages to the other person (another system may handle that).
- Do NOT ask for or share phone numbers, email, street addresses, or full names; do not invent PII.
- If the user asks to change time, cancel, or get account help, tell them to use the exact keywords Reschedule, Cancel, or Help — those are detected automatically — or visit letsfika.co
- Do not give medical, legal, or financial advice.
- Stay on-topic: this Fika meetup and light social coaching only.

Context:
${fikaSummary}

${relayWindowDescription}

${allowedActionsLine}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.35,
        max_tokens: 200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage },
        ],
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, error: `OpenAI ${res.status}: ${t.slice(0, 200)}` }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: 'empty_response' }
    }
    return { ok: true, text: sanitizeConciergeReply(text) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' }
  }
}
