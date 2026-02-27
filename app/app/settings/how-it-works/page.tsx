'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'Can I use Fika to make friends?',
    a: 'Our main intention for Fika is to facilitate conversations between two people who are similar enough to connect, and different enough to keep it interesting! We\'ll leave it up to you to continue conversation, or just leave it at one great Fika. No pressure.',
  },
  {
    q: 'How do I get introductions?',
    a: 'Opt in each week to be included in that week’s match run. New intros show up on your Introductions page after the run. Skip a week and you’re out until you opt in again.',
  },
  {
    q: 'How are intros chosen?',
    a: 'We use your profile and preferences to suggest a small set of people who are a good fit. You get a curated batch each week and choose who you’d like to meet.',
  },
  {
    q: 'How often do matches run?',
    a: 'Weekly. Opt in before the run to be included; new intros appear on the Introductions page after it.',
  },
  {
    q: 'What happens when I say yes to an intro?',
    a: 'A chat opens only when you both opt in—neither sees the other’s choice until then. Then message to pick a time and place.',
  },
  {
    q: 'How much does it cost?',
    a: 'Intro tokens are $5 each (with discounts when you buy more). Use them to opt in to your Fika matches—a little skin in the game to cut down on flaking and get people actually meeting up for Fikas.',
  },
  {
    q: 'Is meeting people through Fika safe?',
    a: 'We encourage everyone to meet in public, well-lit places—coffee shops, cafés, parks, or similar spots—to help keep things safe. Stay in public, trust your instincts, and don’t share personal details (like your address or phone number) until you’re comfortable. If something feels off, reach out to us at support@letsfika.co.',
  },
  {
    q: 'My intro didn\'t show up to our Fika—now what?',
    a: 'Please reach out to support@letsfika.co and we\'ll be happy to reissue you an intro.',
  },
]

export default function SettingsHowItWorksPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index))
  }

  return (
    <div className="app-card">
      <h2>How it Works</h2>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
        Quick answers to how intros, matching, and chats work.
      </p>
      <div className="faq-list">
        {portalFaqItems.map((item, index) => (
          <div
            key={index}
            className={`faq-item ${openIndex === index ? 'faq-item-open' : ''}`}
          >
            <button
              type="button"
              className="faq-q"
              onClick={() => toggle(index)}
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
