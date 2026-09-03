// Part A: Weekly subreddit discovery + scoring.
// Searches Reddit for LA-local and interest-topic subreddits, scores them,
// and upserts into reddit_subreddits (leaves Jay's status/notes untouched on conflict).

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAppOnlyToken, redditHeaders } from '../_shared/reddit-auth.ts'

const SEED_QUERIES = [
  'Los Angeles',
  'new to LA',
  'make friends Los Angeles',
  'lonely LA',
  'coffee meetup LA',
  'move to Los Angeles',
  'social anxiety',
  'making friends adult',
  'friendship adults',
  'platonic friends',
]

const SEED_SUBS = [
  'LosAngeles',
  'AskLosAngeles',
  'LAr4r',
  'LAtrees',
  'silverlake',
  'Westside_LA',
  'loneliness',
  'MakeNewFriendsHere',
  'friendship',
  'SocialAnxiety',
  'Adulting',
  'AskMen',
  'AskWomen',
  'CasualConversation',
]

const INTENT_KEYWORDS = [
  'new to la', 'just moved', 'make friends', 'meet people', 'lonely', 'no friends',
  'looking for friends', 'social anxiety', 'coffee', 'meetup', 'connection', 'platonic',
]

function scoreSubreddit(params: {
  subscribers: number
  activeUsers: number
  postsPerDay: number
  keywordHits: number
  category: 'la_local' | 'interest_topic'
}): number {
  const { subscribers, activeUsers, postsPerDay, keywordHits, category } = params
  let score = 0
  // Activity signals
  if (subscribers > 10000) score += 10
  if (subscribers > 50000) score += 10
  if (subscribers > 200000) score += 5
  if (activeUsers > 50) score += 5
  if (activeUsers > 200) score += 5
  if (postsPerDay > 2) score += 10
  if (postsPerDay > 10) score += 5
  // Relevance signal
  score += Math.min(keywordHits * 5, 30)
  // Category bonus
  if (category === 'la_local') score += 15
  return score
}

async function fetchSubredditAbout(name: string, token: string): Promise<{
  subscribers: number
  activeUsers: number
  title: string
} | null> {
  try {
    const res = await fetch(`https://oauth.reddit.com/r/${name}/about.json`, {
      headers: redditHeaders(token),
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: { subscribers?: number; active_user_count?: number; title?: string } }
    return {
      subscribers: data.data?.subscribers ?? 0,
      activeUsers: data.data?.active_user_count ?? 0,
      title: data.data?.title ?? name,
    }
  } catch {
    return null
  }
}

async function samplePostsPerDay(name: string, token: string): Promise<{ postsPerDay: number; keywordHits: number }> {
  try {
    const res = await fetch(`https://oauth.reddit.com/r/${name}/new.json?limit=50`, {
      headers: redditHeaders(token),
    })
    if (!res.ok) return { postsPerDay: 0, keywordHits: 0 }
    const data = await res.json() as {
      data?: { children?: Array<{ data?: { created_utc?: number; title?: string; selftext?: string } }> }
    }
    const posts = data.data?.children ?? []
    if (posts.length === 0) return { postsPerDay: 0, keywordHits: 0 }

    const now = Date.now() / 1000
    const oldest = posts[posts.length - 1]?.data?.created_utc ?? now
    const spanDays = Math.max((now - oldest) / 86400, 0.1)
    const postsPerDay = posts.length / spanDays

    let keywordHits = 0
    for (const post of posts) {
      const text = `${post.data?.title ?? ''} ${post.data?.selftext ?? ''}`.toLowerCase()
      for (const kw of INTENT_KEYWORDS) {
        if (text.includes(kw)) { keywordHits++; break }
      }
    }

    return { postsPerDay, keywordHits }
  } catch {
    return { postsPerDay: 0, keywordHits: 0 }
  }
}

async function searchSubreddits(query: string, token: string): Promise<string[]> {
  try {
    const url = `https://oauth.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=10`
    const res = await fetch(url, { headers: redditHeaders(token) })
    if (!res.ok) return []
    const data = await res.json() as {
      data?: { children?: Array<{ data?: { display_name?: string } }> }
    }
    return (data.data?.children ?? [])
      .map(c => c.data?.display_name ?? '')
      .filter(Boolean)
  } catch {
    return []
  }
}

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const token = await getAppOnlyToken()

    // Gather candidates: seed subs + search results
    const discovered = new Set<string>(SEED_SUBS)
    for (const query of SEED_QUERIES) {
      const names = await searchSubreddits(query, token)
      for (const n of names) discovered.add(n)
      await new Promise(r => setTimeout(r, 500)) // stay under rate limit
    }

    let upserted = 0
    for (const name of discovered) {
      const about = await fetchSubredditAbout(name, token)
      if (!about) continue
      await new Promise(r => setTimeout(r, 300))

      const { postsPerDay, keywordHits } = await samplePostsPerDay(name, token)
      await new Promise(r => setTimeout(r, 300))

      const isLaLocal = /\b(la|los.?angeles|angeles|westside|silverlake|venice|culver|dtla|hollywood|koreatown|pasadena|burbank|glendale|santa.?monica)\b/i.test(name)
      const category: 'la_local' | 'interest_topic' = isLaLocal ? 'la_local' : 'interest_topic'

      const relevance_score = scoreSubreddit({
        subscribers: about.subscribers,
        activeUsers: about.activeUsers,
        postsPerDay,
        keywordHits,
        category,
      })

      await supabase
        .from('reddit_subreddits')
        .upsert({
          name,
          subscriber_count: about.subscribers,
          active_user_count: about.activeUsers,
          posts_per_day: postsPerDay,
          keyword_hits: keywordHits,
          category,
          relevance_score,
          last_scored_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'name',
          ignoreDuplicates: false,
        })

      upserted++
    }

    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
