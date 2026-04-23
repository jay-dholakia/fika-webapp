'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How do you choose who I meet?',
    a: 'We use your profile, preferences, and when you’re usually free. We text you from our number when we have a good intro. You’ll get a proposed time and a public place (often a café) to confirm by text.',
  },
  {
    q: 'Do I have to meet in person?',
    a: 'Yes. Fika is for in‑person conversation in a public spot—usually a café or similar.',
  },
  {
    q: 'What if we don’t click?',
    a: 'No pressure—it’s one conversation. Stay in touch or leave it at that; your call.',
  },
  {
    q: 'What do you do with my email and number?',
    a: 'We don’t sell or share them. We only use them to run Fika, and your intros never get your contact info.',
  },
  {
    q: 'What does it cost?',
    a: 'Fika is currently free to use.',
  },
]

export default function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index))
  }

  return (
    <div className="faq-list">
      {faqItems.map((item, index) => (
        <div
          key={index}
          className={`faq-item ${openIndex === index ? 'faq-item-open' : ''}`}
        >
          <button
            type="button"
            className="faq-q"
            onClick={() => toggle(index)}
            aria-expanded={openIndex === index}
            aria-controls={`faq-answer-${index}`}
            id={`faq-question-${index}`}
          >
            {item.q}
            <span className="faq-icon" aria-hidden>+</span>
          </button>
          <div
            id={`faq-answer-${index}`}
            role="region"
            aria-labelledby={`faq-question-${index}`}
            className="faq-a-wrap"
          >
            <p className="faq-a">{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
