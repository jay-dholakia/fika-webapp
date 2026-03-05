/**
 * POST /api/availability — save weekly availability for the authenticated user and send confirmation SMS.
 * Body: { batch_week?: string (YYYY-MM-DD Monday), availability_slots: string[] }
 * If batch_week omitted, uses current batch week. After saving, sends Concierge SMS:
 * "Your availability is set. We'll shoot you a text later this week with your match."
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentBatchWeek } from '@/lib/onboarding'
import { sendConcierge } from '@/lib/sendblue'

const MESSAGE_AVAILABILITY_SET =
  "Your availability is set. We'll shoot you a text later this week with your match."

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

  let body: { batch_week?: string; availability_slots?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const batch_week = typeof body?.batch_week === 'string' && body.batch_week
    ? body.batch_week
    : getCurrentBatchWeek()
  const availability_slots = Array.isArray(body?.availability_slots) ? body.availability_slots : []

  const { error: upsertError } = await supabase.from('weekly_availability').upsert(
    {
      user_id: user.id,
      batch_week,
      availability_slots: availability_slots.length > 0 ? availability_slots : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,batch_week' }
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
  if (phone) {
    await sendConcierge(phone, MESSAGE_AVAILABILITY_SET)
  }

  return NextResponse.json({ ok: true, batch_week })
}
