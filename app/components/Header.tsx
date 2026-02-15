'use client'

import { useState } from 'react'

const navLinks = [
  { href: '#what', label: 'What is Fika' },
  { href: '#how', label: 'How it works' },
  { href: '#cta', label: 'Get notified', cta: true },
]

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header className="header">
      <div className="header-inner">
        <a href="/" className="logo">
          Fika
        </a>
        <nav className="nav" aria-label="Main">
          {navLinks.map(({ href, label, cta }) => (
            <a
              key={href}
              href={href}
              className={cta ? 'nav-cta' : ''}
              onClick={closeMenu}
            >
              {label}
            </a>
          ))}
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
          {navLinks.map(({ href, label, cta }) => (
            <a
              key={href}
              href={href}
              className={cta ? 'nav-mobile-cta' : ''}
              onClick={closeMenu}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}
