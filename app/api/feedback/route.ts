import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }

  let body: { notes?: string; contact_ok?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  if (!notes) {
    return NextResponse.json({ error: 'Feedback notes are required' }, { status: 400 })
  }

  const contact_ok = Boolean(body.contact_ok)

  const { error: insertError } = await supabase.from('feedback').insert({
    user_id: user.id,
    notes,
    contact_ok,
  })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
