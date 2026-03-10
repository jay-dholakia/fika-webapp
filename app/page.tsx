import Header from './components/Header'
import Footer from './components/Footer'
import ScrollReveal from './components/ScrollReveal'
import FaqAccordion from './components/FaqAccordion'
import CtaWithLocation from './components/CtaWithLocation'

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
                  Meet people around you, IRL—when and where it works.
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
              No swiping. No endless chats.
            </p>
          </div>
        </section>
          </div>

        <section id="how" data-animate className="section section-how">
          <div className="section-inner">
            <h2 className="section-title">How it works</h2>
            <p className="section-lead">Three steps to your first Fika.</p>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <h3 className="step-title">Share a bit about you</h3>
                  <p className="step-text">Answer a few quick questions about what you care about, how you spend your time, and the kind of conversation you want. No essays. No long forms.</p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Get your weekly introduction</h3>
                  <p className="step-text">
                    Fika sends you a text message with one thoughtful intro each week—someone aligned enough to connect and
                    different enough to keep it interesting. You&apos;ll see who they are, where they&apos;re based, what
                    they&apos;re into, and a few conversation starters to make it easy to say yes.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Opt in and meet in real life</h3>
                  <p className="step-text">
                    If you both opt in to meet, we&apos;ll send you a time and place based on your availability and your
                    location. Then simply meet up—no apps, no endless chatting, just real conversation with someone new.
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
            <p className="cta-sub">Join the waitlist and we&apos;ll let you know when Fika is ready for you.</p>
            <CtaWithLocation />
          </div>
        </section>
        </main>
      </ScrollReveal>

      <Footer />
    </>
  )
}
