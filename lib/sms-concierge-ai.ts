/**
 * OpenAI-powered SMS replies for confirmed upcoming Fikas (strict guardrails; no state changes).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const CONFIRMED_FIKA_CONCIERGE_AI_CONTEXT = 'confirmed_fika_concierge_ai'
export const GLOBAL_READY_CONCIERGE_AI_CONTEXT = 'global_ready_concierge_ai'

export function getOpenAiKeyForSms(): string | null {
  const k = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY
  return k?.trim() ? k.trim() : null
}

export function getSmsAiMaxPer24h(): number {
  const raw = process.env.SMS_AI_MAX_PER_24H
  const n = raw != null && raw !== '' ? Number.parseInt(raw, 10) : 8
  return Number.isFinite(n) && n >= 1 ? n : 8
}

/** AI replies while in global SMS lane (no match yet); defaults to same cap as confirmed-Fika AI. */
export function getSmsAiMaxGlobalReadyPer24h(): number {
  const raw = process.env.SMS_AI_MAX_GLOBAL_READY_PER_24H
  if (raw == null || raw === '') return getSmsAiMaxPer24h()
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : getSmsAiMaxPer24h()
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

export async function countGlobalReadyAiRepliesLast24h(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('message_ledger')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('direction', 'outbound')
    .eq('context', GLOBAL_READY_CONCIERGE_AI_CONTEXT)
    .gte('created_at', since)
  if (error) {
    console.error('[sms-concierge-ai] global ready rate count failed', error)
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

/** Tone down "Hey Name!" every turn — keep reply if stripping would empty it. */
function dampNameCadenceInGlobalReply(text: string, firstName?: string | null): string {
  if (!firstName?.trim()) return text
  const n = firstName.trim()
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let t = text.trim()
  t = t.replace(new RegExp(`^hey\\s+${esc}\\s*[!,.]*\\s+`, 'i'), '')
  t = t.replace(new RegExp(`^${esc}\\s*,\\s+`, 'i'), '')
  t = t.replace(new RegExp(`^${esc}\\s*[!.]\\s+`, 'i'), '')
  // Trailing ", Name!" / ", Name! 😊" (name + optional punct + short tail to EOL)
  t = t.replace(new RegExp(`,\\s*${esc}\\s*[!.,]*\\s*\\S{0,8}$`, 'i'), '').trim()
  t = t.replace(new RegExp(`,\\s*${esc}\\s*$`, 'i'), '').trim()
  return t.length > 0 ? t : text
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
- Do NOT change scheduling, cancel, or confirm times yourself. Do NOT promise to forward or relay messages to the other person (another system may handle that).
- Do NOT ask for or share phone numbers, email, street addresses, or full names; do not invent PII.
- If the user asks to change or reschedule the time, say we cannot move the Fika time by text; they can reply Cancel if they cannot make it, or Help — or visit letsfika.co for their account.
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

export async function fetchGlobalReadyConciergeReply(params: {
  apiKey: string
  userMessage: string
  firstName?: string
  marketLabel?: string
  appBaseUrl: string
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { apiKey, userMessage, firstName, marketLabel, appBaseUrl } = params
  const nameHint = firstName
    ? `Their first name is ${firstName} — for context only; do NOT use it in every reply.`
    : 'You do not know their name; never invent one.'
  const where = marketLabel
    ? `Their market is ${marketLabel} — Fika runs periodic coffee meetups here. We text them when there's an upcoming event.`
    : "They're in a Fika market — we text them when there's an upcoming event."

  const system = `You are the Fika SMS line: a friendly, casual text buddy — not a form letter. One short SMS bubble, max 300 characters, plain text, warm and human. You may use a light emoji only if the user did or the tone is celebratory.

How real texting sounds: people rarely say each other's names every message. Do NOT open with "Hey [Name]!" or "[Name]!" on every turn — that reads like a bot. ${firstName ? `Use "${firstName}" at most occasionally (e.g. once after several messages, or for a warm beat — most replies should have no name at all.)` : 'Do not use a name.'}

What Fika is: we run periodic in-person coffee meetups. When there's one in the user's area, we text them an invite. The user is ALREADY signed up and in our system — do not treat them as a new user or suggest they need to sign up.

Rules:
- Do NOT promise an event on a specific date or timeline. Do NOT say "we'll text you Tuesday" or similar.
- If they say "set me up", "sign me up", or similar: acknowledge they're already set up and we'll text them when there's a Fika in their area.
- Do NOT collect or ask for full address, last name, or other sensitive PII. Do not invent details about the user.
- Do not give medical, legal, or financial advice. No therapy.
- If they ask about their profile or account, suggest ${appBaseUrl}.
- If they need human help, they can text HELP.
- Stay kind and brief. If they're venting, acknowledge lightly; you are not a counselor.

Context for this user:
${nameHint}
${where}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.45,
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
    const cleaned = sanitizeConciergeReply(text)
    return { ok: true, text: dampNameCadenceInGlobalReply(cleaned, firstName) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' }
  }
}
