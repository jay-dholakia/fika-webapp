'use client'

import { useState, useEffect } from 'react'
import type { ProfileStep } from '@/lib/onboarding-data'

type SearchableMultiStep = ProfileStep & { type: 'searchable_multi'; options: string[] }

type SearchableMultiPickerProps = {
  step: SearchableMultiStep
  value: unknown
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function SearchableMultiPicker({ step, value, onChange, disabled }: SearchableMultiPickerProps) {
  const arr = (Array.isArray(value) ? value : []) as string[]
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [step.id])

  const qTrim = query.trim()
  const maxLen = step.customAnswerMaxLength ?? 100
  const maxSel = step.maxSelections ?? 8
  const qLower = qTrim.toLowerCase()
  const visibleOptions = qTrim ? step.options.filter((opt) => opt.toLowerCase().includes(qLower)).slice(0, 100) : []

  const addFromList = (opt: string) => {
    if (arr.some((x) => x.toLowerCase() === opt.toLowerCase())) return
    if (arr.length >= maxSel) return
    onChange([...arr, opt])
    setQuery('')
  }

  const addCustom = () => {
    const t = qTrim.replace(/\s+/g, ' ').slice(0, maxLen)
    if (!t) return
    if (arr.some((x) => x.toLowerCase() === t.toLowerCase())) return
    if (arr.length >= maxSel) return
    onChange([...arr, t])
    setQuery('')
  }

  const remove = (opt: string) => {
    onChange(arr.filter((x) => x !== opt))
  }

  const preview = qTrim.length > 48 ? `${qTrim.slice(0, 48)}…` : qTrim

  return (
    <div>
      <input
        type="text"
        className="auth-input"
        placeholder={step.placeholder || 'Type to search or add your own'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        autoComplete="off"
        style={{ marginBottom: '0.75rem' }}
        aria-label="Search or enter a title"
      />
      {qTrim ? (
        <div style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="onboarding-nav-link onboarding-nav-link-primary"
            style={{ display: 'inline-block' }}
            disabled={disabled || arr.length >= maxSel}
            onClick={(e) => {
              e.preventDefault()
              addCustom()
            }}
          >
            Use &ldquo;{preview}&rdquo;
          </button>
        </div>
      ) : null}
      {arr.length > 0 ? (
        <div style={{ marginBottom: '0.75rem' }}>
          {arr.map((opt) => (
            <button
              key={`${step.id}-picked-${opt}`}
              type="button"
              className="onboarding-chip multi-selected"
              onClick={(e) => {
                e.preventDefault()
                remove(opt)
              }}
              disabled={disabled}
            >
              {opt} ×
            </button>
          ))}
        </div>
      ) : null}
      {visibleOptions.map((opt) => {
        const selected = arr.some((x) => x.toLowerCase() === opt.toLowerCase())
        const atMax = arr.length >= maxSel && !selected
        return (
          <button
            key={opt}
            type="button"
            className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              if (selected) remove(opt)
              else addFromList(opt)
            }}
            disabled={disabled || (!selected && atMax)}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
