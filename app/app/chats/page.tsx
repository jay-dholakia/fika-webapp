'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { ConversationRow } from '@/lib/db-types'

type ChatItem = {
  id: string
  otherUserId: string
  otherFirstName: string
  lastActivityAt: string | null
  createdAt: string | null
}

export default function AppChatsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase
      .from('conversations')
      .select('id, user_a, user_b, last_activity_at, created_at')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('conversation_type', 'match')
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .then(({ data: convos, error: convError }) => {
        if (convError || !convos?.length) {
          setChats([])
          setLoading(false)
          return
        }
        const otherIds = Array.from(new Set((convos as ConversationRow[]).map((c) => (c.user_a === userId ? c.user_b : c.user_a)).filter(Boolean) as string[]))
        if (otherIds.length === 0) {
          setChats([])
          setLoading(false)
          return
        }
        supabase
          .from('profiles')
          .select('id, first_name')
          .in('id', otherIds)
          .then(({ data: profiles }) => {
            const nameBy = (profiles ?? []).reduce<Record<string, string>>((acc, p) => {
              acc[p.id] = p.first_name?.trim() || 'Someone'
              return acc
            }, {})
            const list: ChatItem[] = (convos as ConversationRow[]).map((c) => {
              const otherId = c.user_a === userId ? c.user_b : c.user_a
              return {
                id: c.id,
                otherUserId: otherId ?? '',
                otherFirstName: nameBy[otherId ?? ''] ?? 'Someone',
                lastActivityAt: c.last_activity_at ?? null,
                createdAt: c.created_at ?? null,
              }
            })
            setChats(list)
          })
          .then(() => setLoading(false), () => setLoading(false))
      })
  }, [userId])

  if (loading) {
    return (
      <div className="app-card">
        <h2>Active chats</h2>
        <p className="app-empty">Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-card">
      <h2>Active chats</h2>
      {chats.length === 0 ? (
        <p className="app-empty">
          When you and your intro opt-in for a Fika, your Fika chat will appear here.
        </p>
      ) : (
        <ul className="app-chat-list" aria-label="Your conversations">
          {chats.map((chat) => (
            <li key={chat.id}>
              <Link href={`/app/chats/${chat.id}`} className="app-chat-list-item">
                <span className="app-chat-list-name">{chat.otherFirstName}</span>
                <span className="app-chat-list-meta">
                  {chat.lastActivityAt
                    ? new Date(chat.lastActivityAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'New chat'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
