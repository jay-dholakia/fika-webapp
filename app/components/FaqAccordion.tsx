'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How do you decide who to introduce me to?',
    a: 'We use your intake (your current life stage, interests, what you’re hoping to get out of Fika, and where you’re based) plus your availability to find a great fit—and propose a real time you’re both free.',
  },
  {
    q: 'How often do I get intros?',
    a: 'Once a week. Text FIKA each week to opt in. When you’re in, you get one introduction to someone nearby for that week.',
  },
  {
    q: 'Do I have to meet in person?',
    a: 'Yes—Fika is designed for in‑person conversation (usually a café or similar public spot).',
  },
  {
    q: 'What if we don’t click?',
    a: 'No pressure. It’s one conversation. After that, you can stay in touch or leave it at one great Fika. Your call.',
  },
  {
    q: 'What do you do with my email and number?',
    a: 'We do not sell or share your email or phone number with anyone. We only use them to communicate with you about Fika. Your Fika intros also never get access to your information.',
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
