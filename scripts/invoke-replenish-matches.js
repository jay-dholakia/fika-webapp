/**
 * Invoke the replenish-matches Supabase Edge Function (meetwithmoai backend).
 * Run from repo root with: node scripts/invoke-replenish-matches.js
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * (The function may require service role in production; anon key is tried first.)
 */

const fs = require('fs')
const path = require('path')

function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) {
    console.error('.env.local not found. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
    process.exit(1)
  }
  const content = fs.readFileSync(p, 'utf8')
  const env = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return env
}

async function main() {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
    process.exit(1)
  }
  const fnUrl = `${url.replace(/\/$/, '')}/functions/v1/replenish-matches`
  console.log('Invoking replenish-matches...')
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) {
    console.error('Error:', res.status, data)
    process.exit(1)
  }
  console.log('OK:', data)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
