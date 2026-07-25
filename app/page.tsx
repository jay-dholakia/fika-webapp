import Header from './components/Header'
import LandingHashScroll from './components/LandingHashScroll'
import Footer from './components/Footer'
import ScrollReveal from './components/ScrollReveal'
import FaqAccordion from './components/FaqAccordion'
import Image from 'next/image'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export default function Home() {
  return (
    <>
      <Header />
      <LandingHashScroll />

      <ScrollReveal>
        <main>
          <div className="hero-what-wrapper">
            <div className="hero-what-blob" aria-hidden />
            <div className="hero-stack">
              <section className="hero">
                <div className="hero-inner">
                  <h1 className="hero-title">
                    Meet someone new.<br />
                    <span className="hero-title-accent">Have a real conversation.</span>
                  </h1>
                  <p className="hero-sub">
                    A coffee meetup, set up by text. Show up and have a real conversation.
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
                href={CONCIERGE_NUMBER ? `sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent('Hi — set me up for Fika.')}` : '/#cta'}
                className="btn btn-primary home-mobile-cta"
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
                    Text our number and answer a few quick questions. We use that to find a great intro for you.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Get a text invite</h3>
                  <p className="step-text">
                    When we have a great intro for you, we&apos;ll reach out by text.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Find out who</h3>
                  <p className="step-text">
                    We&apos;ll pair you with someone we think you&apos;ll have a real conversation with — and send everything you need.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">4</span>
                <div className="step-content">
                  <h3 className="step-title">Show up</h3>
                  <p className="step-text">
                    We pick a nearby spot and text you everything you need. Just show up.
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
                href={`sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent('Hi — set me up for Fika.')}`}
                className="btn btn-primary btn-block home-mobile-cta"
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
