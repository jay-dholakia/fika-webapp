import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMessage } from '@/lib/sendblue'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, messageEntryFirstTimeMessages, messageEntryFirstTimeMessagesInactiveMarket, SMS_STATES } from '@/lib/sms-agent'
import { getTimezoneFromLatLng, getNextMondayPhrase } from '@/lib/sms-day-aware'
import { getCurrentBatchWeek, isPastOptInDeadline } from '@/lib/onboarding'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { computeAndStoreIntakeEmbedding } from '@/lib/intake-embed-server'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }

  let embedOnly = false
  try {
    const body = await request.json()
    embedOnly = (body as { embedOnly?: boolean }).embedOnly === true
  } catch {
    embedOnly = false
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

  const embedResult = await computeAndStoreIntakeEmbedding(supabase, user.id, openaiKey)
  if (!embedResult.ok) {
    const status = embedResult.error === 'No intake responses found' ? 400 : 500
    return NextResponse.json({ error: embedResult.error }, { status })
  }

  const completedAt = embedResult.completedAt

  // After first-time intake completion: send entry SMS sequence (3 messages) — match-first readiness copy
  if (!embedOnly) {
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
  }

  return NextResponse.json({ ok: true, completed_at: completedAt, embedded: embedResult.embedded })
}
