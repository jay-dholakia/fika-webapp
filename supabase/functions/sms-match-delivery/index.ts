// Admin-triggered (not a cron). Receives { match_ids: string[] }, sends intro SMS to both
// users in each 1v1 match, and sets per-match state to match_offered.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function getSubjectPronoun(pronouns: string | null): { cap: string; haveBeen: string } {
  const p = (pronouns ?? '').toLowerCase().trim()
  if (p.startsWith('she')) return { cap: 'She', haveBeen: "She's been" }
  if (p.startsWith('he')) return { cap: 'He', haveBeen: "He's been" }
  return { cap: 'They', haveBeen: "They've been" }
}


function buildIntroMessage(params: {
  otherFirstName: string
  otherPronouns: string | null
  otherWorkLabel: string | null
  otherCurrentInterest: string | null
  otherFriendDescription: string | null
  sharedSignals: string[]
}): string {
  const {
    otherFirstName, otherPronouns, otherWorkLabel, otherCurrentInterest,
    otherFriendDescription, sharedSignals,
  } = params

  const name = otherFirstName.trim() || 'Someone'
  const { cap, haveBeen } = getSubjectPronoun(otherPronouns)

  const aboutParts: string[] = []

  if (otherWorkLabel?.trim() && otherCurrentInterest?.trim()) {
    const work = otherWorkLabel.trim()
    const interest = otherCurrentInterest.trim().replace(/\.$/, '')
    const lc = interest.charAt(0).toLowerCase() + interest.slice(1)
    aboutParts.push(`${name} works in ${work} and ${haveBeen.toLowerCase()} ${lc}.`)
  } else {
    if (otherWorkLabel?.trim()) {
      aboutParts.push(`${name} works in ${otherWorkLabel.trim()}.`)
    }
    if (otherCurrentInterest?.trim()) {
      const interest = otherCurrentInterest.trim().replace(/\.$/, '')
      const lc = interest.charAt(0).toLowerCase() + interest.slice(1)
      aboutParts.push(`${haveBeen} ${lc}.`)
    }
  }

  if (otherFriendDescription?.trim()) {
    const desc = otherFriendDescription.trim().replace(/\.$/, '')
    const lc = desc.charAt(0).toLowerCase() + desc.slice(1)
    // If description already starts with a pronoun or name, use as-is; otherwise prefix
    const firstWord = lc.split(' ')[0] ?? ''
    const pronounWords = ['she', 'he', 'they', 'i']
    if (pronounWords.includes(firstWord)) {
      aboutParts.push(`A close friend would say ${lc}.`)
    } else {
      aboutParts.push(`A close friend would describe ${cap.toLowerCase()} as: ${lc}.`)
    }
  }

  if (sharedSignals.length > 0) {
    const joined =
      sharedSignals.length === 1
        ? sharedSignals[0]
        : sharedSignals.slice(0, -1).join(', ') + ' and ' + sharedSignals[sharedSignals.length - 1]
    aboutParts.push(`You both ${joined}.`)
  }

  return [
    `We'd love to introduce you to ${name} ☕`,
    '',
    ...aboutParts,
    '',
    `This is a 1-on-1 intro — just the two of you.`,
  ].join('\n')
}

async function sendSms(params: {
  apiKeyId: string
  apiSecret: string
  phone: string
  content: string
  mediaUrl?: string
}): Promise<boolean> {
  const body: Record<string, string> = { number: params.phone, content: params.content }
  if (params.mediaUrl) body.media_url = params.mediaUrl
  const res = await fetch(SENDBLUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': params.apiKeyId,
      'sb-api-secret-key': params.apiSecret,
    },
    body: JSON.stringify(body),
  })
  return res.ok
}

serve(async (req: Request) => {
  try {
    if (Deno.env.get('SMS_OUTBOUND_DISABLED') === 'true') {
      return new Response(JSON.stringify({ ok: true, outbound_disabled: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ ok: false, error: 'Sendblue not configured' }), { status: 503 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let body: { match_ids?: unknown }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), { status: 400 })
    }

    const matchIds = Array.isArray(body.match_ids)
      ? (body.match_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : []

    if (matchIds.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No match_ids provided' }), { status: 400 })
    }

    const { data: matches, error: matchErr } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons')
      .in('id', matchIds)

    if (matchErr || !matches?.length) {
      return new Response(JSON.stringify({ ok: false, error: matchErr?.message ?? 'No matches found' }), { status: 404 })
    }

    let sent = 0
    const skipped: string[] = []
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    for (const match of matches as Array<{ id: string; user_a: string; user_b: string; reasons: Record<string, unknown> }>) {
      const matchId = match.id
      const userAId = match.user_a
      const userBId = match.user_b
      const reasons = match.reasons ?? {}

      // Safety-belt: re-check state in case it changed since the admin API pre-check
      const { data: stateRows } = await supabase
        .from('sms_conversation_states')
        .select('user_id, state, match_id, updated_at')
        .in('user_id', [userAId, userBId])

      const isBusy = (uid: string): boolean => {
        const global = (stateRows ?? []).find((r: { user_id: string; match_id: string | null }) => r.user_id === uid && r.match_id == null) as
          { state: string } | undefined
        if (global && global.state !== 'global_ready') return true
        return !!(stateRows ?? []).find((r: { user_id: string; match_id: string | null; state: string; updated_at: string }) =>
          r.user_id === uid &&
          r.match_id != null &&
          r.match_id !== matchId &&
          ['1v1_offered', '1v1_accepted', '1v1_awaiting_availability', '1v1_proposed', '1v1_confirmed', '1v1_morning_reminder'].includes(r.state) &&
          r.updated_at > cutoff24h
        )
      }

      if (isBusy(userAId) || isBusy(userBId)) {
        await supabase.from('match_candidates').update({ status: 'cancelled' }).eq('id', matchId)
        skipped.push(matchId)
        continue
      }

      const signals = Array.isArray(reasons.signals)
        ? (reasons.signals as unknown[]).filter((s): s is string => typeof s === 'string')
        : []
      const userAWork = typeof reasons.user_a_work === 'string' ? reasons.user_a_work : null
      const userBWork = typeof reasons.user_b_work === 'string' ? reasons.user_b_work : null

      // Load profiles for both users
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, first_name, phone, pronouns, avatar_url, last_fika_at')
        .in('id', [userAId, userBId])

      const profA = (profileRows ?? []).find((p: { id: string }) => p.id === userAId) as {
        id: string; first_name: string | null; phone: string | null; pronouns: string | null; avatar_url: string | null; last_fika_at: string | null
      } | undefined
      const profB = (profileRows ?? []).find((p: { id: string }) => p.id === userBId) as {
        id: string; first_name: string | null; phone: string | null; pronouns: string | null; avatar_url: string | null; last_fika_at: string | null
      } | undefined

      const phoneA = profA?.phone?.trim()
      const phoneB = profB?.phone?.trim()
      if (!phoneA || !phoneB) continue

      // Cooldown: skip if either user had a fika in the last 24h
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      if ((profA?.last_fika_at && profA.last_fika_at > cutoff24h) || (profB?.last_fika_at && profB.last_fika_at > cutoff24h)) {
        await supabase.from('match_candidates').update({ status: 'cancelled' }).eq('id', matchId)
        skipped.push(matchId)
        continue
      }


      // Load intake for both users (q_current_interest, q_friend_description)
      const { data: intakeRows } = await supabase
        .from('intake_responses_v5')
        .select('user_id, responses')
        .in('user_id', [userAId, userBId])

      type IntakeItem = { question_id: string; answer: unknown }

      const getIntakeAnswer = (userId: string, questionId: string): string | null => {
        const row = (intakeRows ?? []).find((r: { user_id: string }) => r.user_id === userId)
        if (!row) return null
        const responses = Array.isArray(row.responses) ? (row.responses as IntakeItem[]) : []
        const item = responses.find(r => r.question_id === questionId)
        return typeof item?.answer === 'string' ? item.answer.trim() || null : null
      }

      const currentInterestA = getIntakeAnswer(userAId, 'q_current_interest')
      const friendDescA = getIntakeAnswer(userAId, 'q_friend_description')
      const currentInterestB = getIntakeAnswer(userBId, 'q_current_interest')
      const friendDescB = getIntakeAnswer(userBId, 'q_friend_description')

      const nameA = profA?.first_name?.trim() || 'Someone'
      const nameB = profB?.first_name?.trim() || 'Someone'
      const avatarA = profA?.avatar_url ?? undefined
      const avatarB = profB?.avatar_url ?? undefined

      // Message for A (sees B's info): 1) intro text, 2) B's photo, 3) opt-in question
      const msgForA = buildIntroMessage({
        otherFirstName: nameB,
        otherPronouns: profB?.pronouns ?? null,
        otherWorkLabel: userBWork,
        otherCurrentInterest: currentInterestB,
        otherFriendDescription: friendDescB,
        sharedSignals: signals,
      })

      // Message for B (sees A's info): 1) intro text, 2) A's photo, 3) opt-in question
      const msgForB = buildIntroMessage({
        otherFirstName: nameA,
        otherPronouns: profA?.pronouns ?? null,
        otherWorkLabel: userAWork,
        otherCurrentInterest: currentInterestA,
        otherFriendDescription: friendDescA,
        sharedSignals: signals,
      })

      // Send 3 messages per user: intro text → photo → opt-in question
      await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: msgForA })
      if (avatarB) await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: ' ', mediaUrl: avatarB })
      const sentA = await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: `Would you like to set up a Fika with ${nameB}? Reply Yes or No.` })

      await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: msgForB })
      if (avatarA) await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: ' ', mediaUrl: avatarA })
      const sentB = await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: `Would you like to set up a Fika with ${nameA}? Reply Yes or No.` })

      if (sentA || sentB) {
        const now = new Date().toISOString()
        // Upsert per-match state for both users
        for (const userId of [userAId, userBId]) {
          await supabase
            .from('sms_conversation_states')
            .upsert(
              {
                user_id: userId,
                match_id: matchId,
                state: '1v1_offered',
                payload: { intro_offer_sent_at: now },
                last_sendblue_message_handle: null,
              },
              { onConflict: 'user_id,match_id' }
            )
        }
        sent++
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
