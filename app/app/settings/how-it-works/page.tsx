'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'How do intros and scheduling work?',
    a: 'We match using your profile, preferences, and when you’re usually free. We text you on this number when we have a strong intro. We focus on one at a time. You’ll get an SMS with a short intro, a proposed time, and a public spot (usually a café). Reply to confirm or ask for one alternate; both people need to confirm before you’re set.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'Each message says how long you have. If a window expires, we keep looking and will text you again when we have another good intro.',
  },
  {
    q: "I can't make my Fika anymore—what should I do?",
    a: 'Text us as soon as you know. We’ll notify your intro and help with next steps.',
  },
  {
    q: 'Is meeting through Fika safe?',
    a: 'Meet in public, well-lit places, trust your instincts, and don’t share personal details until you’re comfortable. If anything feels off, contact support@letsfika.co.',
  },
  {
    q: 'How much does it cost?',
    a: 'Fika is currently free to use.',
  },
  {
    q: 'Can I use Fika to make friends?',
    a: 'Yes. It’s built for a real first conversation—if you click, stay in touch; if not, no pressure.',
  },
  {
    q: "My intro didn't show up—what now?",
    a: 'Text us. We’ll follow up with your intro and make expectations clear. Repeated no-shows without a good reason can lead to removal from intros.',
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
