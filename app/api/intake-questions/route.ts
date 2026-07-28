import { NextResponse } from 'next/server'
import { INTAKE_STEPS } from '@/lib/onboarding-data'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ questions: INTAKE_STEPS, source: 'code' })
}
