/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkSent(_link: string): string {
  return `Welcome to Fika! I'm your Fika concierge. Open the link I'll send next to tell us a bit about you so we can start sending you thoughtful intros.`
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish your onboarding and finalize your Fika account.`
}
