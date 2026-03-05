/**
 * POST /api/onboarding-avatar — upload avatar for token (SMS) onboarding flow.
 * Body: multipart/form-data with "token" and "file". Uploads to avatars/pending/{token}.{ext},
 * updates onboarding_sessions.payload.avatar_url and payload.avatar_path.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'avatars'
const PENDING_PREFIX = 'pending'
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const formData = await request.formData().catch(() => null)
  const token = typeof formData?.get('token') === 'string' ? formData.get('token') as string : null
  const file = formData?.get('file')
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  }

  const supabase = createClient(url, serviceKey)
  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('id, payload')
    .eq('token', token.trim())
    .is('merged_into_user_id', null)
    .maybeSingle()

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Invalid or already used link' }, { status: 404 })

  const ext = extFromMime(file.type)
  const path = `${PENDING_PREFIX}/${token}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const avatarUrl = urlData.publicUrl

  const payload = (session.payload as Record<string, unknown>) ?? {}
  const updated = {
    ...payload,
    avatar_url: avatarUrl,
    avatar_path: path,
  }

  const { error: updateError } = await supabase
    .from('onboarding_sessions')
    .update({ payload: updated, updated_at: new Date().toISOString() })
    .eq('id', session.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ url: avatarUrl, avatar_path: path })
}
