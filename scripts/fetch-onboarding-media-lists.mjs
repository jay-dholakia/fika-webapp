/**
 * Regenerates lib/data/tv-streaming-shows.json (500) and lib/data/podcasts.json (500).
 * TV: TVMaze paginated /shows. Podcasts: Apple iTunes search (no API key).
 * Run: node scripts/fetch-onboarding-media-lists.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'lib', 'data')

async function fetchTv() {
  const names = []
  for (let page = 0; page < 30 && names.length < 500; page++) {
    const res = await fetch(`https://api.tvmaze.com/shows?page=${page}`)
    if (!res.ok) break
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    for (const s of data) {
      const n = (s.name || '').trim()
      if (n && !names.includes(n)) names.push(n)
      if (names.length >= 500) break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return names.slice(0, 500)
}

async function fetchPodcasts() {
  const seen = new Set()
  const names = []
  const terms = [
    'news',
    'comedy',
    'crime',
    'technology',
    'sports',
    'business',
    'health',
    'science',
    'history',
    'interview',
    'politics',
    'daily',
    'morning',
    'evening',
    'fiction',
    'story',
    'culture',
    'music',
    'film',
    'books',
    'philosophy',
    'religion',
    'economics',
    'startup',
    'design',
    'gaming',
    'food',
    'travel',
    'parenting',
    'finance',
  ]
  for (const term of terms) {
    if (names.length >= 500) break
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=200`
    const res = await fetch(url)
    if (!res.ok) continue
    const data = await res.json()
    for (const r of data.results || []) {
      const n = (r.collectionName || '').trim()
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase())
        names.push(n)
        if (names.length >= 500) break
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return names.slice(0, 500)
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true })
  const tv = await fetchTv()
  if (tv.length < 500) console.warn('TV: got', tv.length, 'expected 500')
  fs.writeFileSync(path.join(dataDir, 'tv-streaming-shows.json'), JSON.stringify(tv))
  console.log('Wrote tv-streaming-shows.json', tv.length)
  const pods = await fetchPodcasts()
  if (pods.length < 500) console.warn('Podcasts: got', pods.length, 'expected 500')
  fs.writeFileSync(path.join(dataDir, 'podcasts.json'), JSON.stringify(pods))
  console.log('Wrote podcasts.json', pods.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
