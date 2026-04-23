import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fika — Meet someone new. Have a real conversation.',
  description:
    'Fika sends you one intro every week by text. Meet someone new. Have a real conversation—no app, no endless chats.',
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
