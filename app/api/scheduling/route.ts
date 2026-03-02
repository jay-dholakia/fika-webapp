import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

type SchedulingAction =
  | 'confirm_default'
  | 'confirm_final'
  | 'change_time'
  | 'accept_counter'
  | 'choose_another_time'
  | 'cant_make_it'

type MatchRow = {
  id: string
  user_a: string
  user_b: string
  scheduling_status: string | null
  default_slot_id: string | null
  overlapping_slot_ids: string[] | null
  counter_slot_id: string | null
  counter_proposed_by_user_id: string | null
  final_slot_id: string | null
  expires_at: string | null
}

function getSupabaseWithAuth(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const supabase = getSupabaseWithAuth(authHeader)
  if (!supabase) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }

  const token = authHeader!.slice(7)
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }

  let body: { action?: SchedulingAction; match_id?: string; slot_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, match_id, slot_id } = body
  if (!action || !match_id || typeof match_id !== 'string') {
    return NextResponse.json({ error: 'action and match_id required' }, { status: 400 })
  }

  const { data: match, error: matchError } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, scheduling_status, default_slot_id, overlapping_slot_ids, counter_slot_id, counter_proposed_by_user_id, final_slot_id, expires_at')
    .eq('id', match_id)
    .single()

  if (matchError || !match) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  const row = match as MatchRow
  const isUserA = row.user_a === user.id
  const isUserB = row.user_b === user.id
  if (!isUserA && !isUserB) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    await supabase
      .from('match_candidates')
      .update({ scheduling_status: 'expired' })
      .eq('id', match_id)
    return NextResponse.json({ error: 'Match expired' }, { status: 410 })
  }

  const slots: string[] = Array.isArray(row.overlapping_slot_ids) ? row.overlapping_slot_ids : []

  switch (action) {
    case 'confirm_default': {
      if (row.scheduling_status !== 'proposed_default' && row.scheduling_status !== null) {
        return NextResponse.json({ error: 'Invalid state for confirm_default' }, { status: 400 })
      }
      const defaultId = row.default_slot_id ?? slots[0]
      if (!defaultId) {
        return NextResponse.json({ error: 'No default slot' }, { status: 400 })
      }
      const { data: existingOpt } = await supabase
        .from('opt_ins')
        .select('id')
        .eq('match_id', row.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (existingOpt?.id) {
        await supabase
          .from('opt_ins')
          .update({ decision: 'yes', confirmed_slot_id: defaultId })
          .eq('id', existingOpt.id)
      } else {
        await supabase
          .from('opt_ins')
          .insert({ match_id: row.id, user_id: user.id, decision: 'yes', confirmed_slot_id: defaultId })
      }
      const { data: optIns } = await supabase
        .from('opt_ins')
        .select('user_id, confirmed_slot_id')
        .eq('match_id', row.id)
        .eq('decision', 'yes')
      const bothConfirmedDefault =
        optIns?.length === 2 &&
        optIns?.every((o) => o.confirmed_slot_id === defaultId)
      if (bothConfirmedDefault) {
        await supabase
          .from('match_candidates')
          .update({ scheduling_status: 'confirmed', confirmed_slot_id: defaultId })
          .eq('id', row.id)
      }
      return NextResponse.json({
        ok: true,
        scheduling_status: bothConfirmedDefault ? 'confirmed' : row.scheduling_status,
      })
    }

    case 'change_time': {
      if (row.scheduling_status !== 'proposed_default' && row.scheduling_status !== null) {
        return NextResponse.json({ error: 'Invalid state for change_time' }, { status: 400 })
      }
      if (!slot_id || typeof slot_id !== 'string') {
        return NextResponse.json({ error: 'slot_id required for change_time' }, { status: 400 })
      }
      const defaultId = row.default_slot_id ?? slots[0]
      if (slot_id === defaultId || !slots.includes(slot_id)) {
        return NextResponse.json({ error: 'Invalid slot; must be an alternate' }, { status: 400 })
      }
      const { error: updateErr } = await supabase
        .from('match_candidates')
        .update({
          scheduling_status: 'counter_proposed',
          counter_slot_id: slot_id,
          counter_proposed_by_user_id: user.id,
        })
        .eq('id', row.id)
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, scheduling_status: 'counter_proposed' })
    }

    case 'accept_counter': {
      if (row.scheduling_status !== 'counter_proposed') {
        return NextResponse.json({ error: 'Invalid state for accept_counter' }, { status: 400 })
      }
      const counterId = row.counter_slot_id
      if (!counterId) return NextResponse.json({ error: 'No counter slot' }, { status: 400 })
      const { error: updateErr } = await supabase
        .from('match_candidates')
        .update({ scheduling_status: 'confirmed', confirmed_slot_id: counterId })
        .eq('id', row.id)
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({
        ok: true,
        scheduling_status: 'confirmed',
      })
    }

    case 'choose_another_time': {
      if (row.scheduling_status !== 'counter_proposed') {
        return NextResponse.json({ error: 'Invalid state for choose_another_time' }, { status: 400 })
      }
      if (!slot_id || typeof slot_id !== 'string') {
        return NextResponse.json({ error: 'slot_id required for choose_another_time' }, { status: 400 })
      }
      const defaultId = row.default_slot_id ?? slots[0]
      const counterId = row.counter_slot_id
      const excluded = [defaultId, counterId].filter(Boolean)
      if (excluded.includes(slot_id) || !slots.includes(slot_id)) {
        return NextResponse.json({ error: 'Invalid slot; must be a remaining option' }, { status: 400 })
      }
      const { error: updateErr } = await supabase
        .from('match_candidates')
        .update({ scheduling_status: 'final_proposed', final_slot_id: slot_id })
        .eq('id', row.id)
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, scheduling_status: 'final_proposed' })
    }

    case 'confirm_final': {
      if (row.scheduling_status !== 'final_proposed') {
        return NextResponse.json({ error: 'Invalid state for confirm_final' }, { status: 400 })
      }
      const finalId = row.final_slot_id
      if (!finalId) return NextResponse.json({ error: 'No final slot' }, { status: 400 })
      const { error: updateErr } = await supabase
        .from('match_candidates')
        .update({ scheduling_status: 'confirmed', confirmed_slot_id: finalId })
        .eq('id', row.id)
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({
        ok: true,
        scheduling_status: 'confirmed',
      })
    }

    case 'cant_make_it': {
      const allowed =
        row.scheduling_status === 'final_proposed' ||
        row.scheduling_status === 'proposed_default' ||
        row.scheduling_status === 'counter_proposed'
      if (!allowed) {
        return NextResponse.json({ error: 'Invalid state for cant_make_it' }, { status: 400 })
      }
      const { error: updateErr } = await supabase
        .from('match_candidates')
        .update({ scheduling_status: 'expired' })
        .eq('id', row.id)
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, scheduling_status: 'expired' })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
