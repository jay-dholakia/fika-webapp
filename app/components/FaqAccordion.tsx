'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How often do I get intros?',
    a: 'Once a week. You opt in each week to be included in the next week’s intro pool—skip a week and you’re out until you opt in again. You can jump back in anytime.',
  },
  {
    q: 'How does matching work?',
    a: 'It requires mutual opt-in. When you say yes to an intro and they say yes to you, a chat is created so you can schedule a time and place to meet for your fika. No chat until you both opt in.',
  },
  {
    q: 'What does it cost?',
    a: '$5 curation fee—and it’s only charged when both you and your intro opt in to meet up. That helps ensure you actually meet in person instead of endless chats that fizzle.',
  },
  {
    q: 'Do I have to meet in person?',
    a: 'Yes. Fika is built for real-life conversation. The whole point is face-to-face connection—when and where it works for you.',
  },
  {
    q: 'What if we don’t click?',
    a: 'No pressure. It’s one conversation. You can stay in touch or leave it at that—your call. Either way, you showed up for a real fika.',
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
