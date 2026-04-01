/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

export type SmsSignupSequenceMessage = {
  content: string
  mediaUrl?: string | null
  delayAfterMs?: number
}

/** New-user phone-first signup sequence. Link is sent as the last message. */
export function messageSmsSignupLinkSentSequence(link: string, sampleImageUrl?: string | null): SmsSignupSequenceMessage[] {
  const steps: SmsSignupSequenceMessage[] = [
    { content: 'Hey hey! Welcome to Fika.', delayAfterMs: 1000 },
    {
      content:
        "I'm your AI concierge. I'll introduce you to people nearby who you'd have a good conversation with.",
      delayAfterMs: 2500,
    },
    { content: 'You’ll get intros like this:', delayAfterMs: 2000 },
  ]
  if (sampleImageUrl?.trim()) {
    steps.push({ content: ' ', mediaUrl: sampleImageUrl.trim(), delayAfterMs: 3000 })
  }
  steps.push(
    { content: 'Meet Jay. He’s 32, into fitness + startups.', delayAfterMs: 2000 },
    {
      content: 'You’re both free Wednesday evening. Want to grab coffee at Village Well Books?',
      delayAfterMs: 3000,
    },
    { content: 'Just 👍 if you’re in. If he 👍 too, it’s locked.', delayAfterMs: 2000 },
    { content: 'To get started, tell me a bit more about you here:', delayAfterMs: 1500 },
    { content: link }
  )
  return steps
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish onboarding and activate your Fika account.`
}
