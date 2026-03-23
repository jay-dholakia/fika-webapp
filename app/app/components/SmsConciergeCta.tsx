'use client'

/**
 * CTA for reply-only SMS: user can text Concierge anytime.
 * Show after phone is collected (onboarding or settings).
 */

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export function SmsConciergeCta() {
  if (!CONCIERGE_NUMBER) {
    return (
      <p className="sms-concierge-cta sms-concierge-cta--no-number">
        Text us anytime to chat with the concierge about your next Fika. (Check your account or welcome email for the number.)
      </p>
    )
  }
  return (
    <p className="sms-concierge-cta">
      Text us at <a href={`sms:${CONCIERGE_NUMBER}`}>{CONCIERGE_NUMBER}</a> anytime.
    </p>
  )
}
