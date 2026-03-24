import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your Fika',
  description: 'Your Fika intro and status',
}

export default function YourFikaLayout({ children }: { children: React.ReactNode }) {
  return children
}
