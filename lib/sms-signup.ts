/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 *
 * Callers should always pass a non-empty `sampleImageUrl` (e.g. dynamic /api/intro-card for Maya + fika).
 * The concierge webhook builds that URL before calling this helper.
 */

import { SMS_PACING_MS } from '@/lib/sms-pacing'

/** Natural sample “reveal” after the card—demo only, not a real match. */
function sampleSignupIntroRevealBody(): string {
  return (
    "Meet Maya. She's a Graphic Designer and loves typography and film photography. " +
    "You both like talking about travel stories, creative side projects, and what's been making you laugh lately. " +
    'Want to meet for Fika? Reply with a Yes or No.'
  )
}

export type SmsSignupSequenceMessage = {
  content: string
  mediaUrl?: string | null
  delayAfterMs?: number
}

/**
 * New-user signup: warm welcome → concierge role → teaser line → sample MMS → natural read → get started → link.
 */
export function messageSmsSignupLinkSentSequence(link: string, sampleImageUrl: string): SmsSignupSequenceMessage[] {
  const imageUrl = sampleImageUrl.trim()
  if (!imageUrl) {
    throw new Error('messageSmsSignupLinkSentSequence: sampleImageUrl is required (use Maya /api/intro-card URL from webhook).')
  }

  return [
    { content: 'Hey! Welcome to Fika.', delayAfterMs: SMS_PACING_MS.quickAck },
    {
      content:
        "I'm your concierge—I'll send over intros to people nearby I think you'll have a good conversation with, and help you both set up a time to meet for coffee.",
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    { content: "You'll get intros like this:", delayAfterMs: SMS_PACING_MS.context },
    { content: ' ', mediaUrl: imageUrl, delayAfterMs: SMS_PACING_MS.media },
    { content: sampleSignupIntroRevealBody(), delayAfterMs: SMS_PACING_MS.context },
    { content: 'To get started, tell me a bit about you here:', delayAfterMs: SMS_PACING_MS.beat },
    { content: link, delayAfterMs: SMS_PACING_MS.quickAck },
  ]
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return "Here's your link again—open it to pick up where you left off and finish onboarding."
}
