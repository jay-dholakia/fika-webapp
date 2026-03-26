import Header from './components/Header'
import Footer from './components/Footer'
import ScrollReveal from './components/ScrollReveal'
import FaqAccordion from './components/FaqAccordion'
import Image from 'next/image'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export default function Home() {
  return (
    <>
      <Header />

      <ScrollReveal>
        <main>
          <div className="hero-what-wrapper">
            <div className="hero-what-blob" aria-hidden />
            <div className="hero-stack">
              <section className="hero">
                <div className="hero-inner">
                  <h1 className="hero-title">
                    Real people.<br />
                    <span className="hero-title-accent">Real conversation.</span>
                  </h1>
                  <p className="hero-sub">
                    Real intros by text when we find a good fit. You meet. You talk. You connect.
                  </p>
                </div>
              </section>

              <div className="hero-coffee-graphic" aria-hidden="true">
                <Image
                  src="/images/coffee-two-cups.png"
                  alt="Two coffee cups on a table"
                  width={1024}
                  height={682}
                  className="hero-coffee-graphic-image"
                  priority
                />
              </div>
            </div>

            <section id="what" data-animate className="section section-what">
              <div className="section-inner">
            <p className="section-definition">
              <span className="section-headword">Fika</span>
              <span className="section-pronunciation" aria-label="Pronunciation">/ˈfiːkə/</span>
              <span className="section-pos">noun</span>
              <span className="section-definition-dash">—</span>
              A Swedish coffee break shared in good company, centered around real conversation. A daily pause to slow down and appreciate the small things.
            </p>
            <p className="section-body section-body-follow">
              We built Fika to bring that feeling back.
            </p>
            <p className="section-body section-body-follow">
              No app. No endless chats.
            </p>
            <p className="section-body section-body-follow">
              <a
                href={CONCIERGE_NUMBER ? `sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent("Hi! Help set me up for Fika.")}` : '#cta'}
                className="btn btn-primary"
              >
                Sign up
              </a>
            </p>
          </div>
        </section>
          </div>

        <section id="how" data-animate className="section section-how">
          <div className="section-inner">
            <h2 className="section-title">How it works</h2>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <h3 className="step-title">Get set up</h3>
                  <p className="step-text">
                    <strong>Text our number to join.</strong> Answer a few quick questions so we can introduce you to people nearby that are similar enough to connect, and different enough to keep it interesting.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">We reach out when we find a good intro</h3>
                  <p className="step-text">
                    We&apos;ll text you when we have a good Fika intro for you. When it&apos;s time to meet, we&apos;ll text you a proposed time and place to confirm.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">We make the plan</h3>
                  <p className="step-text">
                    <strong>Get your introduction</strong> — Once both people are in, we text you a concrete time and place (using what you told us in your profile and your usual free times), and you confirm by text.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">4</span>
                <div className="step-content">
                  <h3 className="step-title">Meet up</h3>
                  <p className="step-text">
                    Confirm and show up. No endless texting — just a real conversation with someone new.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="faq" data-animate className="section section-faq">
          <div className="section-inner">
            <h2 className="section-title">FAQ</h2>
            <FaqAccordion />
          </div>
        </section>

        <section id="cta" data-animate className="section section-cta">
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Ready for a real Fika?</h2>
            <p className="cta-sub">Text us to get started. We&apos;ll walk you through a quick setup over SMS.</p>
            {CONCIERGE_NUMBER ? (
              <a
                href={`sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent("Hi! Help set me up for Fika.")}`}
                className="btn btn-primary btn-block"
              >
                Text us
              </a>
            ) : (
              <p className="cta-sub" style={{ marginTop: '0.75rem' }}>
                Text us at the number in the app to get started.
              </p>
            )}
          </div>
        </section>
        </main>
      </ScrollReveal>

      <Footer />
    </>
  )
}
