import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fika — Real connection, one conversation at a time',
  description:
    'Fika matches you with one person for an in-person conversation based on what you share and what you don’t. No swiping. No small talk. Just one real fika.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
