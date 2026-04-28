export const FIKA_SOCIAL_SESSION_STATUSES = [
  'draft',
  'open_opt_in',
  'opt_in_closed',
  'matching_pending_review',
  'intro_send_ready',
  'intro_sms_sent',
  'completed',
  'cancelled',
] as const

export type FikaSocialSessionStatus = (typeof FIKA_SOCIAL_SESSION_STATUSES)[number]

export function isFikaSocialSessionStatus(value: string): value is FikaSocialSessionStatus {
  return (FIKA_SOCIAL_SESSION_STATUSES as readonly string[]).includes(value)
}
