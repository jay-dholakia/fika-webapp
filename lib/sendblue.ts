/**
 * Sendblue API client (server-side only).
 * Send messages via Concierge or Match number.
 * @see https://docs.sendblue.com/docs/outbound/
 */

const SENDBLUE_SEND_URL = 'https://api.sendblue.co/api/send-message'

export type SendblueConfig = {
  apiKeyId: string
  apiSecretKey: string
  conciergeNumber: string
  matchNumber: string | null
}

function getConfig(): SendblueConfig | null {
  const apiKeyId = process.env.SENDBLUE_API_KEY_ID
  const apiSecretKey = process.env.SENDBLUE_API_SECRET_KEY
  const concierge = process.env.SENDBLUE_CONCIERGE_NUMBER
  const match = process.env.SENDBLUE_MATCH_NUMBER || null
  if (!apiKeyId || !apiSecretKey || !concierge) return null
  return { apiKeyId, apiSecretKey, conciergeNumber: concierge, matchNumber: match || null }
}

/**
 * Send an iMessage via Sendblue.
 * @param to - Recipient E.164 (e.g. +15551234567)
 * @param content - Message text
 * @param fromConcierge - true = use Concierge number, false = use Match number
 * @returns ok, optional error, and message_handle when the API returns it (for storing in sms_conversation_states)
 */
export async function sendSendblueMessage(
  to: string,
  content: string,
  fromConcierge: boolean
): Promise<{ ok: boolean; error?: string; message_handle?: string }> {
  const config = getConfig()
  if (!config) {
    return { ok: false, error: 'Sendblue not configured' }
  }
  if (!fromConcierge && !config.matchNumber) {
    return { ok: false, error: 'Match number not configured' }
  }
  const fromNumber = fromConcierge ? config.conciergeNumber : config.matchNumber!
  try {
    const res = await fetch(SENDBLUE_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': config.apiKeyId,
        'sb-api-secret-key': config.apiSecretKey,
      },
      body: JSON.stringify({
        from_number: fromNumber,
        number: to,
        content,
      }),
    })
    const text = await res.text()
    let data: { message_handle?: string; error_message?: string } | null = null
    try {
      data = text ? (JSON.parse(text) as { message_handle?: string; error_message?: string }) : null
    } catch {
      // ignore
    }
    if (!res.ok) {
      const fallback = text || res.statusText
      const err = (data?.error_message ?? (data && 'message' in data ? String((data as { message?: string }).message) : null)) ?? fallback
      return { ok: false, error: err || 'Send failed' }
    }
    return { ok: true, message_handle: data?.message_handle }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' }
  }
}

export function sendConcierge(to: string, content: string) {
  return sendSendblueMessage(to, content, true)
}

export function sendMatch(to: string, content: string) {
  return sendSendblueMessage(to, content, false)
}

export function isSendblueConfigured(): boolean {
  return getConfig() !== null
}

/** Send a message (concierge or match). Used by complete-intake and other callers. Returns message_handle when API provides it. */
export async function sendMessage(
  to: string,
  content: string,
  opts?: { fromNumber: 'concierge' | 'match' }
): Promise<{ success: boolean; error?: string; message_handle?: string }> {
  const result = await sendSendblueMessage(to, content, opts?.fromNumber !== 'match')
  return { success: result.ok, error: result.error, message_handle: result.message_handle }
}
