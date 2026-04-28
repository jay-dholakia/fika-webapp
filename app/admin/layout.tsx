'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isMarkets = pathname === '/admin' || pathname === '/admin/'
  const isMap = pathname?.startsWith('/admin/map')
  const isFikas = pathname?.startsWith('/admin/fikas')
  const isSignups = pathname?.startsWith('/admin/signups')
  const isSmsControl = pathname?.startsWith('/admin/sms-control')
  const isFikaSocials = pathname?.startsWith('/admin/fika-socials')
  const isVenues = pathname?.startsWith('/admin/venues')

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  const links = useMemo(() => ([
    { href: '/admin', label: 'Cities', active: isMarkets },
    { href: '/admin/map', label: 'Geo map', active: isMap },
    { href: '/admin/fikas', label: 'Fikas', active: isFikas },
    { href: '/admin/signups', label: 'People', active: isSignups },
    { href: '/admin/sms-control', label: 'SMS control', active: isSmsControl },
    { href: '/admin/fika-socials', label: 'Fika socials', active: isFikaSocials },
    { href: '/admin/venues', label: 'Venues', active: isVenues },
    { href: '/app/yourfika', label: 'Back to app', active: false },
  ]), [isMarkets, isMap, isFikas, isSignups, isSmsControl, isFikaSocials, isVenues])

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-header-inner">
          <Link href="/" className="admin-logo">fika</Link>
          <nav className="admin-nav" aria-label="Admin navigation">
            <span className="admin-badge admin-badge-desktop">Admin</span>

            <div className="admin-nav-desktop">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`admin-link ${l.active ? 'admin-link-active' : ''}`}
                >
                  {l.label}
                </Link>
              ))}
            </div>

            <button
              type="button"
              className="admin-nav-toggle"
              aria-expanded={mobileMenuOpen}
              aria-controls="admin-mobile-menu"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileMenuOpen((o) => !o)}
            >
              <span className="admin-nav-toggle-bar" />
              <span className="admin-nav-toggle-bar" />
              <span className="admin-nav-toggle-bar" />
            </button>
          </nav>
        </div>
        <div
          id="admin-mobile-menu"
          className={`admin-nav-mobile ${mobileMenuOpen ? 'admin-nav-mobile-open' : ''}`}
          aria-hidden={!mobileMenuOpen}
        >
          <nav className="admin-nav-mobile-inner" aria-label="Admin mobile">
            <span className="admin-badge">Admin</span>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`admin-link ${l.active ? 'admin-link-active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
