'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How do you choose who I meet?',
    a: "We use your profile and interests to match you with someone we think you'll have a good conversation with — similar enough to connect, different enough to stay interesting. You find out who right before the event.",
  },
  {
    q: 'Do I have to meet in person?',
    a: 'Yes. Fika is for in-person conversation in a public spot — usually a café or similar.',
  },
  {
    q: 'What if we don\'t click?',
    a: "No pressure — it's one conversation. Stay in touch or leave it at that; your call.",
  },
  {
    q: 'What do you do with my phone number?',
    a: "We don't sell or share it. We only use it to run Fika, and your match never gets your contact info.",
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
