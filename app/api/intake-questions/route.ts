import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { INTAKE_STEPS } from '@/lib/onboarding-data'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!url || !key) return NextResponse.json({ questions: INTAKE_STEPS })

    const supabase = createClient(url, key)
    const { data, error } = await supabase
      .from('intake_question_config')
      .select('*')
      .eq('enabled', true)
      .order('display_order', { ascending: true })

    if (error || !data?.length) {
      return NextResponse.json({ questions: INTAKE_STEPS, source: 'fallback' })
    }

    return NextResponse.json({ questions: data, source: 'db' })
  } catch {
    return NextResponse.json({ questions: INTAKE_STEPS, source: 'fallback' })
  }
}
