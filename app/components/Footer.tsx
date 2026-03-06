import Link from 'next/link'
import CtaWithLocation from './CtaWithLocation'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Link href="/" className="logo">
          fika
        </Link>
        <p className="footer-tagline">Real connection, one conversation at a time.</p>
        <div className="footer-waitlist">
          <p className="footer-waitlist-label">Join the waitlist</p>
          <CtaWithLocation />
        </div>
        <nav className="footer-links" aria-label="Legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </div>
    </footer>
  )
}
