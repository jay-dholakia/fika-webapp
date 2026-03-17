'use client'

/**
 * CTA for reply-only SMS: user must text FIKA or HI to the Concierge number to start.
 * Show after phone is collected (onboarding or settings).
 */

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export function SmsConciergeCta() {
  if (!CONCIERGE_NUMBER) {
    return (
      <p className="sms-concierge-cta sms-concierge-cta--no-number">
        Text <strong>FIKA</strong> or <strong>HI</strong> to get your first intro and opt in for the week. (Check your account or welcome email for the number.)
      </p>
    )
  }
  return (
    <p className="sms-concierge-cta">
      Text <strong>FIKA</strong> or <strong>HI</strong> to{' '}
      <a href={`sms:${CONCIERGE_NUMBER}`}>{CONCIERGE_NUMBER}</a> to get your first intro and opt in for the week.
    </p>
  )
}
