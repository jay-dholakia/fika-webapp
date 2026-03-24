'use client'

type VerifiedBadgeProps = {
  className?: string
  title?: string
}

/** Blue checkmark for government ID verified via Persona. */
export function VerifiedBadge({
  className = '',
  title = 'Government ID verified',
}: VerifiedBadgeProps) {
  return (
    <span
      className={`app-verified-badge ${className}`.trim()}
      title={title}
      aria-label={title}
      role="img"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="var(--color-verified, #1d9bf0)" />
        <path
          d="M8 12.5l2.5 2.5L16 9"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
