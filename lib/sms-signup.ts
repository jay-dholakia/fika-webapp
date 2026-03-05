/**
 * Phone-first signup: no name/email over SMS. Send link to profile builder; they finalize with Google.
 */

export function messageSmsSignupLinkSent(link: string): string {
  return `Welcome to Fika! Open this link to complete your profile and get matched:\n${link}`
}

export function messageSmsSignupLinkAlreadySent(): string {
  return `You already have a signup link — check your texts. Open it to finish your onboarding and finalize your Fika account.`
}
