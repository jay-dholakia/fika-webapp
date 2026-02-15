import Header from './components/Header'
import ScrollReveal from './components/ScrollReveal'

export default function Home() {
  return (
    <>
      <Header />

      <ScrollReveal>
        <main>
          <section className="hero">
          <div className="hero-inner">
            <p className="hero-label">In-person connection, the way it used to be</p>
            <h1 className="hero-title">
              Real people.<br />
              <span className="hero-title-accent">Real conversation.</span>
            </h1>
            <p className="hero-sub">
              Meet people in person for real conversation—based on what you share and what you don’t. You choose who to meet. Face to face—when and where it works.
            </p>
            <a href="#cta" className="btn btn-primary">Join the waitlist</a>
          </div>
          <div className="hero-blob" aria-hidden />
        </section>

        <section id="what" data-animate className="section section-what">
          <div className="section-inner">
            <p className="section-definition">
              <span className="section-headword">Fika</span><span className="section-pronunciation"> \ˈfē-kə\</span> <em>noun</em> — In Swedish, the daily pause for connection—a coffee and pastry break with someone, and real conversation. No agenda. Just connection.
            </p>
            <p className="section-body section-body-follow">
              We built Fika to bring that idea back. No swiping, no friend list. Each week you get a handful of intros—people we think you’ll click with, based on what you share and what you don’t. You choose who you’d like to meet. In person, the conversation actually goes somewhere. After that, you can stay in touch or leave it at one great fika. Your call.
            </p>
          </div>
        </section>

        <section id="how" data-animate className="section section-how">
          <div className="section-inner">
            <h2 className="section-title">How it works</h2>
            <p className="section-lead">Three steps to your first fika.</p>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <h3 className="step-title">Share a bit about you</h3>
                  <p className="step-text">Quick questions about what you care about, how you spend your time, and what kind of conversation you’re looking for. Takes a few minutes—no long forms.</p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <h3 className="step-title">Get your weekly intros</h3>
                  <p className="step-text">Each week we send you a small set of people we think you’ll click with—based on what you share and what you don’t. You pick who you’d like to meet. No endless feed, no swiping.</p>
                </div>
              </li>
              <li className="step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <h3 className="step-title">Opt in and meet in real life</h3>
                  <p className="step-text">Say yes to one or more. Meet for coffee, a walk, or wherever works. Face to face, the conversation actually goes somewhere.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="faq" data-animate className="section section-faq">
          <div className="section-inner">
            <h2 className="section-title">FAQ</h2>
            <dl className="faq-list">
              <div className="faq-item">
                <dt className="faq-q">How often do I get intros?</dt>
                <dd className="faq-a">Once a week. Opt in each week to get your intros—skip a week and you’re out until you opt in again. You can jump back in anytime.</dd>
              </div>
              <div className="faq-item">
                <dt className="faq-q">Do I have to meet in person?</dt>
                <dd className="faq-a">Yes. Fika is built for real-life conversation. That’s the whole point—face to face, when and where it works for you.</dd>
              </div>
              <div className="faq-item">
                <dt className="faq-q">What if we don’t click?</dt>
                <dd className="faq-a">No pressure. It’s one conversation. You can stay in touch or leave it at that—your call.</dd>
              </div>
            </dl>
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
          <span className="logo">Fika</span>
          <p className="footer-tagline">Real connection, one conversation at a time.</p>
        </div>
      </footer>
    </>
  )
}
