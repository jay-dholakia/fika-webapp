// Admin-triggered (not a cron). Receives { match_ids: string[] }, sends intro SMS to both
// users in each 1v1 match, and sets per-match state to match_offered.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getSubjectPronoun(pronouns: string | null): { cap: string; haveBeen: string } {
  const p = (pronouns ?? '').toLowerCase().trim()
  if (p.startsWith('she')) return { cap: 'She', haveBeen: "She's been" }
  if (p.startsWith('he')) return { cap: 'He', haveBeen: "He's been" }
  return { cap: 'They', haveBeen: "They've been" }
}


// Life situations we skip mentioning in an intro (too personal / implies unemployment)
const WORK_SKIP_IN_INTRO = new Set([
  'between jobs', 'taking a break', 'on sabbatical', 'n/a',
])

function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0]
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

// Keywords that flag a free-text field as too personal to surface in an intro message.
const SENSITIVE_TERMS = /cancer|chemo|chemotherapy|tumor|radiation|depress|anxiety disorder|mental illness|hospital|therapist|therapy|psychiatric|eating disorder|laid\s+off|job\s+loss|fired|bankrupt|bankruptcy|debt|broke\b/i

function safe(text: string | null | undefined): string | null {
  if (!text?.trim()) return null
  return SENSITIVE_TERMS.test(text) ? null : text.trim()
}

function buildIntroMessage(params: {
  otherFirstName: string
  otherPronouns: string | null
  sharedInterests: string[]
  sharedTopics: string[]
  // free-text fields — all run through sensitive filter before use
  onMind: string | null
  wantToTry: string | null
  talkForever: string | null
  interestsFreetext: string | null
}): string {
  const { otherFirstName, otherPronouns, sharedInterests, sharedTopics, onMind, wantToTry, talkForever, interestsFreetext } = params
  const name = otherFirstName.trim() || 'Someone'
  const { cap, haveBeen } = getSubjectPronoun(otherPronouns)

  // Sentence 1: shared interests/topics (chip data — not sensitive)
  const shared = [
    ...sharedInterests.slice(0, 3).map(s => s.toLowerCase()),
    ...sharedTopics.slice(0, 2).map(s => s.toLowerCase()),
  ].slice(0, 3)

  const line1 = shared.length > 0
    ? `${name} is into ${joinList(shared)}.`
    : `${name} is someone I thought you'd connect well with.`

  // Additional sentences from free-text (filtered) — include up to 3 for a fuller picture
  const safeOnMind      = safe(onMind)
  const safeWantToTry   = safe(wantToTry)
  const safeTalkForever = safe(talkForever)
  const safeFreetext    = safe(interestsFreetext)

  const extras: string[] = []

  if (safeOnMind) {
    const lc = safeOnMind.replace(/\.$/, '')
    extras.push(`${haveBeen} ${lc.charAt(0).toLowerCase() + lc.slice(1)}.`)
  }
  if (safeWantToTry && extras.length < 3) {
    const lc = safeWantToTry.replace(/\.$/, '').toLowerCase()
    extras.push(`${cap} has been wanting to get into ${lc}.`)
  }
  if (safeTalkForever && extras.length < 3) {
    const lc = safeTalkForever.replace(/\.$/, '').toLowerCase()
    extras.push(`${cap} could talk about ${lc} for hours.`)
  }
  if (safeFreetext && extras.length < 3) {
    const lc = safeFreetext.replace(/\.$/, '')
    extras.push(`Outside of work, ${name.toLowerCase()} is into ${lc.charAt(0).toLowerCase() + lc.slice(1)}.`)
  }

  return [line1, ...extras].filter(Boolean).join(' ')
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
        await supabase.from('match_candidates').update({ status: 'expired' }).eq('id', matchId)
        skipped.push(matchId)
        continue
      }

      const signals = Array.isArray(reasons.signals)
        ? (reasons.signals as unknown[]).filter((s): s is string => typeof s === 'string')
        : []

      // Load profiles for both users
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, first_name, phone, pronouns, avatar_url, last_fika_at, birthdate')
        .in('id', [userAId, userBId])

      const profA = (profileRows ?? []).find((p: { id: string }) => p.id === userAId) as {
        id: string; first_name: string | null; phone: string | null; pronouns: string | null; avatar_url: string | null; last_fika_at: string | null; birthdate: string | null
      } | undefined
      const profB = (profileRows ?? []).find((p: { id: string }) => p.id === userBId) as {
        id: string; first_name: string | null; phone: string | null; pronouns: string | null; avatar_url: string | null; last_fika_at: string | null; birthdate: string | null
      } | undefined

      const phoneA = profA?.phone?.trim()
      const phoneB = profB?.phone?.trim()
      if (!phoneA || !phoneB) continue

      // Cooldown: skip if either user had a fika in the last 24h
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      if ((profA?.last_fika_at && profA.last_fika_at > cutoff24h) || (profB?.last_fika_at && profB.last_fika_at > cutoff24h)) {
        await supabase.from('match_candidates').update({ status: 'expired' }).eq('id', matchId)
        skipped.push(matchId)
        continue
      }

      // Load intake for both users
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

      const getIntakeAnswerMulti = (userId: string, questionId: string): string[] => {
        const row = (intakeRows ?? []).find((r: { user_id: string }) => r.user_id === userId)
        if (!row) return []
        const responses = Array.isArray(row.responses) ? (row.responses as IntakeItem[]) : []
        const item = responses.find(r => r.question_id === questionId)
        if (!Array.isArray(item?.answer)) return []
        return (item.answer as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      }

      const workA = getIntakeAnswer(userAId, 'q_work')
      const workB = getIntakeAnswer(userBId, 'q_work')

      const interestsA = getIntakeAnswerMulti(userAId, 'q_interests')
      const interestsB = getIntakeAnswerMulti(userBId, 'q_interests')
      const sharedInterests = interestsA.filter(x => interestsB.includes(x))

      const topicsA = getIntakeAnswerMulti(userAId, 'q_like_talking_about')
      const topicsB = getIntakeAnswerMulti(userBId, 'q_like_talking_about')
      const sharedTopics = topicsA.filter(x => topicsB.includes(x))

      // Additional free-text fields for richer message — both web and SMS paths
      // q_about_me is the new SMS free-text field; falls back to legacy per-question fields
      const aboutMeA   = getIntakeAnswer(userAId, 'q_about_me')
      const aboutMeB   = getIntakeAnswer(userBId, 'q_about_me')
      const onMindA    = getIntakeAnswer(userAId, 'q_on_mind') ?? getIntakeAnswer(userAId, 'q_current_interest') ?? aboutMeA
      const onMindB    = getIntakeAnswer(userBId, 'q_on_mind') ?? getIntakeAnswer(userBId, 'q_current_interest') ?? aboutMeB
      const wantTryA   = getIntakeAnswer(userAId, 'q_want_to_try')
      const wantTryB   = getIntakeAnswer(userBId, 'q_want_to_try')
      const talkForA   = getIntakeAnswer(userAId, 'q_talk_forever') ?? (aboutMeA && !onMindA ? aboutMeA : null)
      const talkForB   = getIntakeAnswer(userBId, 'q_talk_forever') ?? (aboutMeB && !onMindB ? aboutMeB : null)
      const freeTextA  = getIntakeAnswer(userAId, 'q_interests_freetext') ?? (aboutMeA && !onMindA && !talkForA ? aboutMeA : null)
      const freeTextB  = getIntakeAnswer(userBId, 'q_interests_freetext') ?? (aboutMeB && !onMindB && !talkForB ? aboutMeB : null)

      const nameA = profA?.first_name?.trim() || 'Someone'
      const nameB = profB?.first_name?.trim() || 'Someone'

      function calcAge(birthdate: string | null): string | null {
        if (!birthdate) return null
        const d = new Date(birthdate)
        const today = new Date()
        let age = today.getFullYear() - d.getFullYear()
        const m = today.getMonth() - d.getMonth()
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
        return age >= 18 && age < 120 ? String(age) : null
      }

      const appBase = (Deno.env.get('APP_CANONICAL_URL') ?? 'https://letsfika.vercel.app').replace(/\/$/, '')

      function introCardUrl(avatarUrl: string | null | undefined, firstName: string, birthdate: string | null): string | undefined {
        if (!avatarUrl) return undefined
        const u = new URL('/api/intro-card', appBase)
        u.searchParams.set('avatar', avatarUrl)
        u.searchParams.set('name', firstName)
        const age = calcAge(birthdate)
        if (age) u.searchParams.set('age', age)
        return u.toString()
      }

      const avatarA = introCardUrl(profA?.avatar_url, nameA, profA?.birthdate ?? null)
      const avatarB = introCardUrl(profB?.avatar_url, nameB, profB?.birthdate ?? null)

      // Use LLM-generated copy if stored, otherwise fall back to template
      const llmCopy = reasons.copy as { messageForA?: string; messageForB?: string; llm_generated?: boolean } | undefined
      const useLlmCopy = llmCopy?.llm_generated === true && llmCopy.messageForA && llmCopy.messageForB

      const msgForA = useLlmCopy
        ? llmCopy!.messageForA!
        : buildIntroMessage({
            otherFirstName: nameB,
            otherPronouns: profB?.pronouns ?? null,
            sharedInterests,
            sharedTopics,
            onMind: onMindB,
            wantToTry: wantTryB,
            talkForever: talkForB,
            interestsFreetext: freeTextB,
          })

      const msgForB = useLlmCopy
        ? llmCopy!.messageForB!
        : buildIntroMessage({
            otherFirstName: nameA,
            otherPronouns: profA?.pronouns ?? null,
            sharedInterests,
            sharedTopics,
            onMind: onMindA,
            wantToTry: wantTryA,
            talkForever: talkForA,
            interestsFreetext: freeTextA,
          })

      const teaserForA = workB && !WORK_SKIP_IN_INTRO.has(workB.toLowerCase())
        ? `Hey ${nameA}, I have a Fika intro for you — ${nameB} is a ${workB} and I think you two would have a great conversation.`
        : `Hey ${nameA}, I have a Fika intro for you that I thought was worth sharing.`

      const teaserForB = workA && !WORK_SKIP_IN_INTRO.has(workA.toLowerCase())
        ? `Hey ${nameB}, I have a Fika intro for you — ${nameA} is a ${workA} and I think you two would have a great conversation.`
        : `Hey ${nameB}, I have a Fika intro for you that I thought was worth sharing.`

      // 3-message sequence per user: teaser → intro + photo → 24h ask
      await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: teaserForA })
      await sleep(1500)
      const sentA = await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: msgForA })
      if (avatarB) await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: ' ', mediaUrl: avatarB })
      await sleep(1500)
      await sendSms({ apiKeyId, apiSecret, phone: phoneA, content: `Let me know if you'd want to meet with ${nameB} for Fika? You've got 24 hours — reply yes or no.` })

      await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: teaserForB })
      await sleep(1500)
      const sentB = await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: msgForB })
      if (avatarA) await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: ' ', mediaUrl: avatarA })
      await sleep(1500)
      await sendSms({ apiKeyId, apiSecret, phone: phoneB, content: `Let me know if you'd want to meet with ${nameA} for Fika? You've got 24 hours — reply yes or no.` })

      if (sentA || sentB) {
        const now = new Date().toISOString()
        // Write per-match state for both users. Delete first to avoid any stale row,
        // then insert fresh — avoids relying on upsert/onConflict with partial indexes.
        for (const uid of [userAId, userBId]) {
          await supabase
            .from('sms_conversation_states')
            .delete()
            .eq('user_id', uid)
            .eq('match_id', matchId)
          await supabase
            .from('sms_conversation_states')
            .insert({
              user_id: uid,
              match_id: matchId,
              state: '1v1_offered',
              payload: { intro_offer_sent_at: now },
              last_sendblue_message_handle: null,
            })
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
