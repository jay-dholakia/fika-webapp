/**
 * Persona REST: verify inquiry server-side before trusting client onComplete.
 * @see https://docs.withpersona.com/api-reference/inquiries/retrieve-an-inquiry
 */

const PERSONA_API_BASE = 'https://api.withpersona.com/api/v1'

export type PersonaInquiryParse = {
  status: string | null
  referenceId: string | null
}

export function parsePersonaInquiryPayload(data: unknown): PersonaInquiryParse {
  const root = data as {
    data?: { attributes?: Record<string, unknown> }
  }
  const attrs = root?.data?.attributes
  if (!attrs || typeof attrs !== 'object') return { status: null, referenceId: null }
  const status = typeof attrs.status === 'string' ? attrs.status : null
  const refRaw =
    attrs['reference-id'] ?? attrs.referenceId ?? attrs.reference_id
  const referenceId = typeof refRaw === 'string' ? refRaw : null
  return { status, referenceId }
}

/** Inquiry statuses that mean the user passed required verifications (gov ID path). */
const VERIFIED_INQUIRY_STATUSES = new Set([
  'completed',
  'approved',
  'passed',
])

export function isPersonaInquiryVerifiedStatus(status: string | null): boolean {
  if (!status) return false
  return VERIFIED_INQUIRY_STATUSES.has(status.toLowerCase())
}

export async function fetchPersonaInquiry(
  inquiryId: string,
  apiKey: string
): Promise<{ ok: true; parse: PersonaInquiryParse; raw: unknown } | { ok: false; error: string; status?: number }> {
  const url = `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(inquiryId)}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: 'application/json',
    },
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof raw === 'object' && raw !== null && 'errors' in raw
        ? JSON.stringify((raw as { errors?: unknown }).errors)
        : res.statusText
    return { ok: false, error: msg || 'Persona API error', status: res.status }
  }
  return { ok: true, parse: parsePersonaInquiryPayload(raw), raw }
}
