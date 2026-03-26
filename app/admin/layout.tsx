'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMarkets = pathname === '/admin' || pathname === '/admin/'
  const isMap = pathname?.startsWith('/admin/map')
  const isFikas = pathname?.startsWith('/admin/fikas')
  const isSignups = pathname?.startsWith('/admin/signups')
  const isSmsControl = pathname?.startsWith('/admin/sms-control')

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
              Cities
            </Link>
            <Link
              href="/admin/map"
              className={`admin-link ${isMap ? 'admin-link-active' : ''}`}
            >
              Geo map
            </Link>
            <Link
              href="/admin/fikas"
              className={`admin-link ${isFikas ? 'admin-link-active' : ''}`}
            >
              Fikas
            </Link>
            <Link
              href="/admin/signups"
              className={`admin-link ${isSignups ? 'admin-link-active' : ''}`}
            >
              People
            </Link>
            <Link
              href="/admin/sms-control"
              className={`admin-link ${isSmsControl ? 'admin-link-active' : ''}`}
            >
              SMS control
            </Link>
            <Link href="/app/yourfika" className="admin-link">Back to app</Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
