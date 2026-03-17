/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkSent(_link: string): string {
  return `Hey! Welcome to Fika.\n\nOpen the link I'll send next to tell us a bit about you so we can start sending thoughtful introductions.`
}

/** Text only; send link as a separate message after this. */
export function messageSmsSignupLinkAlreadySent(_link: string): string {
  return `Here's your link again — open it to finish onboarding and activate your Fika account.`
}
