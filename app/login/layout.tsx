import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Log in — Fika',
  description: 'Sign in to your Fika account.',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
