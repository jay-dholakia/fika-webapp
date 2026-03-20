'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'How are intros chosen?',
    a: 'We use your profile, preferences, and overlapping availability to pick a strong fit and suggest a real time you are both free. Intros are sent by SMS.',
  },
  {
    q: 'How do I get introductions?',
    a: "Text FIKA each week to opt in. We send a link to set your Wed-Sat availability, then your intro is sent by text and appears in the app.",
  },
  {
    q: 'How many intros do I get per week?',
    a: 'One. We match you with a single person each week so you can focus on making that Fika happen.',
  },
  {
    q: "How often do intro's run?",
    a: 'Weekly. Text FIKA on Sunday, set your Wed-Sat availability by Monday 11am PT, and intros go out Tuesday. You have until Tuesday evening to accept or pass.',
  },
  {
    q: 'What happens when I get an intro?',
    a: 'We text both of you a quick intro, a suggested time, and a place. You can confirm by text or request one alternate time. Once both of you confirm, you’re set.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'Until Tuesday evening. If neither person confirms by then, the intro expires and you can opt in again next week.',
  },
  {
    q: "I scheduled a Fika but I can't make it anymore—what should I do?",
    a: 'Text us as soon as you know. We will notify your intro, and you can opt in again when your schedule works.',
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
