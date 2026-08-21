/**
 * POST /api/avatar-upload-sms — upload a profile photo before Google OAuth.
 * Accepts session token (from onboarding_sessions) instead of auth token.
 * Stores to avatars/onboarding/{token}/avatar.{ext} and updates session payload.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'avatars'
const MAX_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const sessionToken = searchParams.get('token')
  const confirmIntent = searchParams.get('confirm_intent') === '1'
  if (!sessionToken) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const supabase = createClient(url, serviceKey)

  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, payload')
    .eq('token', sessionToken)
    .is('merged_into_user_id', null)
    .maybeSingle()

  if (!session) {
    return NextResponse.json({ error: 'Invalid or already used token' }, { status: 404 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Use a JPEG, PNG, or WebP photo.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Photo too large (max 5MB).' }, { status: 400 })
  }

  const ext = extFromMime(file.type)
  const storagePath = `onboarding/${sessionToken}/avatar.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const existing = (session.payload as Record<string, unknown>) ?? {}
  const payloadUpdate: Record<string, unknown> = { ...existing, avatar_path: storagePath }
  if (confirmIntent) payloadUpdate.confirm_intent_at = new Date().toISOString()
  await supabase
    .from('onboarding_sessions')
    .update({
      payload: payloadUpdate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  return NextResponse.json({ ok: true, path: storagePath })
}
