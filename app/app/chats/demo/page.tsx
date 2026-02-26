'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

const LIV_MENTION = /@liv\b/i

const DEMO_LIV_REPLIES = [
  "I'd suggest trying a café midway between you — maybe The Daily Grind or Brew & Co. Both are great for a first meetup and have a relaxed vibe to get together and chat!",
  "How about the place on Main St? It's right in the middle and does great coffee. Perfect spot to meet up.",
]

const DEMO_MESSAGES = [
  { id: '1', text: 'Hey! Nice to meet you through Fika 👋', isMe: false, isLiv: false, createdAt: '2025-02-14T10:00:00' },
  { id: '2', text: 'Hi! Same here — looking forward to grabbing coffee.', isMe: true, isLiv: false, createdAt: '2025-02-14T10:02:00' },
  { id: '3', text: '@Liv where should we get coffee?', isMe: false, isLiv: false, createdAt: '2025-02-14T10:04:00' },
  { id: '4', text: DEMO_LIV_REPLIES[0], isMe: false, isLiv: true, createdAt: '2025-02-14T10:05:00' },
  { id: '5', text: 'Thursday works! How about 3pm at The Daily Grind?', isMe: true, isLiv: false, createdAt: '2025-02-14T10:08:00' },
  { id: '6', text: 'Perfect, see you then 🙂', isMe: false, isLiv: false, createdAt: '2025-02-14T10:10:00' },
]

export default function AppChatDemoPage() {
  const [messages, setMessages] = useState(DEMO_MESSAGES)
  const [sendText, setSendText] = useState('')
  const [livThinking, setLivThinking] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, livThinking])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const text = sendText.trim()
    if (!text) return
    setMessages((prev) => [
      ...prev,
      {
        id: `demo-${Date.now()}`,
        text,
        isMe: true,
        isLiv: false,
        createdAt: new Date().toISOString(),
      },
    ])
    setSendText('')
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

    if (LIV_MENTION.test(text)) {
      setLivThinking(true)
      const delay = 800 + Math.random() * 700
      setTimeout(() => {
        const reply = DEMO_LIV_REPLIES[Math.floor(Math.random() * DEMO_LIV_REPLIES.length)]
        setMessages((prev) => [
          ...prev,
          {
            id: `demo-liv-${Date.now()}`,
            text: reply,
            isMe: false,
            isLiv: true,
            createdAt: new Date().toISOString(),
          },
        ])
        setLivThinking(false)
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, delay)
    }
  }

  return (
    <div className="app-chat-detail">
      <header className="app-chat-header">
        <Link href="/app/chats" className="app-chat-back" aria-label="Back to chats">
          ← Back
        </Link>
        <h2 className="app-chat-title">Demo chat</h2>
        <span className="app-chat-demo-badge">Preview</span>
      </header>
      <div className="app-chat-messages" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`app-chat-bubble ${
              msg.isLiv ? 'app-chat-bubble-liv' : msg.isMe ? 'app-chat-bubble-me' : 'app-chat-bubble-them'
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
          maxLength={2000}
          aria-label="Message"
        />
        <button type="submit" className="app-chat-send" disabled={!sendText.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
