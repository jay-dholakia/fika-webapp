import Header from './components/Header'
import ScrollReveal from './components/ScrollReveal'
import FaqAccordion from './components/FaqAccordion'

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
                <a href="#cta" className="btn btn-primary">Join the waitlist</a>
              </div>
            </section>

            <section id="what" data-animate className="section section-what">
              <div className="section-inner">
            <p className="section-definition">
              <span className="section-headword">Fika</span><span className="section-pronunciation"> \ˈfē-kə\</span> <em>noun</em> — Swedish for a coffee break in good company, built around real conversation. A daily pause to slow down, relax, and appreciate the small things.
            </p>
            <p className="section-body section-body-follow">
              We built Fika to bring that back.
            </p>
            <p className="section-body section-body-follow">
              Each week, you get a handful of thoughtful introductions—people who align with what you share and what you don't.
            </p>
            <p className="section-body section-body-follow">
              You choose who to meet.
            </p>
            <p className="section-body section-body-follow">
              In person, the conversation actually goes somewhere. After that, stay in touch—or let it be one great fika. Your call.
            </p>
          </div>
        </section>
          </div>

        <section id="how" data-animate className="section section-how">
          <div className="section-inner">
            <h2 className="section-title">How it works</h2>
            <p className="section-lead">Three steps to your first fika.</p>
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
                  <p className="step-text">Each week, you'll receive a small set of thoughtful introductions—people aligned enough to connect, different enough to make it interesting. You choose who you'd like to meet. No endless feed. No swiping.</p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Opt in and meet in real life</h3>
                  <p className="step-text">Say yes to one or more. If they say yes too, a chat opens so you can set a time and place to meet. Face to face, the conversation actually goes somewhere.</p>
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
            <h2 className="cta-title">Ready for a real fika?</h2>
            <p className="cta-sub">We’re opening up soon. Leave your email and we’ll tell you when you can get your first weekly intros.</p>
            <form className="cta-form" action="#" method="post">
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                className="cta-input"
                required
              />
              <button type="submit" className="btn btn-primary btn-block">Notify me</button>
            </form>
            <p className="cta-note">No spam. Just one email when we launch.</p>
          </div>
        </section>
        </main>
      </ScrollReveal>

      <footer className="footer">
        <div className="footer-inner">
          <span className="logo">fika</span>
          <p className="footer-tagline">Real connection, one conversation at a time.</p>
        </div>
      </footer>
    </>
  )
}
