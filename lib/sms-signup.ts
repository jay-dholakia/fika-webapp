/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

import { SMS_PACING_MS } from '@/lib/sms-pacing'

export type SmsSignupSequenceMessage = {
  content: string
  mediaUrl?: string | null
  delayAfterMs?: number
}

/**
 * New-user signup: warm welcome -> what Fika is -> get started -> link.
 */
export function messageSmsSignupLinkSentSequence(link: string, _sampleImageUrl?: string): SmsSignupSequenceMessage[] {
  return [
    { content: 'Hey! Welcome to Fika. ☕', delayAfterMs: SMS_PACING_MS.quickAck },
    {
      content: "We do the work — find someone great, share a bit about them, set up a time and place. You just show up.",
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    { content: 'Set up your profile to get started:', delayAfterMs: SMS_PACING_MS.beat },
    { content: link, delayAfterMs: SMS_PACING_MS.quickAck },
  ]
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return "Here's your link again—open it to pick up where you left off and finish setting up your profile."
}
