/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

export function messageSmsSignupLinkSent(link: string): string {
  return `Welcome to Fika! I’m your Fika concierge. Open this link to tell us a bit about you so we can start sending you thoughtful intros:\n${link}`
}

export function messageSmsSignupLinkAlreadySent(link: string): string {
  return `Here's your link again: ${link}\n\nOpen it to finish your onboarding and finalize your Fika account.`
}
