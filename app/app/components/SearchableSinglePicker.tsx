'use client'

import { useState, useEffect } from 'react'
import type { ProfileStep } from '@/lib/onboarding-data'

type SearchableSingleStep = ProfileStep & { type: 'searchable_single'; options: string[] }

type SearchableSinglePickerProps = {
  step: SearchableSingleStep
  value: unknown
  onChange: (next: string) => void
  disabled?: boolean
}

export function SearchableSinglePicker({ step, value, onChange, disabled }: SearchableSinglePickerProps) {
  const selected = typeof value === 'string' ? value.trim() : ''
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [step.id])

  const qTrim = query.trim()
  const maxLen = step.customAnswerMaxLength ?? 100
  const qLower = qTrim.toLowerCase()
  const featured = step.featuredOptions?.length ? step.featuredOptions : null
  const visibleOptions = qTrim
    ? step.options.filter((opt) => opt.toLowerCase().includes(qLower)).slice(0, 100)
    : featured
      ? featured
      : []

  const pick = (opt: string) => {
    onChange(opt)
    setQuery('')
  }

  const pickCustom = () => {
    const t = qTrim.replace(/\s+/g, ' ').slice(0, maxLen)
    if (!t) return
    onChange(t)
    setQuery('')
  }

  const preview = qTrim.length > 48 ? `${qTrim.slice(0, 48)}…` : qTrim

  return (
    <div>
      <input
        type="text"
        className="auth-input"
        placeholder={step.placeholder || 'Type to search or enter your own'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        autoComplete="off"
        style={{ marginBottom: '0.75rem' }}
        aria-label={step.placeholder?.trim() ? step.placeholder : 'Search or enter your answer'}
      />
      {qTrim ? (
        <div style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="onboarding-nav-link onboarding-nav-link-primary"
            style={{ display: 'inline-block' }}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              pickCustom()
            }}
          >
            Use &ldquo;{preview}&rdquo;
          </button>
        </div>
      ) : null}
      {featured && !qTrim && !selected && step.featuredOptionsCaption ? (
        <p
          className="onboarding-body"
          style={{ marginBottom: '0.5rem', marginTop: 0, fontSize: '0.875rem', color: 'var(--color-textSecondary)' }}
        >
          {step.featuredOptionsCaption}
        </p>
      ) : null}
      {selected ? (
        <div style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="onboarding-chip multi-selected"
            onClick={(e) => {
              e.preventDefault()
              onChange('')
            }}
            disabled={disabled}
          >
            {selected} ×
          </button>
        </div>
      ) : null}
      {visibleOptions.map((opt) => {
        const isSel = selected.toLowerCase() === opt.toLowerCase()
        return (
          <button
            key={opt}
            type="button"
            className={`onboarding-chip ${isSel ? 'multi-selected' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              if (isSel) onChange('')
              else pick(opt)
            }}
            disabled={disabled}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
