'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { getCurrentBatchWeek } from '@/lib/onboarding'
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_DAY_LABELS,
  AVAILABILITY_TIME_ROWS,
  getAvailabilitySlotId,
  isAvailabilityLocked,
  formatNextWeekRange,
} from '@/lib/availability-slots'

export default function AvailabilityPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [readyHint, setReadyHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marketSlug, setMarketSlug] = useState<string | null>(null)
  const [marketActive, setMarketActive] = useState<boolean | null>(null)
  const conciergeNumber = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

  const batchWeek = getCurrentBatchWeek()
  const locked = isAvailabilityLocked(batchWeek)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    supabase
      .from('profiles')
      .select('market')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const slug = (data as { market?: string | null } | null)?.market ?? null
        setMarketSlug(slug)
        if (!slug) {
          setMarketActive(false)
          return
        }
        fetch(`/api/profile-count?market=${encodeURIComponent(slug)}`, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j: { active?: boolean }) => setMarketActive(j?.active === true))
          .catch(() => setMarketActive(false))
      })
  }, [userId])

  useEffect(() => {
    if (!userId) return
    if (marketActive === false) return
    const supabase = getSupabase()
    if (!supabase) return
    supabase
      .from('weekly_availability')
      .select('availability_slots')
      .eq('user_id', userId)
      .eq('batch_week', batchWeek)
      .maybeSingle()
      .then(({ data }) => {
        const arr = Array.isArray(data?.availability_slots) ? data.availability_slots : []
        setSlots(new Set(arr))
      })
  }, [userId, batchWeek])

  function toggleSlot(dayIndex: number, timeIndex: number) {
    if (locked) return
    const id = getAvailabilitySlotId(dayIndex, timeIndex)
    if (!id) return
    setSlots((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked || !userId) return
    setError(null)
    setSaving(true)
    const supabase = getSupabase()
    if (!supabase) {
      setError('Not configured')
      setSaving(false)
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setError('Please sign in again.')
      setSaving(false)
      return
    }
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          batch_week: batchWeek,
          availability_slots: Array.from(slots),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to save')
        setSaving(false)
        return
      }
      setSaved(true)
      const sr = (data as { sms_ready?: { message?: string | null } }).sms_ready
      setReadyHint(typeof sr?.message === 'string' ? sr.message : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="app-card">
        <p className="app-empty">Loading…</p>
      </div>
    )
  }

  // marketActive is set asynchronously; avoid rendering the grid until we know true/false.
  if (marketActive === null) {
    return (
      <div className="app-card">
        <p className="app-empty">Loading…</p>
      </div>
    )
  }

  if (marketActive === false) {
    return (
      <div className="app-card">
        <h2 className="app-page-title">Your city isn’t active yet</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
          Once it&apos;s active, this is where you&apos;ll set your availability so we can find a Fika time that works for you and your match.
        </p>
      </div>
    )
  }

  return (
    <div className="app-card">
      <h2 className="app-page-title">Your Availability</h2>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
        When are you free for a Fika? We use this to find a time that works for both you and your match.
      </p>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
        {formatNextWeekRange(batchWeek)} — tap the slots you&apos;re available.
      </p>

      {locked && (
        <p className="onboarding-error" style={{ marginBottom: '1rem' }}>
          Availability for this period is locked. You&apos;ll be able to update when the next window opens—we&apos;ll remind you by text if needed.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="app-availability-grid-table">
          <div className="app-availability-grid-head" role="row">
            <div className="app-availability-grid-corner">Time</div>
            {AVAILABILITY_DAY_LABELS.map((label) => (
              <div key={label} className="app-availability-grid-head-cell">{label}</div>
            ))}
          </div>
          {AVAILABILITY_TIME_ROWS.map((row, timeIndex) => (
            <div key={row.id} className="app-availability-grid-row" role="row">
              <div className="app-availability-grid-time-cell">{row.label}</div>
              {AVAILABILITY_DAYS.map((_, dayIndex) => {
                const id = getAvailabilitySlotId(dayIndex, timeIndex)
                const selected = id ? slots.has(id) : false
                return (
                  <button
                    key={dayIndex}
                    type="button"
                    className={`app-availability-grid-cell ${selected ? 'app-availability-grid-cell-selected' : ''}`}
                    onClick={() => toggleSlot(dayIndex, timeIndex)}
                    disabled={locked}
                    aria-pressed={selected}
                    aria-label={`${AVAILABILITY_DAY_LABELS[dayIndex]} ${row.label}`}
                  />
                )
              })}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || locked}
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save availability'}
          </button>
        </div>
      </form>

      {saved && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.95rem' }}>
          <p style={{ color: 'var(--color-success)' }}>Your availability is saved.</p>
          {readyHint ? (
            <>
              <p style={{ color: 'var(--color-textSecondary)', marginTop: '0.5rem' }}>{readyHint}</p>
              {conciergeNumber && (
                <a
                  href={`sms:${conciergeNumber}?&body=READY`}
                  className="btn btn-primary"
                  style={{ display: 'inline-block', marginTop: '0.5rem' }}
                >
                  Confirm in SMS
                </a>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--color-textSecondary)', marginTop: '0.5rem' }}>
              We&apos;ll text you when we have a match.
            </p>
          )}
        </div>
      )}
      {error && <p className="onboarding-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  )
}
