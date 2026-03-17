'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMarkets = pathname === '/admin' || pathname === '/admin/'
  const isSignups = pathname?.startsWith('/admin/signups')
  const isMap = pathname?.startsWith('/admin/map')

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-header-inner">
          <Link href="/" className="admin-logo">fika</Link>
          <nav className="admin-nav">
            <span className="admin-badge">Admin</span>
            <Link
              href="/admin"
              className={`admin-link ${isMarkets ? 'admin-link-active' : ''}`}
            >
              Markets
            </Link>
            <Link
              href="/admin/signups"
              className={`admin-link ${isSignups ? 'admin-link-active' : ''}`}
            >
              Sign-ups
            </Link>
            <Link
              href="/admin/map"
              className={`admin-link ${isMap ? 'admin-link-active' : ''}`}
            >
              Map
            </Link>
            <Link href="/app/weeklyfika" className="admin-link">Back to app</Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
