/**
 * Backfill intake_responses_v5.embed_vector for all rows using buildIntakeEmbeddingText + OpenAI.
 *
 * Run from repo root:
 *   npx tsx scripts/backfill-intake-embeddings.ts
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * and OPENAI_API_KEY or EXPO_PUBLIC_OPENAI_API_KEY.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { computeAndStoreIntakeEmbedding } from '../lib/intake-embed-server'

function loadEnvLocal(): Record<string, string> {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) {
    console.error('Missing .env.local')
    process.exit(1)
  }
  const env: Record<string, string> = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return env
}

async function fetchAllUserIds(supabase: any): Promise<string[]> {
  const out: string[] = []
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('intake_responses_v5')
      .select('user_id')
      .order('user_id')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const chunk = (data ?? []) as Array<{ user_id?: string | null }>
    if (chunk.length === 0) break
    for (const r of chunk) {
      if (r?.user_id) out.push(r.user_id)
    }
    if (chunk.length < pageSize) break
    from += pageSize
  }
  return out
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const openaiKey = env.EXPO_PUBLIC_OPENAI_API_KEY || env.OPENAI_API_KEY
  if (!url || !serviceKey) {
    console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  if (!openaiKey) {
    console.error('Need OPENAI_API_KEY or EXPO_PUBLIC_OPENAI_API_KEY in .env.local')
    process.exit(1)
  }

  const supabase: any = createClient(url, serviceKey)
  const userIds = await fetchAllUserIds(supabase)
  console.log(`Found ${userIds.length} row(s) in intake_responses_v5`)
  if (dryRun) {
    console.log('Dry run — exiting.')
    process.exit(0)
  }

  let ok = 0
  let embedded = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < userIds.length; i++) {
    const id = userIds[i]
    const result = await computeAndStoreIntakeEmbedding(supabase as any, id, openaiKey)
    if (result.ok) {
      ok++
      if (result.embedded) embedded++
      else skipped++
    } else {
      failed++
      console.error(`[${i + 1}/${userIds.length}] ${id}: ${result.error}`)
    }
    if (i < userIds.length - 1) {
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  console.log(
    `Done. ok=${ok} (embedded=${embedded}, no-text-updated=${skipped}), failed=${failed}`
  )
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
