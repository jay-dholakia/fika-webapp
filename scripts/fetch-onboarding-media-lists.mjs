/**
 * Regenerates lib/data/tv-streaming-shows.json and lib/data/podcasts.json (up to 600 each).
 * Order: iTunes US RSS top 100 first, then TVMaze (TV) / iTunes search (podcasts); case-insensitive dedupe.
 * Run: node scripts/fetch-onboarding-media-lists.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'lib', 'data')

const MAX_TOTAL = 600
const TOP_RSS = 100

function rssEntries(data) {
  const e = data?.feed?.entry
  if (!e) return []
  return Array.isArray(e) ? e : [e]
}

/** Prefer show title from iTunes TV season RSS (artist = series name). */
function tvShowNameFromRssEntry(entry) {
  const artist = entry?.['im:artist']?.label?.trim()
  const name = entry?.['im:name']?.label?.trim()
  let raw = artist || name || ''
  raw = raw
    .replace(/, The Complete Series$/i, '')
    .replace(/, Season \d+$/i, '')
    .replace(/ \(Remastered\)$/i, '')
    .trim()
  return raw
}

function podcastNameFromRssEntry(entry) {
  return (entry?.['im:name']?.label || '').trim()
}

async function fetchTopTvFromRss() {
  const res = await fetch(`https://itunes.apple.com/us/rss/topTvSeasons/limit=${TOP_RSS}/json`)
  if (!res.ok) {
    console.warn('Top TV RSS failed', res.status)
    return []
  }
  const data = await res.json()
  const out = []
  const seen = new Set()
  for (const entry of rssEntries(data)) {
    const n = tvShowNameFromRssEntry(entry)
    if (!n || n.length < 2) continue
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out.slice(0, TOP_RSS)
}

async function fetchTopPodcastsFromRss() {
  const res = await fetch(`https://itunes.apple.com/us/rss/toppodcasts/limit=${TOP_RSS}/json`)
  if (!res.ok) {
    console.warn('Top podcasts RSS failed', res.status)
    return []
  }
  const data = await res.json()
  const out = []
  const seen = new Set()
  for (const entry of rssEntries(data)) {
    const n = podcastNameFromRssEntry(entry)
    if (!n || n.length < 2) continue
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out.slice(0, TOP_RSS)
}

/** Popular first; dedupe by lower case; cap length. */
function mergePopularFirst(popular, rest, maxTotal) {
  const seen = new Set()
  const out = []
  for (const name of [...popular, ...rest]) {
    const t = (name || '').trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= maxTotal) break
  }
  return out
}

async function fetchTvMazeBulk() {
  const names = []
  for (let page = 0; page < 35 && names.length < 550; page++) {
    const res = await fetch(`https://api.tvmaze.com/shows?page=${page}`)
    if (!res.ok) break
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    for (const s of data) {
      const n = (s.name || '').trim()
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n)
      if (names.length >= 550) break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return names
}

async function fetchPodcastsSearch() {
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
    if (names.length >= 550) break
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=200`
    const res = await fetch(url)
    if (!res.ok) continue
    const data = await res.json()
    for (const r of data.results || []) {
      const n = (r.collectionName || '').trim()
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase())
        names.push(n)
        if (names.length >= 550) break
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return names
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true })

  const [topTv, mazeTv] = await Promise.all([fetchTopTvFromRss(), fetchTvMazeBulk()])
  const tv = mergePopularFirst(topTv, mazeTv, MAX_TOTAL)
  console.log('TV: top RSS', topTv.length, '+ TVMaze tail →', tv.length, 'unique')
  fs.writeFileSync(path.join(dataDir, 'tv-streaming-shows.json'), JSON.stringify(tv))

  const [topPods, searchPods] = await Promise.all([fetchTopPodcastsFromRss(), fetchPodcastsSearch()])
  const pods = mergePopularFirst(topPods, searchPods, MAX_TOTAL)
  console.log('Podcasts: top RSS', topPods.length, '+ search tail →', pods.length, 'unique')
  fs.writeFileSync(path.join(dataDir, 'podcasts.json'), JSON.stringify(pods))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
