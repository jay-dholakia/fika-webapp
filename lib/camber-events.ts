import { createClient } from '@supabase/supabase-js'

export type CamberDiscovery = {
  title: string
  url: string
}

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Supabase service role is not configured')
  return createClient(url, key)
}

export async function expirePastEvents() {
  const supabase = getServiceSupabase()
  const nowIso = new Date().toISOString()

  const { data: staleRows, error: staleError } = await supabase
    .from('events')
    .select('id')
    .in('status', ['draft', 'approved'])
    .lt('starts_at', nowIso)

  if (staleError) throw staleError
  if (!staleRows?.length) return 0

  const { error: updateError } = await supabase
    .from('events')
    .update({ status: 'expired', expired_at: nowIso })
    .in('id', staleRows.map((row) => row.id))

  if (updateError) throw updateError
  return staleRows.length
}

export async function discoverCamberPosts(): Promise<CamberDiscovery[]> {
  const url = 'https://camberplaces.substack.com/'
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; FikaBot/1.0; +https://letsfika.co)',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Camber fetch failed (${response.status})`)
  }

  const html = await response.text()
  const matches = Array.from(
    html.matchAll(/<a[^>]+href="(https:\/\/camberplaces\.substack\.com\/p\/[^"]+)"[^>]*>(.*?)<\/a>/gi)
  )

  const seen = new Set<string>()
  const posts: CamberDiscovery[] = []
  for (const match of matches) {
    const href = match[1]?.trim()
    const rawTitle = match[2]?.replace(/<[^>]+>/g, ' ')?.replace(/\s+/g, ' ')?.trim()
    if (!href || !rawTitle || seen.has(href)) continue
    seen.add(href)
    posts.push({ title: rawTitle, url: href })
    if (posts.length >= 12) break
  }

  return posts
}

export async function runCamberIngestion() {
  const [expiredCount, discoveredPosts] = await Promise.all([
    expirePastEvents(),
    discoverCamberPosts().catch(() => [] as CamberDiscovery[]),
  ])

  return {
    expiredCount,
    discoveredPosts,
    insertedDrafts: 0,
    note: 'Camber source discovery is live; event extraction into draft rows is the next pass.',
  }
}
