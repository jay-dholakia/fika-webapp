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
                  <h3 className="step-title">Get your weekly introductions</h3>
                  <p className="step-text">Each week, you'll receive a small set of thoughtful introductions—people aligned enough to connect, different enough to make it interesting. You decide who to meet.</p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Opt in and meet in real life</h3>
                  <p className="step-text">Say yes to one or more of your intros. If they say yes too, a chat opens so you can set a time and place. Meet in person and see where the conversation goes—stay in touch or let it be one great Fika. Your call.</p>
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
            <p className="cta-sub">Enter your location to see if we&apos;re in your city—or join the waitlist and we&apos;ll let you know when Fika comes to you.</p>
            <CtaWithLocation />
          </div>
        </section>
        </main>
      </ScrollReveal>

      <Footer />
    </>
  )
}
