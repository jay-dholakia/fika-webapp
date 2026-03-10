/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

export function messageSmsSignupLinkSent(link: string): string {
  return `Welcome to Fika! Open this link to complete your profile and we'll get you set up:\n${link}`
}

export function messageSmsSignupLinkAlreadySent(link: string): string {
  return `Here's your link again: ${link}\n\nOpen it to finish your onboarding and finalize your Fika account.`
}
