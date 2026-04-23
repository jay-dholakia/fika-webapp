'use client'

import { useMemo } from 'react'

type MarketTenureSliderProps = {
  options: string[]
  value: string | undefined
  onChange: (next: string) => void
  disabled?: boolean
  id?: string
}

export function MarketTenureSlider({ options, value, onChange, disabled, id }: MarketTenureSliderProps) {
  const max = Math.max(0, options.length - 1)
  const index = useMemo(() => {
    const i = value != null ? options.indexOf(value) : -1
    return i >= 0 ? i : 0
  }, [options, value])

  const label = options[index] ?? options[0] ?? ''

  return (
    <div className="onboarding-slider-wrap">
      <input
        id={id}
        type="range"
        className="onboarding-slider"
        min={0}
        max={max}
        step={1}
        value={index}
        disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={index}
        aria-valuetext={label}
        aria-label="How long you have lived in this area"
        onChange={(e) => {
          const nextIdx = Number(e.target.value)
          const opt = options[nextIdx]
          if (opt) onChange(opt)
        }}
      />
      <p className="onboarding-slider-label" aria-live="polite">
        {label}
      </p>
    </div>
  )
}
