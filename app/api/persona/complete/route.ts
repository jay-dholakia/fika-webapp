import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { fetchPersonaInquiry, isPersonaInquiryVerifiedStatus } from '@/lib/persona-inquiry'

/**
 * After Persona.Client onComplete, client sends inquiryId.
 * We re-fetch the inquiry with the secret API key and set id_verified_at only when
 * referenceId matches the authenticated user and status is a pass state.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }

  let inquiryId: string | null = null
  try {
    const body = await request.json()
    inquiryId = typeof body?.inquiryId === 'string' ? body.inquiryId.trim() : null
  } catch {
    inquiryId = null
  }
  if (!inquiryId) {
    return NextResponse.json({ error: 'inquiryId required' }, { status: 400 })
  }

  const personaKey = process.env.PERSONA_API_KEY?.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!personaKey) {
    return NextResponse.json({ error: 'PERSONA_API_KEY not configured' }, { status: 500 })
  }
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const token = authHeader.slice(7)
  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const fetched = await fetchPersonaInquiry(inquiryId, personaKey)
  if (!fetched.ok) {
    return NextResponse.json(
      { error: 'Could not verify inquiry with Persona', detail: fetched.error },
      { status: fetched.status === 404 ? 404 : 502 }
    )
  }

  const { referenceId, status } = fetched.parse
  if (!referenceId || referenceId !== user.id) {
    return NextResponse.json({ error: 'Inquiry does not match this account' }, { status: 403 })
  }
  if (!isPersonaInquiryVerifiedStatus(status)) {
    return NextResponse.json(
      { error: 'Verification not completed', status: status ?? 'unknown' },
      { status: 422 }
    )
  }

  const supabaseAdmin = createClient(url, serviceKey)
  const verifiedAt = new Date().toISOString()
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({
      id_verified_at: verifiedAt,
      persona_inquiry_id: inquiryId,
      updated_at: verifiedAt,
    })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id_verified_at: verifiedAt })
}
