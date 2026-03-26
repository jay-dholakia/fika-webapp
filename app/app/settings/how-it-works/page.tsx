'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'How are intros chosen?',
    a: 'We use your profile, preferences, and when you’re usually free to find a good Fika intro. We text you a proposed time and place to confirm. Intros are sent by SMS.',
  },
  {
    q: 'How do I get introductions?',
    a: "We'll reach out when we find a good Fika intro for you. When it's time to schedule, we'll text you a proposed time and place—reply to confirm.",
  },
  {
    q: 'How many intros do I get?',
    a: 'We focus on one intro at a time so you can give it a real shot. When we find a good match for you, we’ll text you.',
  },
  {
    q: 'When do intros happen?',
    a: 'We reach out when we find a good Fika intro for you — not on a fixed day or schedule.',
  },
  {
    q: 'What happens when I get an intro?',
    a: 'We text both of you a quick intro, a suggested time, and a place. You can confirm by text or request one alternate time. Once both of you confirm, you’re set.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'We include the response window in each message. If it expires, we keep looking and reach out when we find the next good Fika intro for you.',
  },
  {
    q: "I scheduled a Fika but I can't make it anymore—what should I do?",
    a: 'Text us as soon as you know. We will notify your intro and help with next steps.',
  },
  {
    q: 'Is meeting people through Fika safe?',
    a: 'Meet in public, well-lit places, trust your instincts, and do not share personal details until you are comfortable. If anything feels off, contact support@letsfika.co.',
  },
  {
    q: 'How much does it cost?',
    a: 'Fika is currently free to use.',
  },
  {
    q: 'Can I use Fika to make friends?',
    a: "Yes. Fika is built for meaningful first conversations. If you click, keep in touch; if not, no pressure.",
  },
  {
    q: 'My intro didn\'t show up to our Fika—now what?',
    a: 'We hate when that happens. Text us and we’ll follow up with your intro, and make it clear that flaking isn’t okay. Repeat no-shows without a valid reason will lead to removal from intros!',
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
        Quick answers to how intros, matching, and scheduling work.
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
