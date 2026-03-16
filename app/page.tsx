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
            <p className="section-lead">Four steps to your first Fika.</p>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <h3 className="step-title">Text your Fika concierge</h3>
                  <p className="step-text">
                    Text your Fika concierge—an AI agent that sets up your Fikas for you. They&apos;ll ask you a few questions to get to know you: where you&apos;re based, your life chapter right now, your interests, and what kind of conversations and connections you&apos;re open to. Then they take it from there.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Do you want to Fika this week?</h3>
                  <p className="step-text">
                    Each week your concierge texts you asking if you&apos;d like to meet someone new this week—someone similar enough to connect, and different enough to keep it interesting. Reply Yes or Skip. No pressure.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Get your intro</h3>
                  <p className="step-text">
                    If you&apos;re in, your concierge sends you a link to set your availability for the rest of the week for a Fika. They send you an intro every Tuesday morning. If you both say yes, your concierge recommends a time and place based on your shared availability.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">4</span>
                <div className="step-content">
                  <h3 className="step-title">Show up</h3>
                  <p className="step-text">
                    Once you&apos;re both confirmed, your concierge texts you a quick reminder on the day of your Fika and checks in after to ask about how it went. No app, no endless chat—just a real conversation with someone new.
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
