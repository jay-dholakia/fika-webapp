/**
 * GET /api/sendblue-status — returns whether Sendblue is configured (for debugging).
 * Does not expose any secrets.
 */

import { NextResponse } from 'next/server'
import { isSendblueConfigured } from '@/lib/sendblue'

export async function GET() {
  return NextResponse.json({
    sendblueConfigured: isSendblueConfigured(),
  })
}
