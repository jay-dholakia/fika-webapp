/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

import { SMS_PACING_MS } from '@/lib/sms-pacing'

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
    { content: 'Meet Jay. He’s 32, into fitness + startups.', delayAfterMs: SMS_PACING_MS.context },
    {
      content: 'You both have weekday evenings open — want to meet this week?',
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    { content: 'Send me a 👍 if you’re in. If he’s in too, we’ll suggest a time to meet up.', delayAfterMs: SMS_PACING_MS.context },
    { content: 'To get started, tell me a bit more about you here:', delayAfterMs: SMS_PACING_MS.beat },
    { content: link }
  )
  return steps
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish onboarding and activate your Fika account.`
}
