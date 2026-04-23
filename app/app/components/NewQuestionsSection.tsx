'use client'

import { useState } from 'react'
import { getOrderedMissingIntakeSteps, getMissingIntakeStepIds } from '@/lib/onboarding'
import { getSupabase } from '@/lib/supabase'
import { NewQuestionsFlow } from '@/app/app/components/NewQuestionsFlow'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

type NewQuestionsSectionProps = {
  userId: string | null
  intake: IntakeResponsesV5Row | null
  onboardingLoading: boolean
  onboardingComplete: boolean
  refetch: () => void
}

export function NewQuestionsSection({
  userId,
  intake,
  onboardingLoading,
  onboardingComplete,
  refetch,
}: NewQuestionsSectionProps) {
  const [fillingMissingMode, setFillingMissingMode] = useState(false)

  const missingIntakeSteps = onboardingComplete && intake ? getMissingIntakeStepIds(intake) : []
  const showNewQuestionsCard =
    !onboardingLoading && onboardingComplete && missingIntakeSteps.length > 0 && !fillingMissingMode
  const orderedMissingSteps = intake ? getOrderedMissingIntakeSteps(intake) : []

  if (!showNewQuestionsCard && !(fillingMissingMode && userId && intake && orderedMissingSteps.length > 0)) {
    return null
  }

  return (
    <>
      {showNewQuestionsCard && (
        <div className="app-card app-new-questions-card">
          <h2>New intro questions added</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            We&apos;ve added a few new questions to help us line up better intros for you. Complete them so your intro stays up to date.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block auth-submit"
            style={{ display: 'block', textAlign: 'center' }}
            onClick={() => setFillingMissingMode(true)}
          >
            Complete new questions
          </button>
        </div>
      )}

      {fillingMissingMode && userId && intake && orderedMissingSteps.length > 0 && (
        <NewQuestionsFlow
          orderedSteps={orderedMissingSteps}
          intake={intake}
          userId={userId}
          onComplete={async () => {
            setFillingMissingMode(false)
            try {
              const supabase = getSupabase()
              const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
              if (session?.access_token) {
                await fetch('/api/complete-intake', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ embedOnly: true }),
                })
              }
            } catch {
              // non-fatal: intro refresh can be retried from settings
            }
            refetch()
          }}
        />
      )}
    </>
  )
}
