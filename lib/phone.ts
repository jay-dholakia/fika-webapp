/**
 * Normalize a phone number to E.164 for Supabase (e.g. +13334445555).
 * Strips non-digits; if 10 digits assumes US (+1); if 11 digits and starts with 1, treats as US.
 */
export function toE164(value: string, defaultCountryCode = '1'): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.length === 10 && defaultCountryCode === '1') return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

/** Return true if the string looks like a valid E.164 (e.g. at least 10 digits after stripping). */
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10
}
