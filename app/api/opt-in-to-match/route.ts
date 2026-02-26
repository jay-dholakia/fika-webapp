import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const FN_NAME = 'opt-in-match'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }
  if (!SUPABASE_URL) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  let body: { match_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const match_id = body?.match_id
  if (!match_id || typeof match_id !== 'string') {
    return NextResponse.json({ error: 'match_id required' }, { status: 400 })
  }
  const url = `${SUPABASE_URL}/functions/v1/${FN_NAME}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({ match_id }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json(
      { error: data?.error ?? data?.message ?? 'Opt-in failed' },
      { status: res.status }
    )
  }
  return NextResponse.json(data)
}
