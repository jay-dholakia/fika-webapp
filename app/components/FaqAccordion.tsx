'use client'

import { useState } from 'react'

const faqItems = [
  {
    q: 'How often do I get intros?',
    a: 'Once a week. Your Fika concierge texts you to ask if you’re in for this week—reply Yes to your Fika concierge to be included or Skip to sit it out. When you’re in, you get one introduction to someone nearby for that week.',
  },
  {
    q: 'How does matching work?',
    a: 'We only match you when you have overlapping availability. Your intro arrives from your Fika concierge by text with who they are, where they’re based, what they’re into, and a suggested time and place. You can confirm or adjust once if needed—then simply meet up. No separate app to manage, no endless messaging.',
  },
  {
    q: 'What does it cost?',
    a: 'Fika is currently free to use.',
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
