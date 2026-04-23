import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign up — Fika',
  description: 'Create your Fika account—meet someone new and have a real conversation.',
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
