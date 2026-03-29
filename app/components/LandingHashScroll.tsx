'use client'

import { useEffect } from 'react'

/**
 * After navigating to /#how or /#cta from another route, Next may not scroll to the fragment.
 * Run once on the landing page when a hash is present.
 */
export default function LandingHashScroll() {
  useEffect(() => {
    const raw = window.location.hash
    if (!raw || raw.length < 2) return
    const id = decodeURIComponent(raw.slice(1))
    if (!id) return

    const run = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    requestAnimationFrame(() => {
      run()
      setTimeout(run, 100)
    })
  }, [])

  return null
}
