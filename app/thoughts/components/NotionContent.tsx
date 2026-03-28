import type { NotionBlockWithChildren, NotionRichTextItem } from '@/lib/notion-thoughts'
import { getRichTextArray } from '@/lib/notion-thoughts'

function isNotionHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'notion.so' || h.endsWith('.notion.so') || h === 'notion.site' || h.endsWith('.notion.site')
  } catch {
    return false
  }
}

function RichTextFragment({ rt, index }: { rt: NotionRichTextItem; index: number }) {
  const content = rt.plain_text ?? rt.text?.content ?? ''
  const linkUrl = rt.text?.link?.url
  const a = rt.annotations ?? {}

  let node: React.ReactNode = content
  if (a.code) node = <code className="thoughts-inline-code">{node}</code>
  if (a.underline) node = <u>{node}</u>
  if (a.strikethrough) node = <del>{node}</del>
  if (a.italic) node = <em>{node}</em>
  if (a.bold) node = <strong>{node}</strong>

  if (linkUrl) {
    if (isNotionHost(linkUrl)) {
      node = <span className="thoughts-inline-text">{node}</span>
    } else {
      node = (
        <a href={linkUrl} rel="noopener noreferrer" className="thoughts-prose-a">
          {node}
        </a>
      )
    }
  }

  return <span key={index}>{node}</span>
}

export function RichText({ items }: { items: NotionRichTextItem[] }) {
  if (!items.length) return null
  return (
    <>
      {items.map((rt, i) => (
        <RichTextFragment key={i} rt={rt} index={i} />
      ))}
    </>
  )
}

type BlockGroup =
  | { kind: 'list'; ordered: boolean; items: NotionBlockWithChildren[] }
  | { kind: 'single'; block: NotionBlockWithChildren }

function groupBlocks(blocks: NotionBlockWithChildren[]): BlockGroup[] {
  const groups: BlockGroup[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'bulleted_list_item') {
      const items: NotionBlockWithChildren[] = []
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(blocks[i])
        i++
      }
      groups.push({ kind: 'list', ordered: false, items })
    } else if (b.type === 'numbered_list_item') {
      const items: NotionBlockWithChildren[] = []
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        items.push(blocks[i])
        i++
      }
      groups.push({ kind: 'list', ordered: true, items })
    } else {
      groups.push({ kind: 'single', block: b })
      i++
    }
  }
  return groups
}

function ListItem({ block }: { block: NotionBlockWithChildren }) {
  const parts = getRichTextArray(block, block.type)
  const childBlocks = block.children ?? []
  const nested = groupBlocks(childBlocks)

  return (
    <li className="thoughts-prose-li">
      <RichText items={parts} />
      {nested.length > 0 ? (
        <div className="thoughts-prose-nested">{nested.map((g, idx) => renderGroup(g, `n-${block.id}-${idx}`))}</div>
      ) : null}
    </li>
  )
}

function renderGroup(group: BlockGroup, keyPrefix: string): React.ReactNode {
  if (group.kind === 'list') {
    const ListTag = group.ordered ? 'ol' : 'ul'
    return (
      <ListTag key={keyPrefix} className={group.ordered ? 'thoughts-prose-ol' : 'thoughts-prose-ul'}>
        {group.items.map((item) => (
          <ListItem key={item.id} block={item} />
        ))}
      </ListTag>
    )
  }

  const block = group.block
  const id = block.id

  switch (block.type) {
    case 'paragraph': {
      const items = getRichTextArray(block, 'paragraph')
      if (!items.length) return <div key={id} className="thoughts-prose-spacer" />
      return (
        <p key={id} className="thoughts-prose-p">
          <RichText items={items} />
        </p>
      )
    }
    case 'heading_1':
      return (
        <h2 key={id} className="thoughts-prose-h2">
          <RichText items={getRichTextArray(block, 'heading_1')} />
        </h2>
      )
    case 'heading_2':
      return (
        <h3 key={id} className="thoughts-prose-h3">
          <RichText items={getRichTextArray(block, 'heading_2')} />
        </h3>
      )
    case 'heading_3':
      return (
        <h4 key={id} className="thoughts-prose-h4">
          <RichText items={getRichTextArray(block, 'heading_3')} />
        </h4>
      )
    case 'quote':
      return (
        <blockquote key={id} className="thoughts-prose-quote">
          <RichText items={getRichTextArray(block, 'quote')} />
        </blockquote>
      )
    case 'divider':
      return <hr key={id} className="thoughts-prose-hr" />
    case 'code': {
      const code = block.code as { rich_text?: NotionRichTextItem[]; language?: string } | undefined
      const text = joinPlain(code?.rich_text)
      const lang = code?.language && code.language !== 'plain text' ? code.language : null
      return (
        <pre key={id} className="thoughts-prose-pre">
          {lang ? <div className="thoughts-prose-code-lang">{lang}</div> : null}
          <code>{text}</code>
        </pre>
      )
    }
    case 'callout': {
      const callout = block.callout as { rich_text?: NotionRichTextItem[]; icon?: { emoji?: string } } | undefined
      const emoji = callout?.icon?.emoji
      return (
        <aside key={id} className="thoughts-prose-callout">
          {emoji ? <span className="thoughts-prose-callout-icon">{emoji}</span> : null}
          <div className="thoughts-prose-callout-body">
            <RichText items={callout?.rich_text ?? []} />
            {(block.children ?? []).length > 0 ? (
              <div className="thoughts-prose-callout-children">
                <NotionContent blocks={block.children ?? []} />
              </div>
            ) : null}
          </div>
        </aside>
      )
    }
    case 'toggle': {
      const items = getRichTextArray(block, 'toggle')
      return (
        <div key={id} className="thoughts-prose-toggle">
          <div className="thoughts-prose-toggle-label">
            <RichText items={items} />
          </div>
          {(block.children ?? []).length > 0 ? <NotionContent blocks={block.children ?? []} /> : null}
        </div>
      )
    }
    case 'image': {
      const img = block.image as
        | { type: string; file?: { url: string }; external?: { url: string }; caption?: NotionRichTextItem[] }
        | undefined
      if (!img) return null
      const src = img.type === 'external' ? img.external?.url : img.file?.url
      if (!src) return null
      const caption = img.caption
      const alt = joinPlain(caption)
      return (
        <figure key={id} className="thoughts-prose-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt || ''} className="thoughts-prose-img" />
          {caption?.length ? (
            <figcaption className="thoughts-prose-caption">
              <RichText items={caption} />
            </figcaption>
          ) : null}
        </figure>
      )
    }
    case 'bookmark': {
      const bm = block.bookmark as { url?: string; caption?: NotionRichTextItem[] } | undefined
      const url = bm?.url
      if (!url || isNotionHost(url)) {
        return bm?.caption?.length ? (
          <p key={id} className="thoughts-prose-p">
            <RichText items={bm.caption} />
          </p>
        ) : null
      }
      return (
        <p key={id} className="thoughts-prose-bookmark">
          <a href={url} rel="noopener noreferrer" className="thoughts-prose-a">
            {url}
          </a>
          {bm.caption?.length ? (
            <>
              {' '}
              <RichText items={bm.caption} />
            </>
          ) : null}
        </p>
      )
    }
    case 'column_list': {
      const cols = block.children ?? []
      return (
        <div key={id} className="thoughts-prose-columns">
          {cols.map((col) => {
            if (col.type !== 'column') return null
            const colChildren = col.children ?? []
            return (
              <div key={col.id} className="thoughts-prose-column">
                <NotionContent blocks={colChildren} />
              </div>
            )
          })}
        </div>
      )
    }
    case 'bulleted_list_item':
    case 'numbered_list_item':
      return (
        <ul key={id} className="thoughts-prose-ul">
          <ListItem block={block} />
        </ul>
      )
    default:
      return null
  }
}

function joinPlain(items: NotionRichTextItem[] | undefined): string {
  return items?.map((t) => t.plain_text ?? t.text?.content ?? '').join('') ?? ''
}

export function NotionContent({ blocks }: { blocks: NotionBlockWithChildren[] }) {
  const groups = groupBlocks(blocks)
  return (
    <div className="thoughts-prose">
      {groups.map((g, i) => renderGroup(g, `g-${i}`))}
    </div>
  )
}
