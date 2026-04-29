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

export function getConfig(): SendblueConfig | null {
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
  fromConcierge: boolean,
  mediaUrl?: string | null
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
        ...(mediaUrl?.trim() ? { media_url: mediaUrl.trim() } : {}),
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

export function sendConcierge(to: string, content: string, mediaUrl?: string | null) {
  return sendSendblueMessage(to, content, true, mediaUrl)
}

export function sendMatch(to: string, content: string) {
  return sendSendblueMessage(to, content, false)
}

export function isSendblueConfigured(): boolean {
  return getConfig() !== null
}

/** Base API host; Sendblue v1 send uses api.sendblue.co; typing/read use api.sendblue.com in docs. Override if your project uses one host for all. */
function sendblueApiHostForPresence(): string {
  return process.env.SENDBLUE_API_HOST?.trim() || 'https://api.sendblue.com'
}

/**
 * Mark the user's thread as read (iMessage/RCS best-effort; not SMS). Call shortly after inbound.
 * @see https://docs.sendblue.com/api-v2/read-receipts/index.md
 */
export async function markConversationRead(peerNumberE164: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.SENDBLUE_CHAT_PRESENCE_ENABLED === 'false') return { ok: true }
  const config = getConfig()
  if (!config) return { ok: false, error: 'Sendblue not configured' }
  const number = peerNumberE164.startsWith('+') ? peerNumberE164 : `+${peerNumberE164.replace(/\D/g, '')}`
  const url = `${sendblueApiHostForPresence()}/api/mark-read`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': config.apiKeyId,
        'sb-api-secret-key': config.apiSecretKey,
      },
      body: JSON.stringify({
        number,
        from_number: config.conciergeNumber,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: t.slice(0, 200) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'mark_read_failed' }
  }
}

/**
 * Show typing indicator to the user before a slow reply (iMessage; best-effort).
 * @see https://docs.sendblue.com/api-v2/typing-indicators/
 */
export async function sendTypingIndicatorToPeer(peerNumberE164: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.SENDBLUE_CHAT_PRESENCE_ENABLED === 'false') return { ok: true }
  const config = getConfig()
  if (!config) return { ok: false, error: 'Sendblue not configured' }
  const number = peerNumberE164.startsWith('+') ? peerNumberE164 : `+${peerNumberE164.replace(/\D/g, '')}`
  const url = `${sendblueApiHostForPresence()}/api/send-typing-indicator`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': config.apiKeyId,
        'sb-api-secret-key': config.apiSecretKey,
      },
      body: JSON.stringify({
        number,
        from_number: config.conciergeNumber,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: t.slice(0, 200) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'typing_failed' }
  }
}

/** Read receipt then typing before OpenAI / slow outbound (errors ignored). */
export async function prepareOutboundAiPresence(peerNumberE164: string): Promise<void> {
  if (process.env.SENDBLUE_CHAT_PRESENCE_ENABLED === 'false') return
  const r1 = await markConversationRead(peerNumberE164)
  if (!r1.ok && r1.error) {
    console.warn('[sendblue] mark-read skipped', r1.error)
  }
  const r2 = await sendTypingIndicatorToPeer(peerNumberE164)
  if (!r2.ok && r2.error) {
    console.warn('[sendblue] typing indicator skipped', r2.error)
  }
}

/** Send a message (concierge or match). Used by complete-intake and other callers. Returns message_handle when API provides it. */
export async function sendMessage(
  to: string,
  content: string,
  opts?: { fromNumber: 'concierge' | 'match'; mediaUrl?: string | null }
): Promise<{ success: boolean; error?: string; message_handle?: string }> {
  const result = await sendSendblueMessage(to, content, opts?.fromNumber !== 'match', opts?.mediaUrl)
  return { success: result.ok, error: result.error, message_handle: result.message_handle }
}

// ---------- Contact sharing (Name & Photo) ----------
// @see https://docs.sendblue.com/api-v2/contact-sharing/

const SENDBLUE_CONTACT_SHARING_URL = 'https://api.sendblue.co/api/v2/contact-sharing'

function getAuthHeaders(): { 'sb-api-key-id': string; 'sb-api-secret-key': string } | null {
  const config = getConfig()
  if (!config) return null
  return { 'sb-api-key-id': config.apiKeyId, 'sb-api-secret-key': config.apiSecretKey }
}

export type ContactSharingState = {
  hasProfile: boolean
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
}

/** Get contact-sharing profile state for a Sendblue number (E.164). */
export async function getContactSharingState(
  fromNumber: string
): Promise<{ ok: boolean; error?: string; data?: ContactSharingState }> {
  const headers = getAuthHeaders()
  if (!headers) return { ok: false, error: 'Sendblue not configured' }
  const normalized = fromNumber.startsWith('+') ? fromNumber : `+${fromNumber.replace(/\D/g, '')}`
  try {
    const res = await fetch(
      `${SENDBLUE_CONTACT_SHARING_URL}/state?fromNumber=${encodeURIComponent(normalized)}`,
      { method: 'GET', headers }
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data?.message ?? data?.error_message ?? res.statusText
      return { ok: false, error: msg }
    }
    return { ok: true, data: data?.data ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' }
  }
}

/** Set contact-sharing profile for a Sendblue number. Recipients see this name/photo when they get messages. */
export async function setContactSharingProfile(params: {
  fromNumber: string
  firstName: string
  lastName: string
  photoUrl: string
  displayName?: string
}): Promise<{ ok: boolean; error?: string; data?: ContactSharingState }> {
  const headers = getAuthHeaders()
  if (!headers) return { ok: false, error: 'Sendblue not configured' }
  const normalized = params.fromNumber.startsWith('+') ? params.fromNumber : `+${params.fromNumber.replace(/\D/g, '')}`
  try {
    const res = await fetch(`${SENDBLUE_CONTACT_SHARING_URL}/profile`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromNumber: normalized,
        firstName: params.firstName,
        lastName: params.lastName,
        photoUrl: params.photoUrl,
        ...(params.displayName != null && params.displayName !== '' && { displayName: params.displayName }),
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data?.message ?? data?.error_message ?? res.statusText
      return { ok: false, error: msg }
    }
    return { ok: true, data: data?.data ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' }
  }
}

/** Set the Concierge number's contact card to "Fika ☕". Run once (e.g. after deploy). Requires SENDBLUE_CONCIERGE_CONTACT_PHOTO_URL (public JPEG/PNG). */
export async function setConciergeContactCard(photoUrl: string): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig()
  if (!config) return { ok: false, error: 'Sendblue not configured' }
  const result = await setContactSharingProfile({
    fromNumber: config.conciergeNumber,
    firstName: 'Fika',
    lastName: '☕',
    photoUrl,
    displayName: 'Fika ☕',
  })
  return { ok: result.ok, error: result.error }
}
