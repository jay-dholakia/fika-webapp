import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { fetchPublishedThoughts } from '@/lib/notion-thoughts'

export const metadata = {
  title: 'On Conversation — Fika',
  description: 'Writing about conversation, chance encounters, and the moments that bring people closer.',
}

export const revalidate = 120

function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function thoughtHref(slug: string): string {
  return `/thoughts/${encodeURIComponent(slug)}`
}

export default async function ThoughtsPage() {
  const { items, error, configMissing } = await fetchPublishedThoughts()

  return (
    <>
      <Header />
      <main className="thoughts-page">
        <div className="thoughts-page-inner">
          <h1 className="thoughts-page-title">On Conversation</h1>
          <p className="thoughts-page-lead">
            Writing about conversation, chance encounters, and the moments that bring people closer.
          </p>

          {configMissing ? (
            <p className="thoughts-page-muted">
              This section is not configured yet. Add <code className="thoughts-page-code">NOTION_API_KEY</code> to
              the server environment to load posts from Notion.
            </p>
          ) : error ? (
            <p className="thoughts-page-error" role="alert">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="thoughts-page-muted">Nothing published here yet. Check back soon.</p>
          ) : (
            <ul className="thoughts-list" aria-label="On Conversation">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={thoughtHref(item.slug)} className="thoughts-card">
                    <div className="thoughts-card-body">
                      <h2 className="thoughts-card-title">{item.title}</h2>
                      {item.date ? (
                        <time className="thoughts-card-date" dateTime={item.date}>
                          {formatDisplayDate(item.date)}
                        </time>
                      ) : null}
                      {item.excerpt ? <p className="thoughts-card-summary">{item.excerpt}</p> : null}
                    </div>
                    <span className="thoughts-card-cta">Read</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
