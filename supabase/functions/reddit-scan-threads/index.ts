// Part B (read side): Scan watchlist/active subreddits for intent-matching threads,
// draft a reply via GPT-4o-mini, insert into reddit_matches as pending_review.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAppOnlyToken, redditHeaders } from '../_shared/reddit-auth.ts'

const INTENT_KEYWORDS = [
  'new to la', 'just moved to la', 'moved to los angeles', 'make friends', 'meet people',
  'looking for friends', 'no friends', 'lonely in la', 'lonely in los angeles',
  'coffee meetup', 'want to meet', 'anyone want to', 'looking to connect',
  'platonic friends', 'hard to make friends', 'adult friends', 'social anxiety',
]

const FIKA_VOICE = `Fika is an LA-based app that sets up curated in-person coffee meetups between two people — a warm, human intro designed to help adults make genuine friends. Replies should:
- Feel like a real person (warm, low-key, honest), not a brand
- Briefly and naturally mention Fika only once if it's a natural fit — never pushy
- Lead with empathy/connection, not a pitch
- Be 2–4 sentences, conversational SMS tone
- Never use hashtags, emojis, or exclamation points
- Disclose that this is from Fika (e.g. "I work on a thing called Fika…" or "full disclosure I'm from Fika…")`

function matchesIntent(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase()
  return INTENT_KEYWORDS.filter(kw => text.includes(kw))
}

async function draftReply(params: {
  subreddit: string
  title: string
  body: string
  keywords: string[]
  openaiKey: string
}): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You draft Reddit comment replies on behalf of Fika.\n\n${FIKA_VOICE}\n\nReturn JSON only: {"draft": string}`,
          },
          {
            role: 'user',
            content: `Subreddit: r/${params.subreddit}\nPost title: ${params.title}\nPost body: ${params.body.slice(0, 800)}\nMatched keywords: ${params.keywords.join(', ')}\n\nDraft a reply.`,
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null
    const parsed = JSON.parse(raw) as { draft?: unknown }
    return typeof parsed.draft === 'string' ? parsed.draft.trim() : null
  } catch {
    return null
  }
}

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const openaiKey = Deno.env.get('EXPO_PUBLIC_OPENAI_API_KEY') || Deno.env.get('OPENAI_API_KEY') || ''
    const token = await getAppOnlyToken()

    // Load subs Jay has promoted to watchlist or active
    const { data: subs } = await supabase
      .from('reddit_subreddits')
      .select('id, name')
      .in('status', ['watchlist', 'active'])

    let inserted = 0
    const cutoffHours = 48
    const cutoffTs = new Date(Date.now() - cutoffHours * 3600 * 1000).toISOString()

    for (const sub of (subs ?? []) as Array<{ id: string; name: string }>) {
      try {
        const res = await fetch(
          `https://oauth.reddit.com/r/${sub.name}/new.json?limit=25`,
          { headers: redditHeaders(token) }
        )
        if (!res.ok) continue

        const data = await res.json() as {
          data?: { children?: Array<{ data?: {
            id?: string; name?: string; title?: string; selftext?: string;
            permalink?: string; author?: string; created_utc?: number; url?: string
          } }> }
        }
        const posts = data.data?.children ?? []

        for (const post of posts) {
          const p = post.data
          if (!p?.name || !p?.title) continue

          // Skip old posts
          const postedAt = p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null
          if (postedAt && postedAt < cutoffTs) continue

          const keywords = matchesIntent(p.title, p.selftext ?? '')
          if (keywords.length === 0) continue

          // Skip already-seen posts
          const { data: existing } = await supabase
            .from('reddit_matches')
            .select('id')
            .eq('reddit_post_id', p.name)
            .maybeSingle()
          if (existing) continue

          const draft = openaiKey
            ? await draftReply({
                subreddit: sub.name,
                title: p.title,
                body: p.selftext ?? '',
                keywords,
                openaiKey,
              })
            : null

          await supabase.from('reddit_matches').insert({
            subreddit_id: sub.id,
            reddit_post_id: p.name,
            title: p.title,
            url: p.url ?? `https://reddit.com${p.permalink ?? ''}`,
            author: p.author,
            body_snippet: (p.selftext ?? '').slice(0, 500),
            matched_keywords: keywords,
            posted_at: postedAt,
            draft_text: draft,
            model: draft ? 'gpt-4o-mini' : null,
          })
          inserted++
        }

        await new Promise(r => setTimeout(r, 400))
      } catch {
        // continue to next sub
      }
    }

    return new Response(JSON.stringify({ ok: true, inserted }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
