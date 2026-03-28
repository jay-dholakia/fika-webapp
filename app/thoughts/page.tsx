import Header from '../components/Header'
import Footer from '../components/Footer'
import { fetchThoughtsFromNotion } from '@/lib/notion-thoughts'

export const metadata = {
  title: 'Thoughts — Fika',
  description: 'Conversations, notes, and writing from Fika.',
}

export const revalidate = 120

function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function ThoughtsPage() {
  const { items, error, configMissing } = await fetchThoughtsFromNotion()

  return (
    <>
      <Header />
      <main className="thoughts-page">
        <div className="thoughts-page-inner">
          <h1 className="thoughts-page-title">Thoughts</h1>
          <p className="thoughts-page-lead">
            Short notes and threads from us—usually about conversation, neighborhoods, and building Fika.
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
            <ul className="thoughts-list" aria-label="Thoughts">
              {items.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="thoughts-card"
                  >
                    <div className="thoughts-card-body">
                      <h2 className="thoughts-card-title">{item.title}</h2>
                      {item.publishedAt ? (
                        <time className="thoughts-card-date" dateTime={item.publishedAt}>
                          {formatDisplayDate(item.publishedAt)}
                        </time>
                      ) : null}
                      {item.summary ? <p className="thoughts-card-summary">{item.summary}</p> : null}
                    </div>
                    <span className="thoughts-card-cta">Open in Notion →</span>
                  </a>
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
