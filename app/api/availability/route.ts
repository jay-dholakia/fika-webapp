/**
 * POST /api/availability — optional match_availability rows (legacy / tooling).
 * Body: { match_id: string (uuid), availability_slots: string[] }
 * Scheduling in SMS is proposal-first (YES/NO); READY handling in webhook is legacy.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendConcierge } from '@/lib/sendblue'

const SMS_AFTER_SAVE = 'Saved.'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }

  let body: { match_id?: string; availability_slots?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const match_id = typeof body?.match_id === 'string' ? body.match_id.trim() : ''
  if (!match_id) {
    return NextResponse.json({ error: 'Missing match_id' }, { status: 400 })
  }
  const availability_slots = Array.isArray(body?.availability_slots) ? body.availability_slots : []
  const hasSlots = availability_slots.length > 0
  const now = new Date().toISOString()

  // Ensure the match exists and the user is a participant.
  const { data: matchRow, error: matchErr } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, status')
    .eq('id', match_id)
    .maybeSingle()
  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 })
  }
  const isParticipant =
    matchRow?.id &&
    (matchRow.user_a === user.id || matchRow.user_b === user.id) &&
    (matchRow.status == null || matchRow.status === 'active')
  if (!isParticipant) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  const { error: upsertError } = await supabase.from('match_availability').upsert(
    {
      user_id: user.id,
      match_id,
      availability_slots: hasSlots ? availability_slots : null,
      updated_at: now,
      pending_sms_ready_confirmation: hasSlots,
      sms_ready_confirmed_at: null,
    },
    { onConflict: 'user_id,match_id' }
  )
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', user.id)
    .maybeSingle()

  const phone = (profile?.phone as string)?.trim()
  if (phone && hasSlots) {
    await sendConcierge(phone, SMS_AFTER_SAVE)
  }

  return NextResponse.json({
    ok: true,
    match_id,
    sms_ready: hasSlots
      ? { pending: true, keyword: null, message: null }
      : { pending: false, keyword: null, message: null },
  })
}
