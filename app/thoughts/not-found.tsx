import Link from 'next/link'
import Header from '@/app/components/Header'
import Footer from '@/app/components/Footer'

export default function ThoughtsNotFound() {
  return (
    <>
      <Header />
      <main className="thoughts-page">
        <div className="thoughts-page-inner">
          <h1 className="thoughts-page-title">Not found</h1>
          <p className="thoughts-page-muted">
            This thought doesn&apos;t exist or isn&apos;t published anymore.
          </p>
          <Link href="/thoughts" className="thoughts-back-link thoughts-back-link-block">
            ← Back to Thoughts
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
