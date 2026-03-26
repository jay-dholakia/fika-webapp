/** Same as lib/wall-time-to-utc.ts — keep in sync for Deno Edge. */

export function localDateTimeInTzToUtcMs(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string
): number | null {
  const parts = dateStr.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const d = parts[2]
  if (y == null || mo == null || d == null || !Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null
  }
  const start = Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - 12 * 60 * 60 * 1000
  const end = Date.UTC(y, mo - 1, d, 23, 59, 0, 0) + 12 * 60 * 60 * 1000
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  for (let t = start; t <= end; t += 60 * 1000) {
    const fp = fmt.formatToParts(new Date(t))
    const py = +((fp.find((p) => p.type === 'year')?.value ?? '0') as string)
    const pm = +((fp.find((p) => p.type === 'month')?.value ?? '0') as string)
    const pd = +((fp.find((p) => p.type === 'day')?.value ?? '0') as string)
    const ph = +((fp.find((p) => p.type === 'hour')?.value ?? '0') as string)
    const pmin = +((fp.find((p) => p.type === 'minute')?.value ?? '0') as string)
    if (py === y && pm === mo && pd === d && ph === hour && pmin === minute) return t
  }
  return null
}
