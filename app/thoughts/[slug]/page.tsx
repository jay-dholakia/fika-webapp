import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Header from '@/app/components/Header'
import Footer from '@/app/components/Footer'
import { fetchThoughtBySlug, fetchAllPublishedSlugs } from '@/lib/notion-thoughts'
import { NotionContent } from '../components/NotionContent'

export const revalidate = 120

type Props = { params: { slug: string } }

function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export async function generateStaticParams() {
  try {
    const slugs = await fetchAllPublishedSlugs()
    return slugs.map((slug) => ({ slug }))
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const raw = decodeURIComponent(params.slug)
  const result = await fetchThoughtBySlug(raw)
  if (!result.ok) {
    return { title: 'On Conversation — Fika' }
  }
  return {
    title: `${result.post.title} — On Conversation — Fika`,
    description: result.post.excerpt ?? result.post.title,
  }
}

export default async function ThoughtPostPage({ params }: Props) {
  const slug = decodeURIComponent(params.slug)
  const result = await fetchThoughtBySlug(slug)

  if (!result.ok) {
    if (result.error === 'not_found') notFound()
    return (
      <>
        <Header />
        <main className="thoughts-page">
          <div className="thoughts-page-inner">
            <p className="thoughts-page-error" role="alert">
              {result.error === 'config'
                ? 'On Conversation is not configured.'
                : result.message ?? 'Something went wrong loading this post.'}
            </p>
            <Link href="/thoughts" className="thoughts-back-link">
              ← Back to On Conversation
            </Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const { post, blocks } = result

  return (
    <>
      <Header />
      <main className="thoughts-page thoughts-post-page">
        <article className="thoughts-page-inner thoughts-article">
          <nav className="thoughts-breadcrumb" aria-label="Breadcrumb">
            <Link href="/thoughts" className="thoughts-back-link">
              On Conversation
            </Link>
            <span className="thoughts-breadcrumb-sep" aria-hidden>
              /
            </span>
            <span className="thoughts-breadcrumb-current">{post.title}</span>
          </nav>

          <header className="thoughts-article-header">
            <h1 className="thoughts-article-title">{post.title}</h1>
            {post.date ? (
              <time className="thoughts-article-date" dateTime={post.date}>
                {formatDisplayDate(post.date)}
              </time>
            ) : null}
            {post.excerpt ? <p className="thoughts-article-excerpt">{post.excerpt}</p> : null}
          </header>

          <NotionContent blocks={blocks} />
        </article>
      </main>
      <Footer />
    </>
  )
}
