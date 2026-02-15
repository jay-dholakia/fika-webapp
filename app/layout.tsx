import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fika — Real connection, one conversation at a time',
  description:
    'Fika sends you a weekly set of intros. Choose who you’d like to meet for a real-life conversation—based on what you share and what you don’t. Real people. Real conversation.',
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
