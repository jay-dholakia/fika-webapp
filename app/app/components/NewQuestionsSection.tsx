'use client'

import { getMissingIntakeStepIds } from '@/lib/onboarding'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

type NewQuestionsSectionProps = {
  userId: string | null
  intake: IntakeResponsesV5Row | null
  onboardingLoading: boolean
  onboardingComplete: boolean
  refetch: () => void
}

export function NewQuestionsSection({
  intake,
  onboardingLoading,
  onboardingComplete,
}: NewQuestionsSectionProps) {
  const missingIntakeSteps = onboardingComplete && intake ? getMissingIntakeStepIds(intake) : []
  const showCard = !onboardingLoading && onboardingComplete && missingIntakeSteps.length > 0

  if (!showCard) return null

  return (
    <div className="app-card app-new-questions-card">
      <h2>A few new questions</h2>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
        We&apos;ve added a few questions to help us find you a better match. Text us back to fill them in — it only takes a minute.
      </p>
      <a
        href="sms:+13102102404?body=Hi"
        className="btn btn-primary btn-block auth-submit"
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
      >
        Update via text
      </a>
    </div>
  )
}
