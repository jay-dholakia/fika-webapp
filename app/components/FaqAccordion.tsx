'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How often do I get intros?',
    a: 'Once a week. You opt in each week and set your availability for the upcoming week. We match you with one person you have overlapping time with. Skip a week and you’re out until you opt in again.',
  },
  {
    q: 'How does matching work?',
    a: 'We suggest a time when you’re both free. You can confirm it, pick a different time from your shared options, or say you can’t make it. If someone wants to change the time, you get one round to choose an alternate—then the other confirms or can’t make it. No in-app chat: once you’re both confirmed, you just show up.',
  },
  {
    q: 'What does it cost?',
    a: '$5 curation fee—and it\'s only charged if you both actually meet up.',
  },
  {
    q: 'Do I have to meet in person?',
    a: 'Yes. Fika is built for real-life conversation. The whole point is face-to-face connection—when and where it works for you.',
  },
  {
    q: 'What if we don’t click?',
    a: 'No pressure. It’s one conversation. After that, you can stay in touch or leave it at one great Fika. Your call.',
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
