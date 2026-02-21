'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { getCurrentBatchWeek } from '@/lib/onboarding'

export default function AppHomePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [introBalance, setIntroBalance] = useState<number | null>(null)
  const [optedIn, setOptedIn] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    const batchWeek = getCurrentBatchWeek()

    Promise.all([
      supabase.from('profiles').select('intro_balance').eq('id', userId).single(),
      supabase.from('weekly_match_opt_ins').select('user_id').eq('user_id', userId).eq('batch_week', batchWeek).maybeSingle(),
    ]).then(([profileRes, optInRes]) => {
      setIntroBalance(profileRes.data?.intro_balance ?? 0)
      setOptedIn(!!optInRes.data)
      setLoading(false)
    })
  }, [userId])

  async function toggleOptIn() {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    setToggling(true)
    const batchWeek = getCurrentBatchWeek()
    try {
      if (optedIn) {
        const { error: e } = await supabase
          .from('weekly_match_opt_ins')
          .delete()
          .eq('user_id', userId)
          .eq('batch_week', batchWeek)
        if (e) throw e
        setOptedIn(false)
      } else {
        const { error: e } = await supabase
          .from('weekly_match_opt_ins')
          .insert({ user_id: userId, batch_week: batchWeek, opted_in_at: new Date().toISOString() })
        if (e) throw e
        setOptedIn(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update opt-in.')
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="app-empty">
        Loading…
      </div>
    )
  }

  return (
    <>
      <div className="app-card">
        <div className="app-intro-balance">
          ☕ Intros: <span>{introBalance ?? 0}</span>
        </div>
        <p className="auth-sub" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          Use an intro to opt in to a match. Need more? <strong>Get intros</strong> — coming soon.
        </p>
      </div>

      <div className="app-card">
        <h2>Weekly introductions</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
          Opt in to be included in this week&apos;s match run. New intros appear here after the run.
        </p>
        <div className="app-opt-in-toggle">
          <button
            type="button"
            className={`btn ${optedIn ? '' : 'btn-primary'}`}
            onClick={toggleOptIn}
            disabled={toggling}
          >
            {toggling ? 'Updating…' : optedIn ? "I'm opted in this week" : "Opt in to this week's introductions"}
          </button>
        </div>
        {error && <p className="onboarding-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
      </div>

      <div className="app-card">
        <h2>Your introductions</h2>
        <p className="app-empty" style={{ padding: '1rem 0' }}>
          Introductions will appear here after the next weekly run. Make sure you&apos;re opted in above.
        </p>
      </div>
    </>
  )
}
