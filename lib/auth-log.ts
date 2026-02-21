/**
 * Auth/onboarding flow logging. Filter console by "[fika]" to see only these.
 * Set NEXT_PUBLIC_FIKA_AUTH_LOG=0 to disable in production if needed.
 */
const PREFIX = '[fika]'
const enabled =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_FIKA_AUTH_LOG !== '0'

export function authLog(
  label: string,
  detail?: Record<string, unknown> | string
) {
  if (!enabled) return
  const payload = detail === undefined ? {} : typeof detail === 'string' ? { msg: detail } : detail
  console.log(PREFIX, label, payload)
}
