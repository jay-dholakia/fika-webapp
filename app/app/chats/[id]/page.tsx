'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { ConversationRow, MessageRow } from '@/lib/db-types'

/** Shape returned by .select('id, text, created_at, sender_type, sender_id') on messages */
type MessageSelectRow = Pick<MessageRow, 'id' | 'text' | 'created_at' | 'sender_type' | 'sender_id'>

const LIV_MENTION = /@liv\b/i

type DisplayMessage = {
  id: string
  text: string
  createdAt: string | null
  isMe: boolean
  senderType: string
  isLiv?: boolean
}

export default function AppChatDetailPage() {
  const params = useParams()
  const conversationId = typeof params?.id === 'string' ? params.id : null
  const [userId, setUserId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ConversationRow | null>(null)
  const [otherFirstName, setOtherFirstName] = useState<string>('')
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [livThinking, setLivThinking] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!userId || !conversationId) {
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
      .select('*')
      .eq('id', conversationId)
      .single()
      .then(({ data: conv, error: convError }) => {
        if (convError || !conv) {
          setConversation(null)
          setLoading(false)
          return
        }
        const c = conv as ConversationRow
        const isParticipant = c.user_a === userId || c.user_b === userId
        if (!isParticipant) {
          setConversation(null)
          setLoading(false)
          return
        }
        setConversation(c)
        const otherId = c.user_a === userId ? c.user_b : c.user_a
        if (otherId) {
          supabase
            .from('profiles')
            .select('first_name')
            .eq('id', otherId)
            .single()
            .then(({ data: profile }) => {
              setOtherFirstName(profile?.first_name?.trim() || 'Someone')
            })
        }
      })
  }, [userId, conversationId])

  useEffect(() => {
    if (!conversationId) return
    const supabase = getSupabase()
    if (!supabase) return

    supabase
      .from('messages')
      .select('id, text, created_at, sender_type, sender_id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data: rows, error }) => {
        if (error || !userId) {
          setMessages([])
          return
        }
        const list: DisplayMessage[] = (rows ?? []).map((m: MessageSelectRow) => ({
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          isMe: m.sender_type === 'user' && m.sender_id === userId,
          senderType: m.sender_type,
          isLiv: m.sender_type === 'ai',
        }))
        setMessages(list)
      })
  }, [conversationId, userId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = sendText.trim()
    if (!text || !userId || !conversationId || sending) return
    const supabase = getSupabase()
    if (!supabase) return

    setSending(true)
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'user',
      sender_id: userId,
      text,
    })
    if (error) {
      setSending(false)
      return
    }
    setSendText('')
    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        text,
        createdAt: new Date().toISOString(),
        isMe: true,
        senderType: 'user',
      },
    ])
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setSending(false)

    if (LIV_MENTION.test(text)) {
      setLivThinking(true)
      const { data, error: fnError } = await supabase.functions.invoke('ask-liv', {
        body: { conversation_id: conversationId, message_text: text },
      })
      setLivThinking(false)
      if (!fnError && data?.message) {
        setMessages((prev) => [
          ...prev,
          {
            id: data.message.id ?? `liv-${Date.now()}`,
            text: data.message.text,
            createdAt: data.message.created_at ?? new Date().toISOString(),
            isMe: false,
            senderType: 'ai',
            isLiv: true,
          },
        ])
      } else if (!fnError && data?.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `liv-err-${Date.now()}`,
            text: "Sorry, I couldn't find suggestions right now. Try again in a bit!",
            createdAt: new Date().toISOString(),
            isMe: false,
            senderType: 'ai',
            isLiv: true,
          },
        ])
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  if (!conversationId) {
    return (
      <div className="app-card">
        <p className="app-empty">Invalid chat.</p>
        <Link href="/app/chats">Back to chats</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app-card">
        <p className="app-empty">Loading…</p>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="app-card">
        <p className="app-empty">Chat not found or you don&apos;t have access.</p>
        <Link href="/app/chats">Back to chats</Link>
      </div>
    )
  }

  return (
    <div className="app-chat-detail">
      <header className="app-chat-header">
        <Link href="/app/chats" className="app-chat-back" aria-label="Back to chats">
          ← Back
        </Link>
        <h2 className="app-chat-title">{otherFirstName}</h2>
      </header>
      <div className="app-chat-messages" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`app-chat-bubble ${
              msg.isLiv
                ? 'app-chat-bubble-liv'
                : msg.isMe
                  ? 'app-chat-bubble-me'
                  : 'app-chat-bubble-them'
            }`}
          >
            {msg.isLiv && <span className="app-chat-bubble-liv-label">✨ Liv</span>}
            <span className="app-chat-bubble-text">{msg.text}</span>
            {msg.createdAt && (
              <span className="app-chat-bubble-time">
                {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        ))}
        {livThinking && (
          <div className="app-chat-bubble app-chat-bubble-liv app-chat-bubble-thinking">
            <span className="app-chat-bubble-liv-label">✨ Liv</span>
            <span className="app-chat-bubble-text">Thinking…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="app-chat-form">
        <input
          type="text"
          value={sendText}
          onChange={(e) => setSendText(e.target.value)}
          placeholder="Try @Liv for meetup suggestions"
          className="app-chat-input"
          disabled={sending}
          maxLength={2000}
          aria-label="Message"
        />
        <button type="submit" className="app-chat-send" disabled={sending || !sendText.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
