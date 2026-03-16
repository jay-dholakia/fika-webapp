import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMessage } from '@/lib/sendblue'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, messageEntryFirstTimeMessages, messageEntryFirstTimeMessagesInactiveMarket, SMS_STATES } from '@/lib/sms-agent'
import { getTimezoneFromLatLng, getNextMondayPhrase } from '@/lib/sms-day-aware'
import { getCurrentBatchWeek, isPastOptInDeadline } from '@/lib/onboarding'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'

// Open-ended text used for matching embed: work, movie/show, book, role model, role model why.
const OPEN_ENDED_IDS: string[] = [
  'q_work',
  'q_movie_show_recommendation',
  'q_book_recommendation',
  'q_role_model',
  'q_role_model_why',
]

const OPEN_ENDED_LABELS: Record<string, string> = {
  q_work: 'Work',
  q_movie_show_recommendation: 'Movie or show',
  q_book_recommendation: 'Book',
  q_role_model: 'Role model',
  q_role_model_why: 'Why they resonate',
}

interface IntakeResponseItem {
  question_id: string
  answer: string | number | string[]
}

function buildOpenEndedText(responses: IntakeResponseItem[]): string {
  const parts: string[] = []
  for (const id of OPEN_ENDED_IDS) {
    const r = responses.find((x) => x.question_id === id)
    const val = r?.answer
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    if (!trimmed || trimmed === 'N/A') continue
    const label = OPEN_ENDED_LABELS[id] ?? id
    parts.push(`${label}: ${trimmed}`)
  }
  return parts.join('\n\n') || 'No open-ended answers.'
}

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embeddings failed: ${res.status} ${err}`)
  }
  const data = await res.json()
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding)) throw new Error('OpenAI did not return an embedding array')
  return embedding
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY

  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }
  if (!openaiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }

  const { data: row, error: fetchError } = await supabase
    .from('intake_responses_v5')
    .select('responses')
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!row?.responses || !Array.isArray(row.responses)) {
    return NextResponse.json({ error: 'No intake responses found' }, { status: 400 })
  }

  const responses = row.responses as IntakeResponseItem[]
  const text = buildOpenEndedText(responses)

  const completedAt = new Date().toISOString()

  if (text && text !== 'No open-ended answers.') {
    let embedding: number[]
    try {
      embedding = await getEmbedding(text, openaiKey.trim())
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Embedding failed' },
        { status: 500 }
      )
    }
    const { error: updateError } = await supabase
      .from('intake_responses_v5')
      .update({
        embed_vector: JSON.stringify(embedding),
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('user_id', user.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  } else {
    const { error: updateError } = await supabase
      .from('intake_responses_v5')
      .update({
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('user_id', user.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  // After first-time intake completion: send entry SMS sequence (3 messages) so they know they're in and can reply YES or SKIP
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey && process.env.SENDBLUE_API_KEY_ID) {
    try {
      const serviceSupabase = createClient(url, serviceKey)
      const { data: profile } = await serviceSupabase
        .from('profiles')
        .select('phone, lat, lng, market')
        .eq('id', user.id)
        .single()
      if (profile?.phone) {
        const batchWeek = getCurrentBatchWeek()
        await getOrCreateSmsState(serviceSupabase, user.id, SMS_STATES.AWAITING_OPT_IN, {
          batch_week: batchWeek,
        })
        const appBase = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
        const activeSlugs = await getActiveMarketSlugs(serviceSupabase)
        const marketSlug = (profile as { market?: string | null }).market ?? null
        const isActiveMarket = marketSlug != null && activeSlugs.includes(marketSlug)
        const messages = isActiveMarket
          ? (() => {
              const isAfterDeadline = isPastOptInDeadline(batchWeek)
              const timezone = getTimezoneFromLatLng(profile.lat ?? null, profile.lng ?? null)
              const nextMondayPhrase = getNextMondayPhrase(timezone)
              return messageEntryFirstTimeMessages(isAfterDeadline, nextMondayPhrase, appBase)
            })()
          : messageEntryFirstTimeMessagesInactiveMarket(
              appBase,
              getMarketBySlug(marketSlug)?.label ?? marketSlug
            )
        let lastHandle: string | undefined
        for (let i = 0; i < messages.length; i++) {
          const sent = await sendMessage(profile.phone, messages[i], { fromNumber: 'concierge' })
          if (sent.message_handle) lastHandle = sent.message_handle
          await insertMessageLedger(serviceSupabase, {
            user_id: user.id,
            direction: 'outbound',
            peer_phone: profile.phone,
            content_snippet: messages[i],
            context: 'first_time_entry',
            message_handle: sent.message_handle ?? null,
            batch_week: batchWeek,
          })
          if (i < messages.length - 1) {
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
        if (lastHandle) {
          await serviceSupabase.from('sms_conversation_states').update({
            last_sendblue_message_handle: lastHandle,
            updated_at: new Date().toISOString(),
          }).eq('user_id', user.id).eq('batch_week', batchWeek).is('match_id', null)
        }
      }
    } catch {
      // Non-fatal: don't fail complete-intake if SMS fails
    }
  }

  return NextResponse.json({ ok: true, completed_at: completedAt })
}
