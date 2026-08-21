/**
 * Free-text availability parsing and overlap detection for user-scheduled Fika intros.
 * All markets are currently in California, so timezone is always America/Los_Angeles.
 */

export type TimeWindow = { date: string; startHour: number; endHour: number }

const FIKA_TIMEZONE = 'America/Los_Angeles'

function todayInPT(): Date {
  const now = new Date()
  const ptStr = now.toLocaleDateString('en-CA', { timeZone: FIKA_TIMEZONE })
  return new Date(ptStr + 'T00:00:00')
}

/** ISO YYYY-MM-DD string for a date offset from a base date. */
function dateOffset(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatWindowLabel(base: Date): string {
  const end = new Date(base)
  end.setDate(base.getDate() + 5)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' })
  return `${fmt(base)} through ${fmt(end)}`
}

/**
 * Parse a user's free-text availability message into structured time windows.
 * Uses GPT-4o-mini. Returns [] if input is too vague or no OPENAI_API_KEY.
 *
 * @param text   Raw message from user (e.g. "Tomorrow after 5, Thursday 3–6pm")
 * @param anchor The "tomorrow" anchor date — typically the date the 2nd YES was received
 */
export async function parseAvailability(text: string, anchor: Date): Promise<TimeWindow[]> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY
  if (!apiKey) return []

  const today = todayInPT()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  // 5-day window: tomorrow through tomorrow+4 (inclusive)
  const windowDates: string[] = Array.from({ length: 5 }, (_, i) => dateOffset(tomorrow, i))
  const windowLabel = formatWindowLabel(tomorrow)

  // Build a day-name → date lookup for the window
  const dayNames = windowDates.map((d) => {
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, weekday: 'long' })
  })
  const windowStr = windowDates.map((d, i) => `${dayNames[i]} = ${d}`).join(', ')

  const systemPrompt = `You parse availability from casual SMS messages into structured JSON time windows.

Today in Los Angeles time: ${today.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
5-day availability window: ${windowLabel}
Day-to-date mapping for this window: ${windowStr}

Return a JSON array of objects with this shape:
  { "date": "YYYY-MM-DD", "startHour": <0-23>, "endHour": <1-24> }

Rules:
- Only include dates within the 5-day window above; ignore anything outside it
- "tomorrow" = ${windowDates[0]}
- Resolve day names (Monday, Tuesday, etc.) to their date in the window above
- "after X" → startHour = X (24h), endHour = 22
- "anytime" or no time given for a day → startHour = 9, endHour = 22
- "morning" → 9-12, "afternoon" → 12-18, "evening" → 18-22
- "noon" = 12, "midnight" = 0
- All hours in 24h format (e.g. "5pm" = 17)
- If the message is genuinely unparseable, return []
- Return ONLY the JSON array, nothing else`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 400,
      }),
    })
    if (!res.ok) return []
    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const raw = json.choices?.[0]?.message?.content?.trim() ?? ''
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[]).filter((w): w is TimeWindow => {
      if (typeof w !== 'object' || w === null) return false
      const x = w as Record<string, unknown>
      return (
        typeof x.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
        windowDates.includes(x.date) &&
        typeof x.startHour === 'number' &&
        typeof x.endHour === 'number' &&
        x.startHour >= 0 &&
        x.endHour <= 24 &&
        x.startHour < x.endHour
      )
    })
  } catch {
    return []
  }
}

/**
 * Find the earliest date where both users' windows overlap by at least 1 hour.
 * Returns the intersection window on that date (capped to a 2h block from overlap start).
 * Pass `excludeDates` to skip specific dates (e.g. a previously rejected slot).
 */
export function findEarliestOverlap(
  windowsA: TimeWindow[],
  windowsB: TimeWindow[],
  excludeDates: string[] = []
): TimeWindow | null {
  const byDate = (windows: TimeWindow[]) => {
    const m = new Map<string, TimeWindow>()
    for (const w of windows) {
      const existing = m.get(w.date)
      if (!existing || w.startHour < existing.startHour) {
        m.set(w.date, w)
      }
    }
    return m
  }

  const mapA = byDate(windowsA)
  const mapB = byDate(windowsB)

  const sharedDates = Array.from(mapA.keys())
    .filter((d) => mapB.has(d) && !excludeDates.includes(d))
    .sort()

  for (const date of sharedDates) {
    const a = mapA.get(date)!
    const b = mapB.get(date)!
    const start = Math.max(a.startHour, b.startHour)
    const end = Math.min(a.endHour, b.endHour)
    if (end - start >= 1) {
      const blockEnd = Math.min(end, start + 2)
      return { date, startHour: start, endHour: blockEnd }
    }
  }
  return null
}

/** Format a TimeWindow for SMS display: "Thursday, Jul 31 at 5pm" */
export function formatProposedTime(window: TimeWindow): string {
  const dt = new Date(`${window.date}T${String(window.startHour).padStart(2, '0')}:00:00`)
  const day = dt.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, weekday: 'long' })
  const date = dt.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, month: 'short', day: 'numeric' })
  let time = dt.toLocaleTimeString('en-US', { timeZone: FIKA_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  time = time.replace(':00', '')
  return `${day}, ${date} at ${time}`
}

/**
 * Returns the next `n` weekday (Mon–Fri) dates starting from `from`, formatted for SMS display.
 * e.g. [{ label: "Wed 8/20", date: "2025-08-20" }, ...]
 */
export function getNextWeekdays(from: Date, n = 5): { label: string; date: string }[] {
  const result: { label: string; date: string }[] = []
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  while (result.length < n) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      const dayAbbr = d.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, weekday: 'short' })
      const month = d.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, month: 'numeric' })
      const day = d.toLocaleDateString('en-US', { timeZone: FIKA_TIMEZONE, day: 'numeric' })
      result.push({ label: `${dayAbbr} ${month}/${day}`, date: d.toISOString().slice(0, 10) })
    }
    d.setDate(d.getDate() + 1)
  }
  return result
}

/**
 * Extract chosen dates from a numbered reply (e.g. "1 and 3" or "2, 4").
 * Maps 1-based indices to the corresponding day_options entries.
 */
export function extractChosenDates(
  text: string,
  dayOptions: { label: string; date: string }[]
): string[] {
  const max = dayOptions.length
  const seen = new Set<number>()
  const result: string[] = []
  const re = /\b([1-9])\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1])
    if (n >= 1 && n <= max && !seen.has(n)) {
      seen.add(n)
      result.push(dayOptions[n - 1].date)
    }
  }
  return result
}

/** Convert a TimeWindow start to UTC, handling PST/PDT automatically. */
export function windowStartToUtc(window: TimeWindow): Date {
  const hh = String(window.startHour).padStart(2, '0')
  // Try PDT (-07:00) first; verify it gives the right LA hour, fall back to PST (-08:00)
  const pdtCandidate = new Date(`${window.date}T${hh}:00:00-07:00`)
  const laHour = parseInt(
    pdtCandidate.toLocaleString('en-US', { timeZone: FIKA_TIMEZONE, hour: 'numeric', hour12: false }),
    10
  )
  if (laHour === window.startHour) return pdtCandidate
  return new Date(`${window.date}T${hh}:00:00-08:00`)
}
