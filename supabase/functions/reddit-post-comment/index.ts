// Part B (write side): Post an approved comment to Reddit.
// Invoked only by the admin Approve & Post action — no cron.
// Input: { matchId: string }

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken } from '../_shared/reddit-auth.ts'

serve(async (req: Request) => {
  try {
    const { matchId } = await req.json() as { matchId?: string }
    if (!matchId) {
      return new Response(JSON.stringify({ error: 'matchId required' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Load match — must be approved
    const { data: match, error: fetchErr } = await supabase
      .from('reddit_matches')
      .select('id, reddit_post_id, draft_text, edited_text, status')
      .eq('id', matchId)
      .maybeSingle()

    if (fetchErr || !match) {
      return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404 })
    }
    if ((match as { status: string }).status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Match is not approved' }), { status: 409 })
    }

    const text = ((match as { edited_text?: string | null }).edited_text?.trim()
      || (match as { draft_text?: string | null }).draft_text?.trim())
    if (!text) {
      return new Response(JSON.stringify({ error: 'No reply text to post' }), { status: 422 })
    }

    const postId = (match as { reddit_post_id: string }).reddit_post_id

    // Mint user access token from Vault refresh token
    let accessToken: string
    try {
      accessToken = await getUserAccessToken()
    } catch (e) {
      await supabase.from('reddit_matches').update({
        post_error: `Token error: ${String(e)}`,
        updated_at: new Date().toISOString(),
      }).eq('id', matchId)
      return new Response(JSON.stringify({ error: `Token error: ${String(e)}` }), { status: 502 })
    }

    // POST comment to Reddit
    const ua = Deno.env.get('REDDIT_USER_AGENT') ?? 'web:com.fika.growth-agent:v1.0'
    const commentRes = await fetch('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': ua,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `api_type=json&thing_id=${encodeURIComponent(postId)}&text=${encodeURIComponent(text)}`,
    })

    const commentData = await commentRes.json() as {
      json?: { data?: { things?: Array<{ data?: { name?: string } }> }; errors?: unknown[] }
    }
    const errors = commentData.json?.errors ?? []
    const commentId = commentData.json?.data?.things?.[0]?.data?.name

    if (!commentRes.ok || errors.length > 0 || !commentId) {
      const errMsg = JSON.stringify(errors.length > 0 ? errors : commentData)
      await supabase.from('reddit_matches').update({
        post_error: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', matchId)
      return new Response(JSON.stringify({ error: 'Reddit comment failed', detail: errMsg }), { status: 502 })
    }

    // Success
    await supabase.from('reddit_matches').update({
      status: 'posted',
      posted_comment_id: commentId,
      post_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', matchId)

    return new Response(JSON.stringify({ ok: true, commentId }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
