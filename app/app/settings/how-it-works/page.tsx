'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'What is Fika?',
    a: 'A platonic coffee meetup, set up by text. One conversation, in person. That\'s it.',
  },
  {
    q: 'How do intros work?',
    a: 'When we find a good fit nearby, we text you a snapshot — who they are and what you share. If you\'re both in, we pick a café and send the details. No back-and-forth needed.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'Each message says how long you have. If the window closes, we keep looking and will text you again when there\'s another good intro.',
  },
  {
    q: 'I can\'t make my Fika — what do I do?',
    a: 'Text us as soon as you know. We\'ll handle it from there.',
  },
  {
    q: 'Is it safe to meet someone this way?',
    a: 'All meetups are in public spots. Trust your instincts — if something feels off, reach out at support@letsfika.co.',
  },
  {
    q: 'How much does it cost?',
    a: 'Free.',
  },
  {
    q: 'My match didn\'t show up.',
    a: 'Text us. We\'ll follow up with them. Repeated no-shows can lead to removal from intros.',
  },
]

export default function SettingsHowItWorksPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="app-card">
      <h2>FAQ</h2>
      <div className="faq-list" style={{ marginTop: '1rem' }}>
        {portalFaqItems.map((item, index) => (
          <div
            key={index}
            className={`faq-item ${openIndex === index ? 'faq-item-open' : ''}`}
          >
            <button
              type="button"
              className="faq-q"
              onClick={() => setOpenIndex((prev) => (prev === index ? null : index))}
              aria-expanded={openIndex === index}
              aria-controls={`portal-faq-answer-${index}`}
              id={`portal-faq-question-${index}`}
            >
              {item.q}
              <span className="faq-icon" aria-hidden>+</span>
            </button>
            <div
              id={`portal-faq-answer-${index}`}
              role="region"
              aria-labelledby={`portal-faq-question-${index}`}
              className="faq-a-wrap"
            >
              <p className="faq-a">{item.a}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
