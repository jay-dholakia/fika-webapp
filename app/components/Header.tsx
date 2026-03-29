'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const navLinks: {
  href: string
  label: string
  cta?: boolean
  when?: 'always' | 'guest'
  pathMatch?: string
}[] = [
  { href: '/#how', label: 'How it works', when: 'always' },
  { href: '/thoughts', label: 'On Conversation', when: 'always', pathMatch: '/thoughts' },
  { href: '/login', label: 'Login', when: 'guest' },
]

export default function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const closeMenu = () => setIsMenuOpen(false)

  async function handleSignOut() {
    const supabase = getSupabase()
    if (supabase) await supabase.auth.signOut()
    router.push('/')
    router.refresh()
    closeMenu()
  }

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo">
          fika
        </Link>
        <nav className="nav" aria-label="Main">
          {navLinks
            .filter((l) => l.when === 'always' || (l.when === 'guest' && !user))
            .map(({ href, label, cta, pathMatch }) => (
            <Link
              key={href}
              href={href}
              className={[cta ? 'nav-cta' : '', pathMatch && pathname === pathMatch ? 'nav-link-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={closeMenu}
            >
              {label}
            </Link>
          ))}
          {user ? (
            <>
              <Link href="/app/yourfika" onClick={closeMenu}>Account</Link>
              <button type="button" className="nav-link-button" onClick={() => { handleSignOut(); closeMenu(); }}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/#cta" className="nav-cta" onClick={closeMenu}>Sign up</Link>
            </>
          )}
        </nav>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={isMenuOpen}
          aria-controls="mobile-menu"
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setIsMenuOpen((prev) => !prev)}
        >
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
        </button>
      </div>
      <div
        id="mobile-menu"
        className={`nav-mobile ${isMenuOpen ? 'nav-mobile-open' : ''}`}
        aria-hidden={!isMenuOpen}
      >
        <nav className="nav-mobile-inner" aria-label="Mobile">
          {navLinks
            .filter((l) => l.when === 'always' || (l.when === 'guest' && !user))
            .map(({ href, label, cta, pathMatch }) => (
            <Link
              key={href}
              href={href}
              className={[cta ? 'nav-mobile-cta' : '', pathMatch && pathname === pathMatch ? 'nav-link-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={closeMenu}
            >
              {label}
            </Link>
          ))}
          {user ? (
            <>
              <Link href="/app/yourfika" onClick={closeMenu}>Account</Link>
              <button type="button" className="nav-link-button" onClick={() => { handleSignOut(); closeMenu(); }}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/#cta" className="nav-mobile-cta" onClick={closeMenu}>Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
