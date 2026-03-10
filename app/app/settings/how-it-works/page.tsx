'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'Can I use Fika to make friends?',
    a: 'Our main intention for Fika is to facilitate conversations between two people who are similar enough to connect, and different enough to keep it interesting! We\'ll leave it up to you to continue conversation, or just leave it at one great Fika. No pressure.',
  },
  {
    q: 'How do I get introductions?',
    a: 'Each week your Fika concierge texts you to see if you’re in for a Fika. Set your availability for Wed–Sun on the Your Availability page, then reply Yes to your Fika concierge to be included in that week’s run (or SKIP to sit it out). Your intro is sent by text and appears in the app after the run.',
  },
  {
    q: 'How many intros do I get per week?',
    a: 'One. We match you with a single person each week so you can focus on making that Fika happen.',
  },
  {
    q: 'How are intros chosen?',
    a: 'We use your profile and preferences to find a good fit, and we only match you when you have overlapping availability—so we can suggest a real time you’re both free. Intros are delivered over SMS so you don’t have to manage a separate app.',
  },
  {
    q: 'How often do matches run?',
    a: 'Weekly. Set your availability (Wed–Sun) and reply Yes to your Fika concierge before the run; both lock Monday 11:59pm. Matches run Tuesday morning; your intro is sent by text and reflected in the app.',
  },
  {
    q: 'What happens when I get an intro?',
    a: 'Your Fika concierge sends you who they are, where they’re based, what they’re into, and a suggested time based on when you’re both free. Reply to your Fika concierge to confirm that time, suggest a different time, or say you can’t make it. If either of you wants to change the time, you get one round to pick an alternate—then the other person confirms or can’t make it. Once you’re both confirmed, you’re set. No endless chat—just show up at the time you agreed on.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'You have until Tuesday 11:59pm to confirm or change the time. If neither of you confirms by then, the intro expires and you’re back in the pool for next week.',
  },
  {
    q: 'How much does it cost?',
    a: 'Fika is currently free to use.',
  },
  {
    q: "I scheduled a Fika but I can't make it anymore—what should I do?",
    a: 'If you know you can’t make it, let your Fika concierge know via text. We’ll let your intro know as well. You can always opt in again for a future week when your schedule works.',
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
