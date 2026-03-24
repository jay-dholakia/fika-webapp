/**
 * English short names for ISO 3166-1 regions (countries/territories), sorted A–Z.
 * Built at runtime via Intl so we don't ship a huge static list.
 */
export function buildCountryNames(): string[] {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames === 'undefined') {
    return ['Canada', 'Mexico', 'United Kingdom', 'United States']
  }
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  const names = new Set<string>()
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(65 + i) + String.fromCharCode(65 + j)
      const n = dn.of(code)
      if (n && n !== code) names.add(n)
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

export const COUNTRY_NAMES = buildCountryNames()

/** Match onboarding answer for U.S. (Intl label for US). */
export const HOME_COUNTRY_UNITED_STATES = 'United States'
