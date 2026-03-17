import Header from './components/Header'
import Footer from './components/Footer'
import ScrollReveal from './components/ScrollReveal'
import FaqAccordion from './components/FaqAccordion'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export default function Home() {
  return (
    <>
      <Header />

      <ScrollReveal>
        <main>
          <div className="hero-what-wrapper">
            <div className="hero-what-blob" aria-hidden />
            <section className="hero">
              <div className="hero-inner">
                <h1 className="hero-title">
                  Real people.<br />
                  <span className="hero-title-accent">Real conversation.</span>
                </h1>
                <p className="hero-sub">
                  Weekly intros by text. You meet. You talk. You connect.
                </p>
                <a href="#cta" className="btn btn-primary">Get started</a>
              </div>
            </section>

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
                    <strong>Text FIKA to join.</strong> Answer a few quick questions so we can match you with the right person.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Join each week when you&apos;re ready</h3>
                  <p className="step-text">
                    <strong>Opt in on Sunday</strong> — Text FIKA to join that week&apos;s introductions.
                  </p>
                  <p className="step-text">
                    <strong>Set your availability</strong> — Share when you&apos;re free between Wednesday and Saturday.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">We make the plan</h3>
                  <p className="step-text">
                    <strong>Get your introduction</strong> — On Tuesday, you&apos;ll receive a match with a time and place already set based on your availability.
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
                Text to get started
              </a>
            ) : (
              <p className="cta-sub" style={{ marginTop: '0.75rem' }}>
                Text <strong>FIKA</strong> to the number we use in the app to get started.
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
