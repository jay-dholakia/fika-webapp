/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

export type SmsSignupSequenceMessage = {
  content: string
  mediaUrl?: string | null
}

/** New-user phone-first signup sequence. Link is sent as the last message. */
export function messageSmsSignupLinkSentSequence(link: string, sampleImageUrl?: string | null): SmsSignupSequenceMessage[] {
  const steps: SmsSignupSequenceMessage[] = [
    { content: 'Hey hey! Welcome to Fika.' },
    {
      content:
        "I'm your AI concierge. I'll introduce you to people nearby who you'd have a good conversation with.",
    },
    { content: 'You’ll get intros like this:' },
  ]
  if (sampleImageUrl?.trim()) {
    steps.push({ content: 'Jay, 32', mediaUrl: sampleImageUrl.trim() })
  }
  steps.push(
    { content: 'Meet Jay. He’s 32, into fitness + startups.' },
    { content: 'You’re both free Wednesday evening. Want to grab coffee at Village Well Books?' },
    { content: 'Just 👍 if you’re in. If he 👍 too, it’s locked.' },
    { content: 'To get started, tell me a bit more about you here:' },
    { content: link }
  )
  return steps
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish onboarding and activate your Fika account.`
}
