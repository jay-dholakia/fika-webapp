import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Complete your profile — Fika',
  description: 'A few questions so we can suggest the right people for you.',
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
