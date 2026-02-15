'use client'

import { useEffect, useRef } from 'react'

export default function ScrollReveal({
  children,
}: {
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const elements = root.querySelectorAll('[data-animate]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
          }
        })
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0 }
    )

    elements.forEach((el) => observer.observe(el))
    return () => elements.forEach((el) => observer.unobserve(el))
  }, [])

  return <div ref={rootRef}>{children}</div>
}
