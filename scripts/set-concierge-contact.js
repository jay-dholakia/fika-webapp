/**
 * One-time: set the Sendblue Concierge number's contact card to "Fika ☕" with the logo.
 * Run from repo root: node scripts/set-concierge-contact.js
 * Requires .env.local: CRON_SECRET, APP_CANONICAL_URL (optional, defaults to https://letsfika.vercel.app),
 * and Sendblue env vars (SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY, SENDBLUE_CONCIERGE_NUMBER).
 * Uses the deployed app URL so the logo at /logo-contact.png is reachable by Sendblue.
 */

const fs = require('fs')
const path = require('path')

function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) {
    console.error('.env.local not found.')
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
  const secret = env.CRON_SECRET
  const base = (env.APP_CANONICAL_URL || 'https://letsfika.vercel.app').replace(/\/$/, '')
  if (!secret) {
    console.error('Missing CRON_SECRET in .env.local')
    process.exit(1)
  }
  const url = `${base}/api/setup/concierge-contact`
  console.log('Calling', url, '...')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await res.text()
  let json
  try {
    json = JSON.parse(body)
  } catch {
    console.error('Response:', body.slice(0, 200))
    process.exit(1)
  }
  if (!res.ok) {
    console.error('Error:', res.status, json.error || body)
    process.exit(1)
  }
  console.log('OK:', json.message || json)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
