'use client'

import Link from 'next/link'
import Footer from '../components/Footer'
import CtaWithLocation from '../components/CtaWithLocation'

export default function LoginPage() {
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">
            fika
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/">Home</Link>
            <Link href="#cta" className="nav-cta">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="auth-page auth-page-cta">
        <section id="cta" className="section section-cta section-cta-full">
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Get started with Fika</h2>
            <p className="cta-sub">
              Text <strong>FIKA</strong> to our number to receive a link and create your account. Or join the waitlist below and we&apos;ll be in touch.
            </p>
            <CtaWithLocation waitlistOnly />
            <p className="auth-switch auth-switch-cta" style={{ marginTop: '1.5rem' }}>
              <Link href="/">Back to home</Link>
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
