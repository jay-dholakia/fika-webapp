'use client'

import { useState } from 'react'

const portalFaqItems = [
  {
    q: 'Can I use Fika to make friends?',
    a: 'Our main intention for Fika is to facilitate conversations between two people who are similar enough to connect, and different enough to keep it interesting! We\'ll leave it up to you to continue conversation, or just leave it at one great Fika. No pressure.',
  },
  {
    q: 'How do I get introductions?',
    a: 'Opt in each week to be included in that week’s match run. Set your availability for Wed–Sun on the Your Availability page—we use when you’re free to suggest a time. Your intro appears Tuesday morning after the run. Skip a week and you’re out until you opt in again.',
  },
  {
    q: 'How many intros do I get per week?',
    a: 'One. We match you with a single person each week so you can focus on making that Fika happen.',
  },
  {
    q: 'How are intros chosen?',
    a: 'We use your profile and preferences to find a good fit, and we only match you when you have overlapping availability—so we can suggest a real time you’re both free.',
  },
  {
    q: 'How often do matches run?',
    a: 'Weekly. Opt in and set your availability (Wed–Sun) before the run; both lock Sunday at 11:59pm. Matches run Tuesday morning; your intro appears then.',
  },
  {
    q: 'What happens when I get an intro?',
    a: 'You’ll see a suggested time based on when you’re both free. You can confirm that time, choose a different time from your shared options, or say you can’t make it. If you or they want to change the time, you get one round to pick an alternate—then the other person confirms or can’t make it. Once you’re both confirmed, you’re set. No in-app chat—just show up at the time you agreed on.',
  },
  {
    q: 'How long do I have to respond?',
    a: 'You have until Tuesday 11:59pm to confirm or change the time. If neither of you confirms by then, the intro expires and you’re back in the pool for next week.',
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
