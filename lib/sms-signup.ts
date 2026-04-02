/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

import { formatMatchRevealSentence } from '@/lib/sms-agent'
import { SMS_PACING_MS } from '@/lib/sms-pacing'

/** Same shape as post–intro-card reveal copy (sendblue v2_reveal_context). Keeps the sample aligned with real intros. */
function sampleSignupIntroRevealBody(): string {
  return formatMatchRevealSentence({
    otherFirstName: 'Jay',
    sharedInterests: ['fitness', 'startups'],
    conversationHooks: [],
    curiosityOverlap: ['side projects', 'live music'],
    lifeChapterOverlap: ['doubling down on health and taking up a new hobby'],
    everydayAnchorOverlap: [],
    topCopyDimensions: ['q_interests', 'q_curiosity', 'q_life_chapter'],
  })
}

export type SmsSignupSequenceMessage = {
  content: string
  mediaUrl?: string | null
  delayAfterMs?: number
}

/** New-user phone-first signup sequence. Link is sent as the last message. */
export function messageSmsSignupLinkSentSequence(link: string, sampleImageUrl?: string | null): SmsSignupSequenceMessage[] {
  const steps: SmsSignupSequenceMessage[] = [
    { content: 'Hey hey! Welcome to Fika.', delayAfterMs: SMS_PACING_MS.quickAck },
    {
      content:
        "I'm your AI concierge. I'll introduce you to people nearby who you'd have a good conversation with.",
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    { content: 'You’ll get intros like this:', delayAfterMs: SMS_PACING_MS.context },
  ]
  if (sampleImageUrl?.trim()) {
    steps.push({ content: ' ', mediaUrl: sampleImageUrl.trim(), delayAfterMs: SMS_PACING_MS.media })
  }
  steps.push(
    { content: sampleSignupIntroRevealBody(), delayAfterMs: SMS_PACING_MS.context },
    { content: 'Want to meet this week?', delayAfterMs: SMS_PACING_MS.reflective },
    {
      content:
        "Send me a 👍 if you'd like to meet. Or reply PASS if this person doesn't feel like the right fit.",
      delayAfterMs: SMS_PACING_MS.context,
    },
    { content: 'To get started, tell me a bit more about you here:', delayAfterMs: SMS_PACING_MS.beat },
    { content: link }
  )
  return steps
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish onboarding and activate your Fika account.`
}
