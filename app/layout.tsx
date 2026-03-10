import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fika — Real connection, one conversation at a time',
  description:
    'Fika sends you one intro every week by text. No app. No endless chats—just a real conversation with someone new.',
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
