export const WEEKLY_FIKA_SESSION_STATUSES = [
  'draft',
  'open_opt_in',
  'opt_in_closed',
  'matching_pending_review',
  'intro_send_ready',
  'intro_sms_sent',
  'completed',
  'cancelled',
] as const

export type WeeklyFikaSessionStatus = (typeof WEEKLY_FIKA_SESSION_STATUSES)[number]

export function isWeeklyFikaSessionStatus(value: string): value is WeeklyFikaSessionStatus {
  return (WEEKLY_FIKA_SESSION_STATUSES as readonly string[]).includes(value)
}
