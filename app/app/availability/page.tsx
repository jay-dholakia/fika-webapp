'use client'

import { useState, useEffect, useRef } from 'react'
import { getSupabase } from '@/lib/supabase'
import { getCurrentBatchWeek } from '@/lib/onboarding'
import {
  getAvailabilitySlotLabel,
  isAvailabilityLocked,
  formatNextWeekRange,
  AVAILABILITY_DAY_LABELS,
  AVAILABILITY_TIME_ROWS,
  getAvailabilitySlotId,
  isAvailabilitySlotId,
} from '@/lib/availability-slots'

const LOCK_TIME_COPY = 'Sunday at 11:59pm'

export default function AvailabilityPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [availabilitySlots, setAvailabilitySlots] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<{ fillValue: boolean; lastSlotId: string | null }>({ fillValue: false, lastSlotId: null })
  const pointerDownSlotRef = useRef<string | null>(null)

  const batchWeek = getCurrentBatchWeek()
  const locked = isAvailabilityLocked(batchWeek)
  const weekLabel = formatNextWeekRange(batchWeek)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase
      .from('weekly_availability')
      .select('availability_slots')
      .eq('user_id', userId)
      .eq('batch_week', batchWeek)
      .maybeSingle()
      .then(({ data }) => {
        const raw = Array.isArray(data?.availability_slots) ? data.availability_slots : []
        setAvailabilitySlots(raw.filter((id: string) => isAvailabilitySlotId(id)))
        setLoading(false)
      })
  }, [userId, batchWeek])

  function setSlot(slotId: string, selected: boolean) {
    setAvailabilitySlots((prev) =>
      selected ? (prev.includes(slotId) ? prev : [...prev, slotId]) : prev.filter((s) => s !== slotId)
    )
  }

  function toggleSlot(slotId: string) {
    if (locked) return
    setAvailabilitySlots((prev) =>
      prev.includes(slotId) ? prev.filter((s) => s !== slotId) : [...prev, slotId]
    )
  }

  function handleCellPointerDown(slotId: string, e: React.PointerEvent) {
    if (locked) return
    pointerDownSlotRef.current = slotId
    const selected = !availabilitySlots.includes(slotId)
    dragRef.current = { fillValue: selected, lastSlotId: slotId }
    setSlot(slotId, selected)
    const grid = e.currentTarget.closest('.app-availability-grid-table')
    if (grid instanceof HTMLElement) grid.setPointerCapture(e.pointerId)
  }

  function handleGridPointerMove(e: React.PointerEvent) {
    if (locked || dragRef.current.lastSlotId === null) return
    const target = document.elementFromPoint(e.clientX, e.clientY)
    const slotId = target?.getAttribute('data-slot-id')
    if (slotId && slotId !== dragRef.current.lastSlotId) {
      dragRef.current.lastSlotId = slotId
      setSlot(slotId, dragRef.current.fillValue)
    }
  }

  function handleGridPointerUp() {
    dragRef.current.lastSlotId = null
  }

  function handleCellClick(slotId: string) {
    if (locked) return
    if (pointerDownSlotRef.current === slotId) {
      pointerDownSlotRef.current = null
      return
    }
    pointerDownSlotRef.current = null
    toggleSlot(slotId)
  }

  async function save() {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    setSaving(true)
    try {
      const { error: upsertErr } = await supabase
        .from('weekly_availability')
        .upsert(
          {
            user_id: userId,
            batch_week: batchWeek,
            availability_slots: availabilitySlots,
          },
          { onConflict: 'user_id,batch_week' }
        )
      if (upsertErr) throw upsertErr
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save availability.')
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

  return (
    <div className="app-card">
      <h2 className="app-page-title">Your Availability</h2>

      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
        Pick times you&apos;re free <strong>Wednesday–Sunday</strong> (9am–7pm, 30-min slots). Matches run Tuesday morning; you have until Tuesday 11:59pm to confirm. Tap or click to toggle; hold and drag to fill or clear multiple.
      </p>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
        <strong>Lock:</strong> Opt-in and availability close {LOCK_TIME_COPY}. You can&apos;t change anything until the next week.
      </p>

      {locked && (
        <p className="onboarding-error" style={{ marginBottom: '1rem' }}>
          Availability for the week of {weekLabel} is locked ({LOCK_TIME_COPY}). The intro run will happen soon. You can edit again when the new week starts.
        </p>
      )}

      {!locked && (
        <>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            Week of <strong>{weekLabel}</strong>
          </p>
          <div
            className="app-availability-grid-table"
            role="grid"
            aria-label="Your Availability next week"
            aria-readonly={locked}
            onPointerMove={handleGridPointerMove}
            onPointerUp={handleGridPointerUp}
            onPointerLeave={handleGridPointerUp}
            onPointerCancel={handleGridPointerUp}
            style={{ touchAction: locked ? undefined : 'none', userSelect: 'none' }}
          >
            <div className="app-availability-grid-head">
              <div className="app-availability-grid-corner" aria-hidden />
              {AVAILABILITY_DAY_LABELS.map((day) => (
                <div key={day} className="app-availability-grid-head-cell" role="columnheader">
                  {day}
                </div>
              ))}
            </div>
            {AVAILABILITY_TIME_ROWS.map((time, timeIndex) => (
              <div key={time.id} className="app-availability-grid-row" role="row">
                <div className="app-availability-grid-time-cell" role="rowheader">
                  {time.label}
                </div>
                {AVAILABILITY_DAY_LABELS.map((_, dayIndex) => {
                  const slotId = getAvailabilitySlotId(dayIndex, timeIndex)
                  const selected = availabilitySlots.includes(slotId)
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`app-availability-grid-cell ${selected ? 'app-availability-grid-cell-selected' : ''}`}
                      data-slot-id={slotId}
                      aria-label={getAvailabilitySlotLabel(slotId)}
                      aria-pressed={selected}
                      disabled={locked}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        handleCellPointerDown(slotId, e)
                      }}
                      onClick={(e) => {
                        e.preventDefault()
                        handleCellClick(slotId)
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save availability'}
          </button>
        </>
      )}

      {locked && availabilitySlots.length > 0 && (
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginTop: '1rem' }}>
          You had {availabilitySlots.length} slot{availabilitySlots.length !== 1 ? 's' : ''} set for this week.
        </p>
      )}

      {error && <p className="onboarding-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  )
}
