import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const TARGET_COUNT = 200

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const supabase = createClient(url, serviceRoleKey)
  const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ count: count ?? 0, target: TARGET_COUNT })
}
